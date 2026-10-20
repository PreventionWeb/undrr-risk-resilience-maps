/**
 * `createRiskMap(root, options)` — the app-instance boundary from
 * docs/embedding.md §3.
 *
 * It composes what already exists (the layers store, the layer controller, the
 * layer registry, the router and its state adapter, the sidebar, the map
 * warm-up and the MapX availability watch) into one object with a lifetime:
 * `getState`, `setState`/`setTab`/`setLayers`, `on(event, fn)` and `destroy()`.
 * The standalone site (`src/main.js`) is its first consumer and `embed.html`
 * (`src/embed/main.js`) is its second, so the two differ in options rather than
 * in wiring.
 *
 * What it does *not* do yet: two instances in one document. The MapX client, the
 * inspection batch, the infobox and the site-inspector panel are still module
 * singletons keyed by document ids, which docs/embedding.md §6 explicitly allows
 * for now ("a module singleton wrapper for the standalone app is acceptable if
 * the factory exists"). Both of phase 1's consumers are one instance per
 * document, so the constraint is not exercised; phase 2b (two maps on one page)
 * is what has to finish it.
 *
 * Nothing runs on import: no validation, no DOM, no SDK. Every listener,
 * interval and SDK subscription this creates is undone by `destroy()`.
 */
import { TABS, PRIMARY_PROJECT } from "../config/layers.js";
import { createLayerRegistry, getLayerRegistry } from "../config/registry.js";
import { validateLayers } from "../config/validate.js";
import { createHashAdapter } from "../state/hash-adapter.js";
import { changesUrlState, toUrlLayers } from "../state/layers-store.js";
import { createSidebar } from "../ui/sidebar.js";
import { initBuildInfo } from "../ui/build-info.js";
import { closeInfobox, showInfobox } from "../ui/infobox.js";
import { buildSiteInspectorPanel, hideSiteInspector, showSiteInspector } from "../ui/site-inspector.js";
import { initSDK, isMapXAtLeast, setSDKReady } from "../sdk/client.js";
import {
  disableInspection,
  enableInspection,
  handleClickEvent,
  handleFeaturesEvent,
  initInspection,
  isInspectionActive,
  onInspectionResult,
} from "../sdk/inspect.js";
import {
  hideMapServiceNotice,
  initMapServiceRetry,
  loadMapXSdk,
  showMapServiceNotice,
  startMapServiceRetryCountdown,
  watchForMapReady,
} from "../sdk/availability.js";
import * as store from "../state/store.js";
import { CameraError, createCamera } from "../sdk/camera.js";
import { getExternalLayerRuntime, isExternalLayer } from "../external/index.js";
import { parseBounds } from "../utils/camera.js";

/** The `data-ui` hooks `createRiskMap` itself looks up (the sidebar has its own). */
const PARTS = { appMap: "app-map", mapx: "mapx", inspectToggle: "inspect-toggle" };

/** The events `on()` accepts. Same vocabulary as the host message names (§3). */
export const RISK_MAP_EVENTS = ["ready", "state", "error"];

/**
 * How long `fitLayer()` waits for a layer that is still turning on (or
 * switching source) to settle. A real `view_add` takes a few seconds; a hung
 * one (MapX up to 1.14.0, LEARNINGS.md) never settles, and the caller must
 * still get an answer.
 */
export const LAYER_SETTLE_TIMEOUT_MS = 15_000;

/** A MapX call for this layer is in flight, or intent has not been applied yet. */
const BUSY_STATUSES = new Set(["loading", "removing", "switching"]);
const isSettled = (record) =>
  !BUSY_STATUSES.has(record.status) &&
  record.desired === record.applied &&
  (!record.applied || record.sourceIdx === record.appliedSourceIdx);

/**
 * The tabs and layers an instance may show.
 *
 * Both allowlists are optional and independent: `tabs` picks whole tabs (in
 * config order, not the caller's), `layers` picks layer keys within them. A tab
 * left with no layers by a layer allowlist is dropped rather than rendered as an
 * empty panel. The layer objects are the config's own, by reference, because the
 * registry and the sidebar rows must agree on identity (see
 * `warnIfNotInConfig` in ui/sidebar.js).
 *
 * @param {object[]} allTabs - the layer config's `TABS`
 * @param {{ tabs?: string[]|null, layers?: string[]|Set<string>|null }} [allow]
 * @returns {object[]} a tabs array shaped exactly like `TABS`
 */
export function selectTabs(allTabs, { tabs: tabIds = null, layers: layerKeys = null } = {}) {
  const wantedTabs = tabIds?.length ? new Set(tabIds) : null;
  const picked = allTabs.filter((tab) => !wantedTabs || wantedTabs.has(tab.id));

  const allowed = layerKeys ? new Set(layerKeys) : null;
  if (!allowed) return picked;

  return picked
    .map((tab) => {
      const layers = tab.layers.filter((layer) => allowed.has(layer.key));
      const groups = tab.groups
        ?.map((group) => ({ ...group, layers: group.layers.filter((layer) => allowed.has(layer.key)) }))
        .filter((group) => group.layers.length > 0);
      return { ...tab, layers, groups: groups?.length ? groups : null };
    })
    .filter((tab) => tab.layers.length > 0);
}

/**
 * Create a map instance inside `root`.
 *
 * @param {HTMLElement} root - contains the `data-ui` hooks (see PARTS here and
 *   in ui/sidebar.js). The instance touches no element outside it except the
 *   document-level singletons named in the module comment.
 * @param {object} [options]
 * @param {string} [options.initialTab] - tab shown when the state adapter names
 *   none (default "home")
 * @param {Array<{key: string, sourceIdx?: number, settings?: object}>} [options.layers] -
 *   layers to open on load. Seeded into the state adapter, so they restore
 *   through the router's ordinary path once MapX is ready.
 * @param {string[]|null} [options.tabs] - tab-id allowlist (default: every tab)
 * @param {string[]|Set<string>|null} [options.layerAllowlist] - layer-key
 *   allowlist (default: every layer of the allowed tabs)
 * @param {object} [options.stateAdapter] - `read/write/subscribe/destroy` (see
 *   docs/embedding.md §3). Owned by the caller when injected; otherwise a hash
 *   adapter is created and destroyed with the instance.
 * @param {string} [options.mapxProject] - MapX project id
 * @param {boolean} [options.validate] - run `validateLayers()` first (default true)
 * @param {boolean} [options.buildInfo] - wire the build-info footer if the page
 *   has one (default true)
 * @param {() => void} [options.reload] - how the map-service notice retries
 *   (default: reload the instance's own window, never the host's)
 * @param {typeof loadMapXSdk} [options.loadSdk] - injected for tests
 * @param {typeof initSDK} [options.createManager] - injected for tests
 * @returns {{
 *   getState(): { tab: string|null, layers: Array<object> },
 *   setState(state: { tab?: string, layers?: Array<object> }): void,
 *   setTab(tabId: string): void,
 *   setLayers(layers: Array<object>): void,
 *   getView(): Promise<{ center: { lng: number, lat: number }, zoom: number, bounds: number[]|null }>,
 *   setView(view: { center?: object, zoom?: number, animate?: boolean }): Promise<void>,
 *   fitBounds(bounds: number[], options?: { animate?: boolean }): Promise<void>,
 *   fitArea(code: string, options?: { animate?: boolean }): Promise<void>,
 *   fitLayer(key: string, options?: { animate?: boolean }): Promise<void>,
 *   on(event: "ready"|"state"|"error", fn: Function): () => void,
 *   destroy(): void,
 *   readonly tabs: string[],
 *   readonly layerKeys: string[],
 * }}
 */
export function createRiskMap(root, options = {}) {
  const {
    initialTab = "home",
    layers: initialLayers = [],
    tabs: tabIds = null,
    layerAllowlist = null,
    stateAdapter,
    mapxProject = PRIMARY_PROJECT,
    validate = true,
    buildInfo = true,
    reload,
    loadSdk = loadMapXSdk,
    createManager = initSDK,
  } = options;

  if (!root) throw new Error("createRiskMap: a root element is required");
  const doc = root.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  const part = (name) => root.querySelector(`[data-ui="${PARTS[name]}"]`);

  if (validate) validateLayers(TABS, mapxProject);

  const tabs = selectTabs(TABS, { tabs: tabIds, layers: layerAllowlist });
  // The shared, immutable registry when the instance shows the whole config
  // (docs/embedding.md §3's "may stay module-level"); a private one otherwise,
  // so the URL key order and the controller's lookups cover exactly these tabs.
  const registry =
    tabs.length === TABS.length && tabs.every((tab, i) => tab === TABS[i])
      ? getLayerRegistry()
      : createLayerRegistry(tabs);

  const adapter = stateAdapter ?? createHashAdapter({ target: win });
  const ownsAdapter = !stateAdapter;
  // Initial layers are state, not a separate startup path: seeding the adapter
  // means they restore exactly as a shared link does, with the same clamping and
  // the same single write in place once they settle.
  if (initialLayers.length > 0) adapter.write({ tab: initialTab, layers: initialLayers }, { replace: true });

  const lifetime = new AbortController();
  const { signal } = lifetime;
  const disposers = [];
  const listeners = new Map(RISK_MAP_EVENTS.map((event) => [event, new Set()]));
  let destroyed = false;
  let readyPayload = null;
  let mapx = null;
  let stopAutoRetry = () => {};
  let cancelReadyTimeout = () => {};

  const appMap = part("appMap");
  const inspectToggle = part("inspectToggle");

  // --- Events --------------------------------------------------------------

  function emit(event, payload) {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`A risk-map "${event}" listener failed:`, error);
      }
    }
  }

  /** The last state reported, so `getState()` still answers after destroy. */
  let lastState = { tab: initialTab, layers: [] };
  let stateJson = null;
  let statePending = false;

  function readState() {
    const layersStore = sidebar?.store;
    if (!layersStore) return lastState;
    lastState = {
      tab: sidebar.activeTab,
      layers: toUrlLayers(layersStore.all(), registry.urlKeyOrder()),
    };
    return lastState;
  }

  /**
   * Report state once per settled change. A single user action touches the store
   * several times (intent, then the applied view) and can move the tab too, so
   * the report is coalesced to a microtask and dropped when the state is what
   * was last reported.
   */
  function scheduleState() {
    if (destroyed || statePending) return;
    statePending = true;
    queueMicrotask(() => {
      statePending = false;
      if (destroyed) return;
      const state = readState();
      const json = JSON.stringify(state);
      if (json === stateJson) return;
      stateJson = json;
      emit("state", state);
    });
  }

  // --- UI ------------------------------------------------------------------

  function setInspectionMode(active) {
    if (active) {
      closeInfobox();
      enableInspection();
    } else {
      disableInspection();
      hideSiteInspector();
    }
    appMap?.classList.toggle("inspection-active", active);
    inspectToggle?.classList.toggle("is-active", active);
    inspectToggle?.setAttribute("aria-pressed", String(active));
  }

  const sidebar = createSidebar(root, {
    stateAdapter: adapter,
    registry,
    tabs,
    initialTab,
    // Keep the inspect button enabled/disabled in sync with the layers on the map.
    onViewsChanged(count) {
      if (!inspectToggle) return;
      inspectToggle.disabled = count === 0;
      if (count === 0 && isInspectionActive()) setInspectionMode(false);
    },
    onLayerError(key, error, action) {
      console.warn(`Layer "${key}": ${action} failed:`, error);
      emit("error", { code: "layer-failed", message: `Layer "${key}": ${action} failed` });
    },
  });

  disposers.push(
    sidebar.store.subscribe((_key, next, prev) => {
      if (changesUrlState(next, prev)) scheduleState();
    }),
  );
  disposers.push(sidebar.onTabChange(() => scheduleState()));

  buildSiteInspectorPanel();
  if (buildInfo) {
    const stopBuildInfo = initBuildInfo();
    if (stopBuildInfo) disposers.push(stopBuildInfo);
  }
  const retryReload = reload ?? (() => win.location.reload());
  initMapServiceRetry(doc, retryReload, { signal });

  // --- MapX ----------------------------------------------------------------

  const showMapFailure = () => {
    showMapServiceNotice(doc);
    stopAutoRetry();
    stopAutoRetry = startMapServiceRetryCountdown({ documentRef: doc, reload: retryReload });
    emit("error", { code: "mapx-unavailable", message: "The map service could not be reached" });
  };

  async function startMapX() {
    try {
      await loadSdk({ documentRef: doc, windowRef: win });
      if (destroyed) return;
      mapx = createManager(part("mapx"), mapxProject);
    } catch (error) {
      if (destroyed) return;
      console.error("MapX SDK startup failed:", error);
      showMapFailure();
      return;
    }

    // The budget only runs while the map is the view the user is on, so reaching
    // this really does mean MapX had its full loading time, in front of someone
    // waiting for it, and never answered.
    cancelReadyTimeout = watchForMapReady(
      () => {
        console.error(
          "MapX did not become ready within the ~30s of loading time it was given while the map was on screen",
        );
        showMapFailure();
      },
      { documentRef: doc },
    );

    initInspection(mapx);
    disposers.push(onInspectionResult((result) => showSiteInspector(result)));

    inspectToggle?.addEventListener("click", () => setInspectionMode(!isInspectionActive()), { signal });

    mapx.on("ready", async () => {
      if (destroyed) return;
      cancelReadyTimeout();
      stopAutoRetry();
      hideMapServiceNotice(doc);
      setSDKReady(true);

      try {
        // Hide all MapX native UI chrome (notifications, controls panel, main
        // panel, toolbar buttons) — we provide our own sidebar and tool controls.
        await mapx.ask("set_immersive_mode", { enable: true });
        // Restore any layers the state adapter carries (a shared link, or the
        // `layers` option).
        await sidebar.restoreFromUrl();
      } catch (error) {
        console.error("MapX ready-handler setup failed:", error);
      }
      if (destroyed) return;

      // Enable the inspect button only if layers are already open (e.g. restore).
      if (inspectToggle) inspectToggle.disabled = store.openViews.size === 0;

      readyPayload = { tabs: tabs.map((tab) => tab.id), layers: [...registry.urlKeyOrder()] };
      emit("ready", readyPayload);
      scheduleState();
    });

    // Route map clicks by inspection mode: when active, collect every open
    // view's result for the site inspector; when inactive, show the infobox.
    //
    // MapX 1.14.2 fires one `click_features` per click with
    // { attributes: { [idView]: attrs }, lngLat, point }, including on empty
    // clicks (attributes {}), and still fires the per-view `click_attributes`
    // alongside it. Older MapX fires only `click_attributes`, one per open view.
    // Listen to exactly one, chosen by the Manager's version, so a click is
    // never handled twice whatever order the two arrive in.
    // MapX upstream: https://github.com/unep-grid/mapx/issues/1139. Once
    // production MapX runs 1.14.2+, drop the click_attributes branch and the
    // batching in src/sdk/inspect.js.
    if (isMapXAtLeast(mapx.version, "1.14.2")) {
      mapx.on("click_features", (data) => {
        if (destroyed || !data) return;
        if (isInspectionActive()) {
          handleFeaturesEvent(data, store.openViews);
          return;
        }
        // Vector views send an array of features, custom coded views a plain
        // object; showInfobox() takes either.
        const attributes =
          data.attributes && typeof data.attributes === "object" ? Object.values(data.attributes) : [];
        const first = attributes.find((attrs) =>
          Array.isArray(attrs) ? attrs.length > 0 : attrs && typeof attrs === "object",
        );
        if (first) showInfobox({ attributes: first, lngLat: data.lngLat });
        else closeInfobox();
      });
    } else {
      mapx.on("click_attributes", (...args) => {
        if (destroyed) return;
        let data = args.length === 1 ? args[0] : null;
        if (!data && args.length > 0) data = { attributes: args };
        if (!data) return;

        if (isInspectionActive()) handleClickEvent(data, store.openViews);
        else showInfobox(data);
      });
    }
  }

  void startMapX();

  // --- Camera --------------------------------------------------------------

  const camera = createCamera(() => mapx);

  /** Camera calls need MapX up and the instance alive. */
  function cameraReady() {
    if (destroyed || !readyPayload || !mapx) throw new CameraError("not-ready", "The map is not ready");
  }

  /**
   * Resolve with the layer's record once nothing is pending for it: on, off,
   * or failed. Rejects with `timeout` after LAYER_SETTLE_TIMEOUT_MS.
   */
  function whenLayerSettled(key) {
    const layersStore = sidebar.store;
    return new Promise((resolve, reject) => {
      let off = () => {};
      let timer = null;
      const finish = () => {
        off();
        clearTimeout(timer);
      };
      const check = () => {
        const record = layersStore.get(key);
        if (!isSettled(record)) return false;
        finish();
        resolve(record);
        return true;
      };
      if (check()) return;
      off = layersStore.subscribe((changed) => changed === key && check());
      timer = setTimeout(() => {
        finish();
        reject(new CameraError("timeout", `Layer "${key}" did not finish loading in time`));
      }, LAYER_SETTLE_TIMEOUT_MS);
    });
  }

  /**
   * Where a layer is, as bounds. In order: the layer config's `bounds` (free
   * and predictable, and the only answer for views MapX cannot summarise); an
   * external layer's runtime bounds, computed from the GeoJSON it built; else
   * the MapX view's source extent (`get_view_source_summary`, timed out and
   * cached per view).
   */
  function layerBounds(layer, record) {
    const configured = parseBounds(layer.bounds);
    if (configured) return configured;
    if (isExternalLayer(layer)) {
      const runtime = parseBounds(getExternalLayerRuntime(layer)?.bounds);
      if (runtime) return runtime;
      throw new CameraError("no-extent", `Layer "${layer.key}" has no known extent`);
    }
    return camera.viewExtent(record.viewId);
  }

  return {
    /** `{ tab, layers }` — exactly what a share link or a `state` message carries. */
    getState: readState,

    /**
     * Ask for a tab, a set of layers, or both. Layers are a desired state: the
     * controller works out what has to change, and the whole change is one
     * URL write in place (never a new history entry). Ignored before MapX is
     * ready; wait for the `ready` event.
     */
    setState({ tab, layers } = {}) {
      if (destroyed) return;
      if (layers) sidebar.setLayers(layers, { tab });
      else if (tab) sidebar.setTab(tab);
    },
    /** Switch tab (a user action: one history entry in the standalone app). */
    setTab(tabId) {
      if (!destroyed) sidebar.setTab(tabId);
    },
    /** Reconcile the open layers to exactly this list. */
    setLayers(layers) {
      if (!destroyed) sidebar.setLayers(layers ?? []);
    },

    /**
     * The camera: `{ center: { lng, lat }, zoom, bounds: [w, s, e, n] }`.
     * Every camera method rejects with a `CameraError` (`code` and `message`)
     * and never hangs: each MapX call is timed out (src/sdk/camera.js).
     */
    getView() {
      return Promise.resolve().then(() => {
        cameraReady();
        return camera.getView();
      });
    },
    /**
     * Move to a centre and/or zoom, already validated (src/utils/camera.js).
     * @param {{ center?: { lng: number, lat: number }, zoom?: number, animate?: boolean }} view
     */
    setView(view) {
      return Promise.resolve().then(() => {
        cameraReady();
        return camera.setView(view);
      });
    },
    /** Fit the camera to validated bounds `[w, s, e, n]`. */
    fitBounds(bounds, options) {
      return Promise.resolve().then(() => {
        cameraReady();
        return camera.fitBounds(bounds, options);
      });
    },
    /** Fit the camera to a validated ISO3 or M49 area code. */
    fitArea(code, options) {
      return Promise.resolve().then(() => {
        cameraReady();
        return camera.fitArea(code, options);
      });
    },
    /**
     * Fit the camera to the area a layer covers. The layer has to be on, or
     * turning on: one still loading is waited for, so a host can send
     * `set-layers` and `fit-layer` back to back. A layer that is off is refused
     * (`layer-off`) rather than turned on behind the layer state's back.
     * @param {string} key
     * @param {{ animate?: boolean }} [options]
     */
    async fitLayer(key, { animate = false } = {}) {
      cameraReady();
      const layer = registry.byKey(key);
      if (!layer) throw new CameraError("unknown-layer", `Layer "${key}" is not in this map`);
      const current = sidebar.store.get(key);
      if (!current.desired && !current.applied) {
        throw new CameraError("layer-off", `Layer "${key}" is off; turn it on with set-layers first`);
      }
      const record = await whenLayerSettled(key);
      if (!record.applied || !record.viewId) {
        throw new CameraError("layer-off", `Layer "${key}" is not on the map`);
      }
      const bounds = await layerBounds(layer, record);
      cameraReady();
      await camera.fitBounds(bounds, { animate });
    },

    /**
     * Subscribe to `ready`, `state` or `error`. A listener added after `ready`
     * has fired is called with the payload it missed.
     * @returns {() => void} unsubscribe
     */
    on(event, fn) {
      const set = listeners.get(event);
      if (!set || typeof fn !== "function") return () => {};
      set.add(fn);
      if (event === "ready" && readyPayload) queueMicrotask(() => set.has(fn) && fn(readyPayload));
      return () => set.delete(fn);
    },

    /** The tab ids this instance shows. */
    get tabs() {
      return tabs.map((tab) => tab.id);
    },
    /** The layer keys this instance can turn on, in URL order. */
    get layerKeys() {
      return [...registry.urlKeyOrder()];
    },

    /**
     * Retire the instance: the ready watch and retry countdown, every listener
     * and subscription, the sidebar (its rows, controller, router and DOM), the
     * inspection panels, the MapX manager and its iframe, and an adapter this
     * instance created. `getState()` keeps answering with the last state;
     * everything else is inert.
     */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      readState();
      cancelReadyTimeout();
      stopAutoRetry();
      for (const dispose of disposers.splice(0).reverse()) dispose();
      lifetime.abort();
      hideSiteInspector();
      closeInfobox();
      sidebar.destroy();
      doc.getElementById("site-inspector")?.remove();
      try {
        mapx?.destroy?.();
      } catch (error) {
        console.warn("Destroying the MapX manager failed:", error);
      }
      mapx = null;
      setSDKReady(false);
      if (ownsAdapter) adapter.destroy();
      for (const set of listeners.values()) set.clear();
    },
  };
}
