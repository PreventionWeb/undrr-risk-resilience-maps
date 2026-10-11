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
 * - **the same preview PIN gate as `index.html`** (docs/embedding.md §8,
 *   "The preview gate in an embed");
 * - **a versioned `postMessage` bridge** to the host (`src/embed/messaging.js`),
 *   which stays shut while the gate is locked, and **one command queue**: host
 *   commands (and the URL's camera) run one at a time, in the order they
 *   arrived, once the map is ready;
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
import { applyVariants } from "../state/hash.js";
import { parseAreaCode, parseBounds, parseCenter, parseZoom } from "../utils/camera.js";
import { clampLayers, parseEmbedParams } from "./params.js";
import { createMessageBridge, FEATURES, MESSAGE_VERSION } from "./messaging.js";
import { watchPreviewGate } from "./preview-gate.js";
import "../styles/shared.css";
import "../styles/components/embed.css";

/** What a host is told when it addresses an embed that is still behind the gate. */
const LOCKED_MESSAGE =
  "This embed is a preview and is locked until its PIN is entered inside the frame; it accepts no commands and reports no state until then";

/**
 * How many commands may wait in the queue. A host script is a handful of steps;
 * a queue this long is a loop in the host's code, and each waiting command
 * holds a payload in memory. One past the limit is refused with `queue-full`.
 */
export const MAX_QUEUED_COMMANDS = 32;

/**
 * The most one command may take, from the moment it starts to its answer. Each
 * MapX call already has its own deadline, but `fit-layer` chains several (the
 * layer settling, its extent, the max bounds, the camera, the read-back), and
 * the queue must not wait on all of them in the worst case. The command is
 * answered `timeout` and the queue moves on; a MapX call still in flight may
 * land later.
 */
export const COMMAND_DEADLINE_MS = 20_000;

/** The commands that move the camera, answered with a `view` once they land. */
const CAMERA_COMMANDS = new Set(["set-view", "fit-bounds", "fit-area", "fit-layer"]);

/** The answer to a command when the map service failed before it was ready. */
const NOT_READY = {
  code: "not-ready",
  message: "The map service could not be reached, so this embed cannot carry out commands until it recovers",
};

/** A command refused for a reason the host can act on, reported with `code`. */
const refuse = (code, message) => Object.assign(new Error(message), { code });

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

  // --- Inbound: one queue, in arrival order ----------------------------------
  //
  // Every command, and the camera the URL asks for, goes through one queue that
  // runs while the map is ready and the gate is open, one command at a time:
  // a camera command is awaited (each MapX call has a deadline, so the queue
  // cannot stall) before the next one starts. `set-tab` and `set-layers` are
  // dispatched, not awaited — their outcome is reported by `state` as before —
  // and `fit-layer` waits for a layer that is still turning on, which is what
  // lets a host send `set-layers` and `fit-layer` back to back.
  //
  // A locked embed queues nothing from the host: each command is answered with
  // `error: locked` straight away, as before. A host keeps its script and sends
  // it again on the `ready` that says `locked: false`.

  const queue = [];
  let mapReady = false;
  /** The map service failed before the map was ever ready (it may still recover). */
  let mapFailed = false;
  let running = false;
  let destroyed = false;

  for (const camera of params.cameras) queue.push({ ...camera, fromUrl: true });

  /** A shown data tab, or undefined. */
  const shownTab = (value) =>
    typeof value === "string" && params.tabIds.includes(value) ? value : undefined;

  async function runCommand({ name, payload, id }) {
    switch (name) {
      case "get-state":
        bridge.post("state", map.getState(), { id });
        return;
      case "get-view":
        bridge.post("view", await map.getView(), { id });
        return;
      case "set-tab": {
        const tab = shownTab(payload.tab);
        if (tab) map.setTab(tab);
        return;
      }
      case "set-layers": {
        // set-layers carries a desired state: a list. Anything else is a
        // mistake in the host's code, and turning every layer off is a bad
        // reading of it — `set-tab` already ignores a tab it does not recognise.
        if (!Array.isArray(payload.layers)) {
          throw refuse("malformed", 'A "set-layers" command needs a `layers` array');
        }
        const tab = shownTab(payload.tab);
        const layers = payload.layers.map((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : entry,
        );
        // Read exactly as the `variants` URL parameter is: a value that is not
        // an object is ignored rather than failing the layers it came with.
        if (payload.variants !== undefined && !applyVariants(layers, payload.variants)) {
          console.warn('A "set-layers" command\'s `variants` is not an object and was ignored.');
        }
        const targetCollection = tab && registry.collectionOfTab ? registry.collectionOfTab(tab) : null;
        map.setState({
          tab,
          layers: clampLayers(layers, { allowed, registry, collection: targetCollection }),
        });
        return;
      }
      case "set-view": {
        const center = payload.center === undefined ? null : parseCenter(payload.center);
        const zoom = payload.zoom === undefined ? null : parseZoom(payload.zoom);
        const badCenter = payload.center !== undefined && !center;
        const badZoom = payload.zoom !== undefined && zoom === null;
        if (badCenter || badZoom || (!center && zoom === null)) {
          throw refuse(
            "malformed",
            'A "set-view" command needs a `center` ({ lng, lat }, in range) and/or a numeric `zoom`',
          );
        }
        await map.setView({ center, zoom, animate: payload.animate === true });
        return;
      }
      case "fit-bounds": {
        const bounds = parseBounds(Array.isArray(payload.bounds) ? payload.bounds : null);
        if (!bounds) {
          throw refuse("malformed", 'A "fit-bounds" command needs `bounds`: [west, south, east, north]');
        }
        await map.fitBounds(bounds, { animate: payload.animate === true });
        return;
      }
      case "fit-area": {
        const code = parseAreaCode(payload.code);
        if (!code) {
          throw refuse(
            "malformed",
            'A "fit-area" command needs a `code`: ISO3 (e.g. "KEN") or M49 ("m49_014")',
          );
        }
        await map.fitArea(code, { animate: payload.animate === true });
        return;
      }
      case "fit-layer": {
        // Outside the allowlist and not in the config read the same, so a host
        // cannot probe for layers this embed was configured not to show.
        if (typeof payload.key !== "string" || !allowed.has(payload.key)) {
          throw refuse(
            "unknown-layer",
            `"fit-layer": ${JSON.stringify(payload.key)} is not a layer this embed shows`,
          );
        }
        await map.fitLayer(payload.key, { animate: payload.animate === true });
        return;
      }
      default:
        // classifyMessage() only lets INBOUND names through.
        throw refuse("malformed", `Unknown command "${name}"`);
    }
  }

  /** Tell the host why a command failed: its code when it has one. */
  function report(command, error) {
    const known = typeof error?.code === "string";
    // The host's message names no MapX method; the console may.
    if (error?.method) console.warn(`The "${command.name}" command failed in MapX "${error.method}":`, error);
    if (command.fromUrl) {
      console.warn("The embed URL's camera parameters could not be applied:", error);
    } else if (!known) {
      console.error(`The "${command.name}" command failed:`, error);
    }
    bridge.post(
      "error",
      known
        ? { code: error.code, message: error.message }
        : { code: "command-failed", message: `The "${command.name}" command failed` },
      { id: command.id },
    );
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (!destroyed && mapReady && !gate.locked && queue.length > 0) {
        const command = queue.shift();
        let timer;
        try {
          const run = (async () => {
            await runCommand(command);
            // A camera command is answered with where the camera ended up. The
            // URL's camera is not: nobody asked.
            if (CAMERA_COMMANDS.has(command.name) && !command.fromUrl) return map.getView();
            return null;
          })();
          const deadline = new Promise((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  refuse(
                    "timeout",
                    `The "${command.name}" command took longer than ${COMMAND_DEADLINE_MS} ms`,
                  ),
                ),
              COMMAND_DEADLINE_MS,
            );
          });
          const view = await Promise.race([run, deadline]);
          if (!destroyed && view) bridge.post("view", view, { id: command.id });
        } catch (error) {
          if (!destroyed) report(command, error);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      running = false;
    }
  }

  const bridge = createMessageBridge({
    windowRef,
    parentOrigin: params.parentOrigin,
    instance: params.instance,
    onCommand(command) {
      // Locked: the embed is not drivable and does not report its state. A host
      // that framed a gated prototype gets told why, once per command, and
      // nothing it sends reaches the map.
      if (gate.locked) {
        bridge.post("error", { code: "locked", message: LOCKED_MESSAGE }, { id: command.id });
        return;
      }
      if (mapFailed && !mapReady) {
        bridge.post("error", NOT_READY, { id: command.id });
        return;
      }
      if (queue.length >= MAX_QUEUED_COMMANDS) {
        bridge.post(
          "error",
          {
            code: "queue-full",
            message: `More than ${MAX_QUEUED_COMMANDS} commands are waiting; this one was dropped`,
          },
          { id: command.id },
        );
        return;
      }
      queue.push(command);
      void pump();
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

  // `locked` is read from the gate, never assumed: the field means "the gate is
  // open", so it has to be the gate's answer at the moment the message is
  // posted. In practice a locked embed never gets here (MapX cannot load behind
  // the gate's `visibility: hidden` — see #24), but a stubbed or future map that
  // does become ready must not tell the host the gate opened.
  map.on("ready", (payload) => {
    mapFailed = false;
    bridge.post("ready", { version: MESSAGE_VERSION, ...payload, features: FEATURES, locked: gate.locked });
    mapReady = true;
    void pump();
  });
  // A map that became ready behind the gate (a stub; real MapX cannot, #24)
  // gets its unlocked `ready` when the gate opens, so the rule a host relies on
  // holds either way: the queue runs after a `ready` that says `locked: false`.
  const stopUnlockWatch = gate.onUnlock(() => {
    if (!mapReady || destroyed) return;
    bridge.post("ready", {
      version: MESSAGE_VERSION,
      tabs: map.tabs,
      layers: map.layerKeys,
      features: FEATURES,
      locked: false,
    });
    void pump();
  });
  map.on("state", (state) => {
    updateFullViewerLink(state);
    // While locked, reporting state would let a host read a gated prototype.
    // Nothing should change behind the gate anyway (the map cannot even load
    // there — `canMapLoad()` reads the gate's `visibility: hidden`), so this is
    // the belt to that brace.
    if (!gate.locked) bridge.post("state", state);
  });
  map.on("error", (error) => {
    bridge.post("error", error);
    // The map service could not be reached, so nothing waiting will run until
    // it recovers (the retry reloads the frame). Answer every waiting command
    // now, and any that arrives until the map is ready, rather than leave a
    // host waiting on ids that will never come back.
    if (error?.code === "mapx-unavailable" && !mapReady) {
      mapFailed = true;
      for (const command of queue.splice(0)) {
        if (!command.fromUrl) bridge.post("error", NOT_READY, { id: command.id });
      }
    }
  });

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
      features: FEATURES,
    });
  }

  track();

  return {
    map,
    bridge,
    params,
    gate,
    destroy() {
      destroyed = true;
      queue.length = 0;
      stopUnlockWatch();
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
    features: FEATURES,
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
