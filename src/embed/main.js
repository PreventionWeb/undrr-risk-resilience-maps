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
 * - **no information pages, no header, no footer, no preview gate** — the embed
 *   markup simply has none of those hooks, so the sidebar builds none of them;
 * - **a versioned `postMessage` bridge** to the host (`src/embed/messaging.js`);
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
import "../styles/shared.css";
import "../styles/components/embed.css";

/** Bounds on the auto-size hint, so a broken layout cannot ask for a 1px or a 1e6px frame. */
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 4000;

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
 * @returns {{ map: object, bridge: object, params: object, destroy(): void }}
 */
export function mountEmbed(root, { windowRef = window, search, referrer, analytics, riskMapOptions } = {}) {
  const doc = root.ownerDocument;
  const params = parseEmbedParams(search ?? windowRef.location.search, {
    referrer: referrer ?? doc.referrer,
  });

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
      // set-layers: a desired state, clamped exactly as a URL parameter is.
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

  map.on("ready", (payload) => bridge.post("ready", { version: MESSAGE_VERSION, ...payload }));
  map.on("state", (state) => {
    updateFullViewerLink(state);
    bridge.post("state", state);
  });
  map.on("error", (error) => bridge.post("error", error));

  // Auto-sizing hint. Most hosts give the iframe a fixed height; this is for the
  // ones that would rather size it to the embed's content.
  let lastHeight = 0;
  const reportHeight = () => {
    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(root.scrollHeight)));
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    bridge.post("resize", { height });
  };
  const observer = windowRef.ResizeObserver ? new windowRef.ResizeObserver(reportHeight) : null;
  observer?.observe(root);
  reportHeight();

  // --- Analytics -----------------------------------------------------------

  createAnalytics(analytics).track(
    EMBED_LOADED,
    embedLoadedProps({
      referrer: referrer ?? doc.referrer,
      tab: params.tab,
      layers: params.layers.map((layer) => layer.key),
      framed: windowRef.parent !== windowRef,
    }),
  );

  return {
    map,
    bridge,
    params,
    destroy() {
      observer?.disconnect();
      bridge.destroy();
      map.destroy();
    },
  };
}

// The entry's own side effect, and the only one: mount the embed this document
// is. Guarded so importing this module in a test does not mount anything.
const embedRoot = document.querySelector("[data-ui-embed]");
if (embedRoot) mountEmbed(embedRoot);
