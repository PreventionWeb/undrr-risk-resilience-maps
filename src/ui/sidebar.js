/**
 * Sidebar instance: composes the layers store, the layer controller, URL sync,
 * the nav, the info pages and the layer panel within one root element.
 *
 * `createSidebar(root, options)` finds its elements under `root` by `data-ui`
 * hooks, keeps all of its state (rows, tab panels, history-entry keys, batch
 * depth, "Show disabled") in its closure, and registers every listener with
 * one AbortController. `destroy()` removes the listeners, the rows, the
 * controller, an adapter it created and the DOM it built.
 */
import { TABS } from "../config/layers.js";
import { getLayerRegistry } from "../config/registry.js";
import * as store from "../state/store.js";
import { viewAdd, viewRemove } from "../sdk/views.js";
import { isSDKReady } from "../sdk/client.js";
import { buildHomePanel } from "./home.js";
import { buildSourcesPanel, buildAboutPanel } from "./info-panels.js";
import { setGlobalFooterVisible } from "./global-footer.js";
import { initMangroveTabs } from "./mangrove-tabs.js";
import { isCompound } from "./widgets/index.js";
import { createLayerRow } from "./layer-row.js";
import { buildCrossTabSections, buildTabPanel, updateDisabledLayerVisibility } from "./layer-panel.js";
import { createNav, INFO_TABS } from "./nav.js";
import { makeDraggable, makeResizable, onPanelCollapse, onPanelExpand } from "../utils/panels.js";
import { hashChangeAction } from "../state/hash.js";
import { createHashAdapter } from "../state/hash-adapter.js";
import { changesUrlState, createLayersStore, mirrorOpenViews, toUrlLayers } from "../state/layers-store.js";
import { clampSourceIdx, createLayerController } from "../services/layer-controller.js";
import { isLayerAvailable } from "../config/layers/status.js";
import {
  closeExternalLayer,
  getExternalLayerRuntime,
  isExternalLayer,
  openExternalLayer,
  replaceExternalLayer,
} from "../external/index.js";

/**
 * The elements a sidebar uses, by their `data-ui` hook under the root. Only
 * the panel body is required; a missing optional element's feature is skipped.
 */
const PARTS = {
  nav: "nav",
  infoPage: "info-page",
  appMap: "app-map",
  panel: "layer-panel",
  panelBody: "panel-body",
  toggle: "panel-toggle",
  clearBtn: "clear-layers",
  disabledToggleBtn: "show-disabled",
  globalFooter: "global-footer",
};

/** Marks a sidebar root, so an outer instance can tell a nested one's parts from its own. */
const ROOT_ATTR = "data-ui-root";

/**
 * Create a sidebar within `root`.
 *
 * @param {ParentNode} root - contains the `data-ui` elements (see PARTS)
 * @param {object} [options]
 * @param {ReturnType<typeof createHashAdapter>} [options.stateAdapter] - URL
 *   state adapter, owned by the caller; by default the sidebar creates a hash
 *   adapter and destroys it with itself
 * @param {ReturnType<typeof getLayerRegistry>} [options.registry] - layer
 *   lookups for the controller and the hash order (default: the shared registry)
 * @param {object[]} [options.tabs] - data tabs to build (default: TABS); the
 *   registry must index the same layer objects
 * @param {(count: number) => void} [options.onViewsChanged] - called with the
 *   number of layers on the map whenever that number changes
 * @param {string} [options.initialTab] - the tab shown when the URL names none
 *   (or an unknown one); default "home"
 * @returns {{
 *   restoreFromUrl(): Promise<void>,
 *   showTab(tabId: string): void,
 *   destroy(): void,
 *   readonly store: ReturnType<typeof createLayersStore>|null,
 *   readonly controller: ReturnType<typeof createLayerController>|null,
 *   readonly activeTab: string,
 * }}
 */
export function createSidebar(
  root,
  { stateAdapter, registry = getLayerRegistry(), tabs = TABS, onViewsChanged, initialTab = "home" } = {},
) {
  // The root is marked `data-ui-root`, and a part belongs to the nearest marked
  // ancestor, so an instance skips the parts of an instance nested inside its
  // root. That holds once the nested root is marked: create (or mark) the
  // nested instance first. A root that is not an element (a document) owns
  // the parts outside every marked root.
  const rootEl = root instanceof Element ? root : null;
  const marksRoot = Boolean(rootEl) && !rootEl.hasAttribute(ROOT_ATTR);
  if (marksRoot) rootEl.setAttribute(ROOT_ATTR, "");
  const part = (name) =>
    [...root.querySelectorAll(`[data-ui="${PARTS[name]}"]`)].find(
      (el) => el.closest(`[${ROOT_ATTR}]`) === rootEl,
    );
  const sidebarBody = part("panelBody");
  if (!sidebarBody) {
    if (marksRoot) rootEl.removeAttribute(ROOT_ATTR);
    throw new Error('createSidebar: no [data-ui="panel-body"] element under the root');
  }
  const panel = part("panel");
  const toggle = part("toggle");
  const infoPage = part("infoPage");
  const appMap = part("appMap");
  const clearBtn = part("clearBtn");
  const disabledToggleBtn = part("disabledToggleBtn");
  const navRoot = part("nav");
  const globalFooter = part("globalFooter");

  // Page state the instance changes, restored by destroy(): which view is
  // shown, the footer and the panel's collapsed state.
  const initialPage = {
    appMapDisplay: appMap?.style.display,
    infoPageDisplay: infoPage?.style.display,
    footerHidden: globalFooter?.hidden,
    panelCollapsed: panel?.classList.contains("is-collapsed"),
  };

  const dataTabs = tabs.map((tab) => tab.id);
  const allTabs = [...INFO_TABS, ...dataTabs];

  // Every listener this instance adds, directly or through nav, panels, pages
  // and rows, is removed by aborting this.
  const lifetime = new AbortController();
  const { signal } = lifetime;
  // Store subscriptions, the URL subscription and owned resources, run in
  // reverse on destroy.
  const disposers = [];
  let destroyed = false;

  // --- State ---------------------------------------------------------------

  // The new store starts empty, so drop view ids a previous instance (HMR,
  // tests) left in the compatibility Set.
  store.openViews.clear();
  // Reads, writes and watches URL state (the hash, in the standalone app).
  const adapter = stateAdapter ?? createHashAdapter();
  if (!stateAdapter) disposers.push(() => adapter.destroy());

  // Per-layer records: what the user asked for and what MapX shows. The layer
  // controller reconciles one into the other; `store.openViews`, the URL hash
  // and the layer rows are derived from the records by subscribers.
  let layersStore = createLayersStore();
  // Subscriber order matters: openViews must be current before the
  // views-changed callback and the hash sync run.
  disposers.push(mirrorOpenViews(layersStore, store.openViews));
  disposers.push(layersStore.subscribe(notifyViewsChanged));
  disposers.push(
    layersStore.subscribe((key, next, prev) => {
      if (changesUrlState(next, prev)) syncLayerHash(key);
      else settleActionEntry(key);
    }),
  );
  disposers.push(layersStore.subscribe(renderLayerRows));

  let layerController = createLayerController({
    store: layersStore,
    // Published layers only: they are the ones with rows.
    getLayer: (key) => {
      const layer = registry.byKey(key);
      return layer && isLayerAvailable(layer) ? layer : undefined;
    },
    views: { add: viewAdd, remove: viewRemove },
    external: {
      isExternal: isExternalLayer,
      getRuntime: getExternalLayerRuntime,
      open: openExternalLayer,
      close: closeExternalLayer,
      replace: replaceExternalLayer,
    },
    onError: (key, error, action) => console.warn(`Layer "${key}": ${action} failed:`, error),
  });
  // Runs first on destroy (disposers run in reverse), so a MapX call that
  // settles afterwards is dropped before anything else is torn down.
  const controllerToDestroy = layerController;
  disposers.push(() => controllerToDestroy.destroy());

  // The layer rows (see createLayerRow): every row built, for destroy, and the
  // published rows by layer key (the home row first, then its cross-tab rows),
  // which the store subscriber fans records out to. Filled in sidebar row order
  // (grouped tabs list rows by R2R category), so it is not the hash order; that
  // is the registry's urlKeyOrder().
  const allRows = [];
  const rowsByKey = new Map();
  /** Layer keys addLayerRow has already warned about, so each is reported once. */
  const rowKeysWarned = new Set();
  // Panels this instance built, by tab id, and every element it appended.
  const tabPanels = new Map();
  const infoPanels = new Map();
  const createdElements = [];
  let showDisabledLayers = false;
  // Depth of batched layer changes (restore, back/forward, clear-all). Hash
  // writes inside a batch are skipped and replaced by one write when it ends,
  // so a multi-layer change creates at most one history entry.
  let hashBatchDepth = 0;
  // Layer keys whose current user action has pushed a history entry while
  // intent was still pending; that action's later hash writes replace the
  // entry (see syncLayerHash).
  const actionEntryKeys = new Set();
  // The shown tab, set by the first switchTab below.
  let activeTab = null;
  // Active-state and click wiring for the nav links (created after the panels).
  let nav = null;

  // --- Rows ----------------------------------------------------------------

  /**
   * Store subscriber: hand a layer's record to each of its rows (they render
   * themselves from it, see createLayerRow), then update "Clear all".
   */
  function renderLayerRows(key, next, prev) {
    for (const row of rowsByKey.get(key) ?? []) row.update(next);
    if (next.desired !== prev.desired || next.applied !== prev.applied) updateClearBtn();
  }

  /**
   * Re-render every row from its record, after a tab switch. Rows are
   * idempotent, so this only builds the slider and legend of rows that just
   * became visible and have not rendered their layer's current view yet.
   */
  function refreshLayerRows() {
    if (!layersStore) return;
    for (const [key, rows] of rowsByKey) {
      const record = layersStore.get(key);
      for (const row of rows) row.update(record);
    }
  }

  /**
   * The controller looks layers up in the registry, so a published row for a
   * layer object that is not the registry's (not in its tabs, or a copy)
   * cannot turn anything on: its switch ends in an error. Say so during
   * development instead of leaving it to be found by clicking.
   */
  function warnIfNotInConfig(layer) {
    if (!layer.key || !isLayerAvailable(layer) || rowKeysWarned.has(layer.key)) return;
    if (registry.byKey(layer.key) === layer) return;
    rowKeysWarned.add(layer.key);
    console.warn(
      `Layer row "${layer.key}" is not the layer config's entry for that key; the controller will not find it, so its switch cannot turn it on.`,
    );
  }

  /**
   * Create a layer row wired to this instance's store and controller, and
   * register it for record updates and destroy.
   * @param {object} layer
   * @param {"full"|"compact"} variant
   * @param {string} tabId - the tab panel the row is in (its slider and legend
   *   render only while that tab is shown)
   */
  function addLayerRow(layer, variant, tabId) {
    warnIfNotInConfig(layer);
    const row = createLayerRow(layer, {
      variant,
      store: layersStore,
      controller: layerController,
      isReady: isSDKReady,
      isVisible: () => activeTab === tabId,
      onNavigate: (target) => switchTab(target),
      // The home row's external controls announce failures of their own picks.
      selectionPending: () =>
        [...(rowsByKey.get(layer.key) ?? [])].some((other) => other.hasPendingSelection()),
    });
    allRows.push(row);
    if (isLayerAvailable(layer) && layer.key) {
      if (!rowsByKey.has(layer.key)) rowsByKey.set(layer.key, new Set());
      rowsByKey.get(layer.key).add(row);
    }
    return row;
  }

  // --- Tabs and panels -----------------------------------------------------

  function expandPanel() {
    if (!panel) return;
    panel.classList.remove("is-collapsed");
    onPanelExpand(panel);
  }

  function switchTab(tabId, { syncHash = true, replaceHash = false } = {}) {
    if (destroyed) return;
    activeTab = tabId;
    if (syncHash) syncHashFromState({ replace: replaceHash });

    const isInfoTab = INFO_TABS.includes(tabId);

    // Toggle map vs full-page info view
    if (appMap) appMap.style.display = isInfoTab ? "none" : "";
    if (infoPage) infoPage.style.display = isInfoTab ? "block" : "none";

    // The UNDRR global footer belongs to the content pages; the map view is
    // full-bleed. The syndication widget populates it independently.
    if (globalFooter) setGlobalFooterVisible(isInfoTab, globalFooter);

    nav?.setActive(tabId);

    if (isInfoTab) {
      // Show the right info panel, hide the others
      for (const [id, el] of infoPanels) el.style.display = id === tabId ? "block" : "none";
    } else {
      // Show the right layer panel in the sidebar, hide the others
      for (const [id, el] of tabPanels) el.style.display = id === tabId ? "block" : "none";
      refreshLayerRows();
    }
  }

  /** Open a tab from the home page's cards (and showTab()): switch and expand the panel. */
  function navigateTo(tabId) {
    if (!tabId || !allTabs.includes(tabId)) return;
    switchTab(tabId);
    expandPanel();
  }

  function applyDisabledLayerVisibility() {
    for (const tab of tabs) {
      const tabPanel = tabPanels.get(tab.id);
      if (tabPanel) updateDisabledLayerVisibility(tabPanel, tab, showDisabledLayers);
    }
  }

  /**
   * Show "Clear all" while any layer is on or asked to be on. It follows intent
   * as well as the map so a layer that is still loading can be cleared, and it
   * stays while a failing turn-off leaves a layer on. It does not report views;
   * see notifyViewsChanged.
   */
  function updateClearBtn() {
    if (clearBtn && layersStore) {
      clearBtn.hidden = !layersStore.all().some((record) => record.desired || record.applied);
    }
  }

  /**
   * Store subscriber: tell `onViewsChanged` how many layers are on the map,
   * whenever that number changes (a layer's `applied` flips). Intent alone
   * never fires it, and neither does a source switch: the layer stays on
   * through the gap between its old and new view, so a switch cannot report 0
   * while a layer is on (which would disable inspect mode).
   */
  function notifyViewsChanged(_key, next, prev) {
    if (next.applied === prev.applied || !onViewsChanged || !layersStore) return;
    onViewsChanged(layersStore.all().filter((record) => record.applied).length);
  }

  // --- URL sync ------------------------------------------------------------

  /**
   * Write current state (active tab + open layers) to the URL.
   * Runs from the layers-store subscriber when what MapX shows changes (see
   * changesUrlState), and directly after a tab switch. Inside a batch nothing
   * is written; the batch writes the URL once when it ends.
   *
   * The store runs its subscribers synchronously in subscription order, so the
   * URL is written before the rows update the switches and legend. A failed
   * write is logged here and a throwing subscriber is logged by the store, so
   * neither stops the panel from finishing its update.
   * @param {{ replace?: boolean }} [options] - replace the history entry instead of pushing
   * @returns {boolean} whether the URL state changed (an entry was pushed or replaced)
   */
  function syncHashFromState({ replace = false } = {}) {
    if (!layersStore) return false; // destroyed
    if (hashBatchDepth > 0) return false;
    const layers = toUrlLayers(layersStore.all(), registry.urlKeyOrder());
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
  function syncLayerHash(key) {
    const continuing = actionEntryKeys.has(key);
    const changed = syncHashFromState({ replace: continuing });
    settleActionEntry(key, changed);
  }

  /** Remember or forget a key's open action entry from its pending intent. */
  function settleActionEntry(key, pushed = false) {
    if (!layerController?.hasPendingIntent(key)) actionEntryKeys.delete(key);
    else if (pushed) actionEntryKeys.add(key);
  }

  /**
   * Run a multi-layer change as one URL write: pushed for a user action
   * (clear-all), or replacing the current entry when restoring URL state.
   */
  async function batchHashWrites(fn, { replace = false } = {}) {
    hashBatchDepth++;
    try {
      await fn();
    } finally {
      hashBatchDepth--;
      if (hashBatchDepth === 0) {
        actionEntryKeys.clear();
        syncHashFromState({ replace });
      }
    }
  }

  /**
   * Ask for a layer as a URL state entry describes it: on, with its (clamped)
   * source or its provider settings.
   */
  function intendFromUrl({ key, sourceIdx, settings }) {
    const layer = registry.byKey(key);
    const patch = { desired: true };
    if (isCompound(layer)) patch.sourceIdx = clampSourceIdx(layer, sourceIdx);
    if (isExternalLayer(layer) && settings) patch.settings = settings;
    return layerController.intend(key, patch);
  }

  /**
   * Reconcile layer intent against a parsed URL layers array.
   * Called on a URL change (back/forward) after initial load: layers not in the
   * URL are turned off, and those in it are asked for with their source or
   * settings. The controller works out what actually has to change.
   */
  async function reconcileLayersFromUrl(urlLayers) {
    const inUrl = new Set(urlLayers.map((entry) => entry.key));
    const changes = [];

    for (const key of rowsByKey.keys()) {
      const record = layersStore.get(key);
      if (!inUrl.has(key) && (record.desired || record.applied)) {
        changes.push(layerController.setOn(key, false));
      }
    }
    for (const entry of urlLayers) {
      if (rowsByKey.has(entry.key)) changes.push(intendFromUrl(entry));
    }

    await Promise.all(changes);
  }

  /**
   * Restore layer state from the URL. Call after the SDK is ready.
   * Layers are requested in URL order, so MapX adds their views in that order.
   */
  async function restoreFromUrl() {
    if (destroyed) {
      console.warn("restoreFromUrl: the sidebar is destroyed; nothing restored.");
      return;
    }
    const { layers } = adapter.read();
    if (layers.length === 0) return;

    // The URL is only rewritten once, in place, after every layer settles.
    await batchHashWrites(
      () =>
        Promise.all(
          layers.map((entry) => {
            if (!rowsByKey.has(entry.key) || layersStore.get(entry.key).desired) return null;
            return intendFromUrl(entry);
          }),
        ),
      { replace: true },
    );
  }

  // --- Build ---------------------------------------------------------------

  const append = (parent, el) => {
    parent.appendChild(el);
    createdElements.push(el);
    return el;
  };

  // Collapse / expand sidebar — clear/restore inline resize dimensions so the
  // collapsed CSS width isn't overridden by a prior user resize.
  toggle?.addEventListener(
    "click",
    () => {
      if (!panel) return;
      if (panel.classList.contains("is-collapsed")) {
        panel.classList.remove("is-collapsed");
        onPanelExpand(panel);
      } else {
        onPanelCollapse(panel);
        panel.classList.add("is-collapsed");
      }
    },
    { signal },
  );

  // "Clear all" turns off every layer that is on or still loading, across all tabs
  clearBtn?.addEventListener(
    "click",
    () => {
      if (destroyed) return;
      const controller = layerController;
      batchHashWrites(() => controller.clearAll());
    },
    { signal },
  );

  disabledToggleBtn?.addEventListener(
    "click",
    () => {
      showDisabledLayers = !showDisabledLayers;
      disabledToggleBtn.setAttribute("aria-pressed", String(showDisabledLayers));
      disabledToggleBtn.textContent = showDisabledLayers ? "Hide disabled" : "Show disabled";
      applyDisabledLayerVisibility();
    },
    { signal },
  );

  // Populate info page with all info panels
  if (infoPage) {
    infoPanels.set("home", append(infoPage, buildHomePanel({ onNavigate: navigateTo, signal })));
    infoPanels.set("sources", append(infoPage, buildSourcesPanel({ signal })));
    infoPanels.set("about", append(infoPage, buildAboutPanel()));

    // Mangrove's tabs script only auto-initialises on DOMContentLoaded, which
    // has already fired by the time these panels exist. Enhancement is
    // optional, so the promise is not awaited. Aborting the signal runs
    // Mangrove's destroy, which removes its window and font listeners; destroy()
    // aborts before removing the panels, so Mangrove still finds its containers.
    void initMangroveTabs(infoPage, { signal });
  }

  // Populate sidebar with layer panels (data tabs only)
  for (const tab of tabs) {
    const tabPanel = buildTabPanel(tab, {
      addRow: addLayerRow,
      showDisabled: showDisabledLayers,
    });
    tabPanels.set(tab.id, append(sidebarBody, tabPanel));
  }

  applyDisabledLayerVisibility();

  // Second pass: append collapsed cross-tab sections to each tab panel, so a
  // layer's home row comes first among its rows.
  for (const tab of tabs) {
    tabPanels.get(tab.id).appendChild(buildCrossTabSections(tab, tabs, { addRow: addLayerRow }));
  }

  if (navRoot) {
    nav = createNav(navRoot, {
      tabs,
      signal,
      onSelect: (tabId, source) => {
        switchTab(tabId);
        // A category link expands the panel if it is collapsed.
        if (source === "tab") panel?.classList.remove("is-collapsed");
      },
    });
  }

  // Read the initial tab from the URL, falling back to the initialTab option.
  const { tab: urlTab } = adapter.read();
  const firstTab =
    urlTab && allTabs.includes(urlTab) ? urlTab : allTabs.includes(initialTab) ? initialTab : "home";
  // Preserve a valid incoming URL until MapX is ready and can restore its
  // layers. Writing empty runtime state here would erase the shared link.
  switchTab(firstTab, { syncHash: !urlTab || !allTabs.includes(urlTab), replaceHash: true });

  // Browser back/forward: reconcile both tab and layer state from the new URL.
  // The URL is already the target, so the tab switch must not write the old
  // layers back, and the reconcile only corrects the current entry in place.
  // States the app doesn't own (in-page anchors, unknown ids) are ignored, and
  // a bare info-tab state (e.g. an `href="#sources"` link) keeps the open layers.
  disposers.push(
    adapter.subscribe((parsed) => {
      if (destroyed) return;
      const action = hashChangeAction(parsed, { dataTabs, infoTabs: INFO_TABS });
      if (action === "ignore") return;
      // The user moved through history: no earlier action's entry may be replaced.
      actionEntryKeys.clear();
      if (parsed.tab !== activeTab) switchTab(parsed.tab, { syncHash: false });
      if (action === "keep-layers") {
        // Rewrite the bare state in place so the entry still carries the layers.
        syncHashFromState({ replace: true });
      } else if (isSDKReady()) {
        batchHashWrites(() => reconcileLayersFromUrl(parsed.layers), { replace: true });
      }
    }),
  );

  // Make the layer panel draggable and resizable
  if (panel) {
    makeDraggable(panel, panel.querySelector(".layer-panel-header"), { signal });
    makeResizable(panel, { signal });
  }

  /**
   * Tear down the instance: every listener (nav, panel toggle and drag/resize,
   * Clear all, Show disabled, home cards, Sources), the URL subscription, the
   * store subscriptions, the layer rows, the controller, the hash adapter if
   * the sidebar created it (an injected adapter belongs to the caller), and the
   * DOM it built (info pages, tab panels, generated nav links, resize grip).
   *
   * Afterwards `store` and `controller` are null and nothing is re-created:
   * clicks on old elements, tab switches, clear-all and restoreFromUrl() (which
   * warns) do nothing. A MapX call that settles after destroy, or after a new
   * instance is created, is dropped: the old controller writes nothing to the
   * old or new store, openViews, the URL or the rows, and starts no further
   * MapX calls for intent still pending (a view MapX already added is not
   * removed).
   */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const dispose of disposers.splice(0).reverse()) dispose();
    lifetime.abort();
    for (const row of allRows.splice(0)) row.destroy();
    rowsByKey.clear();
    nav?.destroy();
    for (const el of createdElements.splice(0)) el.remove();
    tabPanels.clear();
    infoPanels.clear();
    // Leave the page and the static controls as they were before the instance,
    // for the next one (nav.destroy() restores the links' active state).
    if (appMap) appMap.style.display = initialPage.appMapDisplay;
    if (infoPage) infoPage.style.display = initialPage.infoPageDisplay;
    if (globalFooter) globalFooter.hidden = initialPage.footerHidden;
    if (panel && panel.classList.contains("is-collapsed") !== initialPage.panelCollapsed) {
      if (initialPage.panelCollapsed) {
        onPanelCollapse(panel);
        panel.classList.add("is-collapsed");
      } else {
        panel.classList.remove("is-collapsed");
        onPanelExpand(panel);
      }
    }
    if (clearBtn) clearBtn.hidden = true;
    if (disabledToggleBtn) {
      disabledToggleBtn.setAttribute("aria-pressed", "false");
      disabledToggleBtn.textContent = "Show disabled";
    }
    layersStore = null;
    layerController = null;
    if (marksRoot) rootEl.removeAttribute(ROOT_ATTR);
  }

  return {
    restoreFromUrl,
    /**
     * Open a tab as a home card does: switch to it and expand the layer panel.
     * The app itself navigates through the nav and home cards; this is the seam
     * for tests and future embeds (`createRiskMap`).
     */
    showTab: navigateTo,
    destroy,
    /** The layers store (null after destroy). */
    get store() {
      return layersStore;
    },
    /** The layer controller (null after destroy). */
    get controller() {
      return layerController;
    },
    /** The shown tab id (the last one shown, after destroy). */
    get activeTab() {
      return activeTab;
    },
  };
}
