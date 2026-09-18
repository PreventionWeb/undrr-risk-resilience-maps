/**
 * Router: the only module that reads or writes URL state.
 *
 * It owns the active tab and the rule that one user action makes one history
 * entry. Everything it knows about the URL comes from the injected state
 * adapter (`read/write/subscribe/destroy`, see docs/embedding.md), so it never
 * touches `location` or `history`, and it never touches the DOM: the UI asks it
 * for a tab change and renders from `onTabChange`.
 *
 * It lives in `services/` rather than `state/` because it drives the layer
 * controller, the way the controller drives the SDK. The modules in `state/`
 * hold state and encode it; they depend on nothing.
 *
 * Responsibilities, all moved out of `createSidebar`:
 *
 * - **Active tab.** `start()` picks the first tab from the URL (falling back to
 *   `initialTab`), `setActiveTab()` switches it, and `onTabChange()` tells the
 *   UI to render.
 * - **One history entry per action.** A layer's first URL change pushes an
 *   entry; while that layer still has pending intent, the same action's later
 *   writes replace it (`actionEntryKeys`). Multi-layer changes run inside a
 *   batch that writes the URL once (`batch`), pushed for clear-all and
 *   replacing for restore and back/forward.
 * - **Reading URL state back.** `restoreFromUrl()` after the SDK is ready, and
 *   reconcile-from-URL on every external change the app recognises
 *   (`hashChangeAction`).
 *
 * Nothing runs on import. `destroy()` drops the store and adapter
 * subscriptions, destroys an adapter it created, and makes every method inert:
 * no lazy re-creation, and a MapX call that settles afterwards writes no URL.
 */
import { createHashAdapter } from "../state/hash-adapter.js";
import { changesUrlState, toUrlLayers } from "../state/layers-store.js";
import { clampSourceIdx } from "./layer-controller.js";

/**
 * Whether a layer has switchable sources. Same test as the layer controller's
 * and the widget registry's; kept local so the router imports no UI module.
 */
const hasSources = (layer) => Array.isArray(layer?.sources) && layer.sources.length > 0;

/**
 * Decide how a change to URL state should affect the app. Pure (it takes the
 * parsed state and the known tab ids), so any state adapter shares the rule.
 *
 * - "ignore": not an app state (empty, an in-page anchor such as a Mangrove
 *   tab section, or an unknown tab). Leave the tab and layers alone.
 * - "keep-layers": an info tab without layers (e.g. a plain `#sources` link).
 *   Info tabs don't show layers, so switch tab and keep the open layers.
 * - "reconcile": a data tab, or an info tab carrying layers (an entry the app
 *   wrote). Apply the tab and reconcile layers to match exactly.
 *
 * @param {{ tab: string|null, layers: Array }} parsed - adapter state
 * @param {{ dataTabs: string[], infoTabs: string[] }} tabs
 * @returns {"ignore"|"keep-layers"|"reconcile"}
 */
export function hashChangeAction({ tab, layers }, { dataTabs, infoTabs }) {
  if (infoTabs.includes(tab)) return layers.length > 0 ? "reconcile" : "keep-layers";
  if (dataTabs.includes(tab)) return "reconcile";
  return "ignore";
}

/**
 * Create a router.
 *
 * @param {object} deps
 * @param {ReturnType<import("../state/layers-store.js").createLayersStore>} deps.store
 * @param {ReturnType<import("./layer-controller.js").createLayerController>} deps.controller
 * @param {ReturnType<import("../config/registry.js").createLayerRegistry>} deps.registry -
 *   `byKey` for URL entries and `urlKeyOrder` for the order layers are written in
 * @param {object} [deps.adapter] - URL state adapter, owned by the caller; by
 *   default the router creates a hash adapter and destroys it with itself
 * @param {string[]} [deps.dataTabs] - tab ids that show layers
 * @param {string[]} [deps.infoTabs] - tab ids that show a full page instead
 * @param {string} [deps.initialTab] - the tab used when the URL names none (or
 *   an unknown one); default "home"
 * @param {() => boolean} [deps.isReady] - whether the map can accept layer
 *   changes yet; an external change is not reconciled before it can
 * @param {(layer: object) => boolean} [deps.isExternal] - whether a layer is a
 *   runtime external layer (its URL entry carries provider settings)
 * @param {() => Iterable<string>} [deps.layerKeys] - the layer keys the app can
 *   turn on (the sidebar's rows); URL entries for anything else are ignored
 * @returns {{
 *   start(): void,
 *   restoreFromUrl(): Promise<void>,
 *   setActiveTab(tabId: string): void,
 *   clearAll(): void,
 *   onTabChange(fn: (tabId: string) => void): () => void,
 *   destroy(): void,
 *   readonly activeTab: string|null,
 * }}
 */
export function createRouter({
  store,
  controller,
  registry,
  adapter: injectedAdapter,
  dataTabs = [],
  infoTabs = [],
  initialTab = "home",
  isReady = () => true,
  isExternal = () => false,
  layerKeys = () => [],
}) {
  const adapter = injectedAdapter ?? createHashAdapter();
  const ownsAdapter = !injectedAdapter;
  const allTabs = [...infoTabs, ...dataTabs];

  /** Store and adapter subscriptions, run in reverse on destroy. */
  const disposers = [];
  /** Tab-change listeners (the UI renders from these). */
  const tabListeners = new Set();
  /**
   * Depth of batched layer changes (restore, back/forward, clear-all). URL
   * writes inside a batch are skipped and replaced by one write when it ends,
   * so a multi-layer change creates at most one history entry.
   */
  let batchDepth = 0;
  /**
   * Layer keys whose current user action has pushed a history entry while
   * intent was still pending; that action's later writes replace the entry
   * (see syncLayerUrl).
   */
  const actionEntryKeys = new Set();
  /** The active tab, set by start(). Kept after destroy. */
  let activeTab = null;
  let destroyed = false;

  // The store runs its subscribers synchronously in subscription order, so
  // registering here (before the UI subscribes) is what makes the URL current
  // before the rows render the switches and the legend.
  disposers.push(
    store.subscribe((key, next, prev) => {
      if (changesUrlState(next, prev)) syncLayerUrl(key);
      else settleActionEntry(key);
    }),
  );

  // --- Writing -------------------------------------------------------------

  /**
   * Write current state (active tab + open layers) to the URL.
   * Runs from the store subscriber when what MapX shows changes (see
   * changesUrlState), and directly after a tab switch. Inside a batch nothing
   * is written; the batch writes the URL once when it ends.
   *
   * A failed write is logged here and a throwing subscriber is logged by the
   * store, so neither stops the UI from finishing its update.
   * @param {{ replace?: boolean }} [options] - replace the history entry instead of pushing
   * @returns {boolean} whether the URL state changed (an entry was pushed or replaced)
   */
  function writeUrl({ replace = false } = {}) {
    if (destroyed) return false;
    if (batchDepth > 0) return false;
    const layers = toUrlLayers(store.all(), registry.urlKeyOrder());
    const before = JSON.stringify(adapter.read());
    try {
      adapter.write({ tab: activeTab, layers }, { replace });
    } catch (error) {
      // e.g. SecurityError when the browser rate-limits history calls. The URL
      // falls behind until the next write; the map and panel stay correct.
      console.error("Could not write layer state to the URL:", error);
      return false;
    }
    const changed = JSON.stringify(adapter.read()) !== before;
    // A new entry belongs to a new action: later writes of earlier actions push.
    if (changed && !replace) actionEntryKeys.clear();
    return changed;
  }

  /**
   * Store subscriber's URL write for one layer's change, keeping one history
   * entry per user action on that layer.
   *
   * The first URL change of an action pushes an entry. If the layer still has
   * pending intent at that point (a second click or a newer source landed while
   * MapX was busy), the action is not over: the key is remembered and its later
   * writes replace that entry, until a write or record change finds its intent
   * applied. So a double-click (on, then off) makes one entry that ends where it
   * started, and quick A→B→C source picks make one entry ending on C, even when
   * B reaches the map first. Any other push (another layer, a tab switch, a
   * batch) or a back/forward navigation closes the open actions.
   */
  function syncLayerUrl(key) {
    const continuing = actionEntryKeys.has(key);
    const changed = writeUrl({ replace: continuing });
    settleActionEntry(key, changed);
  }

  /** Remember or forget a key's open action entry from its pending intent. */
  function settleActionEntry(key, pushed = false) {
    if (!controller?.hasPendingIntent(key)) actionEntryKeys.delete(key);
    else if (pushed) actionEntryKeys.add(key);
  }

  /**
   * Run a multi-layer change as one URL write: pushed for a user action
   * (clear-all), or replacing the current entry when restoring URL state.
   */
  async function batch(fn, { replace = false } = {}) {
    batchDepth++;
    try {
      await fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        actionEntryKeys.clear();
        writeUrl({ replace });
      }
    }
  }

  // --- Tabs ----------------------------------------------------------------

  /** Set the active tab, write the URL (unless told not to) and tell the UI. */
  function applyTab(tabId, { write = true, replace = false } = {}) {
    if (destroyed) return;
    activeTab = tabId;
    if (write) writeUrl({ replace });
    for (const listener of [...tabListeners]) listener(tabId);
  }

  // --- Reading -------------------------------------------------------------

  /**
   * Ask for a layer as a URL state entry describes it: on, with its (clamped)
   * source or its provider settings.
   */
  function intendFromUrl({ key, sourceIdx, settings }) {
    const layer = registry.byKey(key);
    const patch = { desired: true };
    if (hasSources(layer)) patch.sourceIdx = clampSourceIdx(layer, sourceIdx);
    if (isExternal(layer) && settings) patch.settings = settings;
    return controller.intend(key, patch);
  }

  /**
   * Reconcile layer intent against a parsed URL layers array.
   * Called on a URL change (back/forward) after initial load: layers not in the
   * URL are turned off, and those in it are asked for with their source or
   * settings. The controller works out what actually has to change.
   */
  async function reconcileLayersFromUrl(urlLayers) {
    const inUrl = new Set(urlLayers.map((entry) => entry.key));
    const known = new Set(layerKeys());
    const changes = [];

    for (const key of known) {
      const record = store.get(key);
      if (!inUrl.has(key) && (record.desired || record.applied)) {
        changes.push(controller.setOn(key, false));
      }
    }
    for (const entry of urlLayers) {
      if (known.has(entry.key)) changes.push(intendFromUrl(entry));
    }

    await Promise.all(changes);
  }

  /** An external change to URL state: back/forward, a link, a typed URL. */
  function onUrlChange(parsed) {
    if (destroyed) return;
    const action = hashChangeAction(parsed, { dataTabs, infoTabs });
    if (action === "ignore") return;
    // The user moved through history: no earlier action's entry may be replaced.
    actionEntryKeys.clear();
    if (parsed.tab !== activeTab) applyTab(parsed.tab, { write: false });
    if (action === "keep-layers") {
      // Rewrite the bare state in place so the entry still carries the layers.
      writeUrl({ replace: true });
    } else if (isReady()) {
      batch(() => reconcileLayersFromUrl(parsed.layers), { replace: true });
    }
  }

  return {
    /**
     * Show the first tab and start watching for external URL changes. Call
     * after the UI has subscribed with onTabChange().
     */
    start() {
      if (destroyed) return;
      const { tab: urlTab } = adapter.read();
      const known = Boolean(urlTab) && allTabs.includes(urlTab);
      const firstTab = known ? urlTab : allTabs.includes(initialTab) ? initialTab : "home";
      // Preserve a valid incoming URL until MapX is ready and can restore its
      // layers. Writing empty runtime state here would erase the shared link.
      applyTab(firstTab, { write: !known, replace: true });
      // Browser back/forward: reconcile both tab and layer state from the new
      // URL. The URL is already the target, so the tab switch must not write
      // the old layers back, and the reconcile only corrects the current entry
      // in place. States the app doesn't own (in-page anchors, unknown ids) are
      // ignored, and a bare info-tab state keeps the open layers.
      disposers.push(adapter.subscribe(onUrlChange));
    },

    /**
     * Restore layer state from the URL. Call after the SDK is ready.
     * Layers are requested in URL order, so MapX adds their views in that order.
     */
    async restoreFromUrl() {
      if (destroyed) {
        console.warn("restoreFromUrl: the sidebar is destroyed; nothing restored.");
        return;
      }
      const { layers } = adapter.read();
      if (layers.length === 0) return;
      const known = new Set(layerKeys());

      // The URL is only rewritten once, in place, after every layer settles.
      await batch(
        () =>
          Promise.all(
            layers.map((entry) => {
              if (!known.has(entry.key) || store.get(entry.key).desired) return null;
              return intendFromUrl(entry);
            }),
          ),
        { replace: true },
      );
    },

    /** A user switched tab: show it and push a history entry. */
    setActiveTab(tabId) {
      applyTab(tabId);
    },

    /** Turn every layer off as one user action, so it makes one history entry. */
    clearAll() {
      if (destroyed) return;
      batch(() => controller.clearAll());
    },

    /**
     * Render the active tab whenever it changes.
     * @param {(tabId: string) => void} fn
     * @returns {() => void} unsubscribe
     */
    onTabChange(fn) {
      tabListeners.add(fn);
      return () => tabListeners.delete(fn);
    },

    /** The active tab (the last one shown, after destroy). */
    get activeTab() {
      return activeTab;
    },

    /**
     * Retire the router: the store and URL subscriptions go, an adapter it
     * created is destroyed, and every method becomes inert. Nothing is
     * re-created, and a layer change that settles afterwards writes no URL.
     */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of disposers.splice(0).reverse()) dispose();
      tabListeners.clear();
      actionEntryKeys.clear();
      if (ownsAdapter) adapter.destroy();
    },
  };
}
