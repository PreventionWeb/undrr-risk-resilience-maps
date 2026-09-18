/**
 * Entry point for `embed.html` — the iframe embed (docs/embedding.md phase 1).
 *
 * The second consumer of `createRiskMap()`. It differs from the standalone site
 * (`src/main.js`) only in options and in what surrounds it:
 *
 * - **an in-memory state adapter**, so the embed never writes to the host page's
 *   URL or its session history (blocker B5);
 * - **URL parameters** instead of a hash, validated and clamped in
 *   `src/embed/params.js`;
 * - **no information pages, no header, no footer** — the embed markup simply has
 *   none of those hooks, so the sidebar builds none of them;
 * - **the same preview PIN gate as `index.html`**, because the embed is
 *   published to the open web and GitHub Pages cannot send `frame-ancestors`
 *   (docs/embedding.md §8, "The preview gate in an embed");
 * - **a versioned `postMessage` bridge** to the host (`src/embed/messaging.js`),
 *   which stays shut while the gate is locked;
 * - **an `embed_loaded` analytics event** naming the host it is framed in.
 *
 * Nothing here touches the host document: the only cross-document call is
 * `parent.postMessage` with an explicit target origin.
 */
import { createRiskMap } from "../app/create-risk-map.js";
import { getLayerRegistry } from "../config/registry.js";
import { createMemoryAdapter } from "../state/memory-adapter.js";
import { formatHash } from "../state/hash.js";
import { createAnalytics, EMBED_LOADED, embedLoadedProps } from "../services/analytics.js";
import { clampLayers, parseEmbedParams } from "./params.js";
import { createMessageBridge, MESSAGE_VERSION } from "./messaging.js";
import { watchPreviewGate } from "./preview-gate.js";
import "../styles/shared.css";
import "../styles/components/embed.css";

/** What a host is told when it addresses an embed that is still behind the gate. */
const LOCKED_MESSAGE =
  "This embed is a preview and is locked until its PIN is entered inside the frame; it accepts no commands and reports no state until then";

/**
 * Mount an embed in `root`. Exported (and taking its inputs) so the unit tests
 * can mount one in jsdom without a real iframe or a real MapX.
 *
 * @param {HTMLElement} root - the embed root (`[data-ui-embed]`)
 * @param {object} [context]
 * @param {Window} [context.windowRef]
 * @param {string} [context.search] - the embed URL's query string
 * @param {string} [context.referrer] - `document.referrer`
 * @param {object} [context.analytics] - injected sink holder (tests)
 * @param {object} [context.riskMapOptions] - merged into the instance options (tests)
 * @returns {{ map: object|null, bridge: object, params: object, gate: object, destroy(): void }}
 */
export function mountEmbed(root, { windowRef = window, search, referrer, analytics, riskMapOptions } = {}) {
  const doc = root.ownerDocument;
  const params = parseEmbedParams(search ?? windowRef.location.search, {
    referrer: referrer ?? doc.referrer,
  });
  // The preview gate hides and inerts the whole embed until the PIN is entered
  // *inside the frame*. Everything below asks it whether the bridge may act.
  const gate = watchPreviewGate(doc);

  const track = () =>
    createAnalytics(analytics).track(
      EMBED_LOADED,
      embedLoadedProps({
        referrer: referrer ?? doc.referrer,
        tab: params.tab,
        layers: params.layers.map((layer) => layer.key),
        framed: windowRef.parent !== windowRef,
        locked: gate.locked,
      }),
    );

  // --- Configured to show nothing -----------------------------------------
  // `?allow=no-such-layer` and friends: the host supplied an allowlist that
  // selects nothing (see params.js). There is no map to build, so say so in the
  // frame and answer the host rather than rendering a silently different embed.
  if (params.empty) return mountEmptyEmbed(root, { windowRef, params, gate, track });

  // The panel's initial collapsed state is markup, because that is where the
  // sidebar reads it from and what it restores on destroy.
  if (params.panelCollapsed) root.querySelector('[data-ui="layer-panel"]')?.classList.add("is-collapsed");

  const map = createRiskMap(root, {
    initialTab: params.tab,
    layers: params.layers,
    tabs: params.tabIds,
    layerAllowlist: params.layerKeys,
    stateAdapter: createMemoryAdapter({ initial: { tab: params.tab, layers: params.layers } }),
    // No build-info footer in an embed, and the retry reloads the frame's own
    // document — never the host page.
    buildInfo: false,
    reload: () => windowRef.location.reload(),
    ...riskMapOptions,
  });

  const registry = getLayerRegistry();
  const allowed = new Set(params.layerKeys);

  const bridge = createMessageBridge({
    windowRef,
    parentOrigin: params.parentOrigin,
    instance: params.instance,
    onCommand({ name, payload, id }) {
      // Locked: the embed is not drivable and does not report its state. A host
      // that framed a gated prototype gets told why, once per command, and
      // nothing it sends reaches the map.
      if (gate.locked) {
        bridge.post("error", { code: "locked", message: LOCKED_MESSAGE }, { id });
        return;
      }
      if (name === "get-state") {
        bridge.post("state", map.getState(), { id });
        return;
      }
      const tab =
        typeof payload.tab === "string" && params.tabIds.includes(payload.tab) ? payload.tab : undefined;
      if (name === "set-tab") {
        if (tab) map.setTab(tab);
        return;
      }
      // set-layers carries a desired state: a list. Anything else is a mistake
      // in the host's code, and turning every layer off is a bad reading of it —
      // `set-tab` already ignores a tab it does not recognise.
      if (!Array.isArray(payload.layers)) {
        bridge.post(
          "error",
          { code: "malformed", message: 'A "set-layers" command needs a `layers` array' },
          { id },
        );
        return;
      }
      map.setState({ tab, layers: clampLayers(payload.layers, { allowed, registry }) });
    },
  });

  // --- Outbound ------------------------------------------------------------

  const fullViewerLink = root.querySelector("[data-ui-full-viewer]");
  const updateFullViewerLink = (state) => {
    if (!fullViewerLink) return;
    // The standalone app sits next to embed.html, so "." is its URL under any
    // base (local root, or the /undrr-risk-resilience-maps/ Pages subpath).
    fullViewerLink.href = new URL(".", windowRef.location.href).href + formatHash(state.tab, state.layers);
  };
  updateFullViewerLink(map.getState());

  map.on("ready", (payload) => bridge.post("ready", { version: MESSAGE_VERSION, locked: false, ...payload }));
  map.on("state", (state) => {
    updateFullViewerLink(state);
    // While locked, reporting state would let a host read a gated prototype.
    // Nothing should change behind the gate anyway (the map cannot even load
    // there — `canMapLoad()` reads the gate's `visibility: hidden`), so this is
    // the belt to that brace.
    if (!gate.locked) bridge.post("state", state);
  });
  map.on("error", (error) => bridge.post("error", error));

  // A locked embed never reaches MapX's `ready`, so announce the gate instead:
  // the host learns the frame exists, which version it speaks and why it is not
  // answering, and can show its own message. The real `ready` (with
  // `locked: false`) follows once the PIN is entered and the map finishes.
  if (gate.locked) {
    bridge.post("ready", {
      version: MESSAGE_VERSION,
      locked: true,
      tabs: params.tabIds,
      layers: params.layerKeys,
    });
  }

  track();

  return {
    map,
    bridge,
    params,
    gate,
    destroy() {
      gate.destroy();
      bridge.destroy();
      map.destroy();
    },
  };
}

/**
 * The empty state: a frame whose parameters select nothing.
 *
 * No map is created — there is nothing to put in it — so the notice in the
 * markup is shown, the map region is removed, and the bridge exists only to say
 * `ready` with empty lists and to refuse commands.
 */
function mountEmptyEmbed(root, { windowRef, params, gate, track }) {
  root.querySelector('[data-ui="app-map"]')?.remove();
  root.querySelector(".embed-nav")?.remove();
  const notice = root.querySelector("[data-ui-embed-empty]");
  if (notice) notice.hidden = false;

  const bridge = createMessageBridge({
    windowRef,
    parentOrigin: params.parentOrigin,
    instance: params.instance,
    onCommand({ id }) {
      bridge.post(
        "error",
        {
          code: "empty-configuration",
          message: "This embed's `tabs`/`allow` parameters select no layers, so it has no map to drive",
        },
        { id },
      );
    },
  });

  bridge.post("ready", {
    version: MESSAGE_VERSION,
    locked: gate.locked,
    tabs: [],
    layers: [],
  });
  track();

  return {
    map: null,
    bridge,
    params,
    gate,
    destroy() {
      gate.destroy();
      bridge.destroy();
    },
  };
}

/**
 * The entry's own side effect, and the only one: mount the embed this document
 * is. Guarded so importing this module in a test does not mount anything.
 *
 * It waits for `DOMContentLoaded` for one reason: Mangrove's `preview-access.js`
 * decides there whether the gate is already unlocked (from `sessionStorage`) and
 * marks it. Its module script sits above this one, so its listener is registered
 * first and has run by the time this mounts — which is what lets the mount read
 * a settled gate state instead of assuming the worst and telling every host its
 * embed is locked.
 */
function mountThisDocument() {
  const embedRoot = document.querySelector("[data-ui-embed]");
  if (embedRoot) mountEmbed(embedRoot);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountThisDocument, { once: true });
} else {
  mountThisDocument();
}
