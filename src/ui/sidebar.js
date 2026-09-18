/**
 * Sidebar instance: composes the layers store, the layer controller, the
 * router, the nav, the info pages and the layer panel within one root element.
 *
 * `createSidebar(root, options)` finds its elements under `root` by `data-ui`
 * hooks, keeps all of its state (rows, tab panels, "Show disabled") in its
 * closure, and registers every listener with one AbortController. `destroy()`
 * removes the listeners, the rows, the controller, the router (with an adapter
 * it created) and the DOM it built.
 *
 * URL state lives in `src/services/router.js`: the active tab, the one
 * history-entry-per-action rule, restore and reconcile-from-URL. The sidebar
 * never reads or writes URL state; it asks the router for a tab and renders the
 * tab the router reports.
 */
import { TABS } from "../config/layers.js";
import { getLayerRegistry, urlKeyOrder } from "../config/registry.js";
import * as store from "../state/store.js";
import { viewAdd, viewRemove } from "../sdk/views.js";
import { isSDKReady, onSDKReadyChange } from "../sdk/client.js";
import { createMapWarming } from "./map-warming.js";
import { buildHomePanel } from "./home.js";
import { buildSourcesPanel, buildAboutPanel } from "./info-panels.js";
import { setGlobalFooterVisible } from "./global-footer.js";
import { initMangroveTabs } from "./mangrove-tabs.js";
import { createLayerAnnouncer } from "./announcer.js";
import { createLayerRow } from "./layer-row.js";
import { buildCrossTabSections, buildTabPanel, updateDisabledLayerVisibility } from "./layer-panel.js";
import { createNav, INFO_TABS } from "./nav.js";
import { makeDraggable, makeResizable, onPanelCollapse, onPanelExpand } from "../utils/panels.js";
import { createLayersStore, mirrorOpenViews } from "../state/layers-store.js";
import { createLayerController } from "../services/layer-controller.js";
import { createRouter } from "../services/router.js";
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
  skipLink: "skip-link",
};

/** Marks a sidebar root, so an outer instance can tell a nested one's parts from its own. */
const ROOT_ATTR = "data-ui-root";

/**
 * Create a sidebar within `root`.
 *
 * @param {ParentNode} root - contains the `data-ui` elements (see PARTS)
 * @param {object} [options]
 * @param {{ read: Function, write: Function, subscribe: Function, destroy: Function }} [options.stateAdapter] -
 *   URL state adapter, owned by the caller; by default the router creates a
 *   hash adapter and destroys it with itself
 * @param {ReturnType<typeof getLayerRegistry>} [options.registry] - layer
 *   lookups for the controller and the URL key order (default: the shared registry)
 * @param {object[]} [options.tabs] - data tabs to build (default: TABS); the
 *   registry must index the same layer objects
 * @param {(count: number) => void} [options.onViewsChanged] - called with the
 *   number of layers on the map whenever that number changes
 * @param {string} [options.initialTab] - the tab shown when URL state names
 *   none (or an unknown one); default "home"
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
  // The root's document: a Document is its own (its `ownerDocument` is null),
  // and a fragment's is the document it was created in.
  const rootDoc = root.ownerDocument ?? (root.nodeType === 9 ? root : document);
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
  // "Skip to map": re-pointed at the information page while that is the view,
  // because there is no map to skip to and its usual target is the invisible
  // warm-up region. It is the page's only bypass-blocks mechanism, so it stays.
  const skipLink = part("skipLink");

  // The map container's warm-up state, and everything that keeps the warming
  // map out of reach (see ui/map-warming.js).
  const mapWarming = appMap ? createMapWarming(appMap, { skipLink, infoTarget: infoPage }) : null;

  // Page state the instance changes, restored by destroy(): which view is
  // shown, the footer and the panel's collapsed state.
  const initialPage = {
    infoPageDisplay: infoPage?.style.display,
    footerHidden: globalFooter?.hidden,
    panelCollapsed: panel?.classList.contains("is-collapsed"),
  };

  const dataTabs = tabs.map((tab) => tab.id);
  // The layers this instance can turn on: the published, keyed layers of the
  // tabs it was given, in config order. The same walk the URL key order is
  // built from, so it is exactly the set of layers the rows cover — without
  // asking the rows, which are grouped by R2R category and built later.
  const urlKeys = urlKeyOrder(tabs);
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

  // Per-layer records: what the user asked for and what MapX shows. The layer
  // controller reconciles one into the other; `store.openViews`, the URL state
  // and the layer rows are derived from the records by subscribers.
  let layersStore = createLayersStore();

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

  // The only module that reads or writes URL state. It owns the active tab and
  // the one-history-entry-per-action rule; the sidebar renders what it reports.
  // It reads and writes nothing until attachTo() below.
  const router = createRouter({
    controller: layerController,
    registry,
    // An injected adapter belongs to the caller; the router creates and owns
    // one otherwise, and destroys it with itself.
    adapter: stateAdapter,
    dataTabs,
    infoTabs: INFO_TABS,
    initialTab,
    isReady: isSDKReady,
    isExternal: isExternalLayer,
    // Only published, keyed layers of the configured tabs can be turned on, so
    // only they are restored from, or reconciled against, URL state. Taken from
    // the config (the same walk the URL key order is built from) rather than
    // asking the UI which rows it built.
    layerKeys: () => urlKeys,
  });

  // Store subscribers, in the order the store calls them (it calls them
  // synchronously in subscription order), which is why these four lines are
  // adjacent and their order is the whole invariant:
  //   1. `store.openViews` must be current before anything reads it,
  //   2. the views-changed callback reports the new count,
  //   3. the router writes the URL,
  //   4. the rows render the switches, the slider and the legend.
  // The URL is therefore written before the rows update. It used to depend on
  // where `createRouter()` happened to sit; `attachTo` says it here instead.
  // See sidebar.order.test.js, which fails if 3 and 4 are swapped.
  disposers.push(mirrorOpenViews(layersStore, store.openViews));
  disposers.push(layersStore.subscribe(notifyViewsChanged));
  // Dropped by router.destroy(), which is a disposer below.
  router.attachTo(layersStore);
  disposers.push(layersStore.subscribe(renderLayerRows));

  // Layer switches are aria-disabled until the map can accept changes, so they
  // are re-rendered when it becomes (or stops being) ready.
  disposers.push(onSDKReadyChange(() => refreshLayerRows()));
  disposers.push(() => router.destroy());
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
  // One live region for the whole instance: a layer has a row in its own tab and
  // a compact row in every other tab, and each of them renders the same record,
  // so a region per row announced the same message several times. It is appended
  // to the root rather than to a panel, so it is never inside something hidden
  // (an information page replaces the map; a cross-tab section starts collapsed)
  // and can still speak. See announcer.js; the visible message stays per row.
  const announcer = createLayerAnnouncer(rootDoc);
  disposers.push(() => announcer.destroy());
  let showDisabledLayers = false;
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
      isVisible: () => router.activeTab === tabId,
      onNavigate: (target) => switchTab(target),
      // The home row's external controls announce failures of their own picks.
      selectionPending: () =>
        [...(rowsByKey.get(layer.key) ?? [])].some((other) => other.hasPendingSelection()),
      // Every row of a layer announces through the instance's one region, which
      // drops the repeats, so one event is heard once.
      announce: (message, record) => announcer.announce(layer.key, message, record),
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
    renderToggleState(false);
  }

  /**
   * Show a tab as a user action: the router writes URL state (one history
   * entry) and calls renderTab below.
   */
  function switchTab(tabId) {
    router.setActiveTab(tabId);
  }

  /**
   * The router's tab-change subscriber: render the tab it made active. It is
   * the only place the sidebar reacts to a tab change, so a switch, a home
   * card, a nav link and a back/forward navigation all render the same way.
   */
  function renderTab(tabId) {
    if (destroyed) return;
    const isInfoTab = INFO_TABS.includes(tabId);

    // Toggle map vs full-page info view. Where it is worth its cost the map is
    // not hidden behind an information page but kept laid out and loading,
    // transparent and inert; where it is not, it is hidden as it used to be.
    // ui/map-warming.js owns that choice and the invariants that go with it.
    mapWarming?.set(isInfoTab);
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

  // --- Build ---------------------------------------------------------------

  const append = (parent, el) => {
    parent.appendChild(el);
    createdElements.push(el);
    return el;
  };

  // Collapse / expand sidebar — clear/restore inline resize dimensions so the
  // collapsed CSS width isn't overridden by a prior user resize.
  /** Keep the collapse control telling the truth about what it does next. */
  function renderToggleState(collapsed) {
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand the layers panel" : "Collapse the layers panel");
  }

  toggle?.addEventListener(
    "click",
    () => {
      if (!panel) return;
      if (panel.classList.contains("is-collapsed")) {
        panel.classList.remove("is-collapsed");
        onPanelExpand(panel);
        renderToggleState(false);
      } else {
        onPanelCollapse(panel);
        panel.classList.add("is-collapsed");
        renderToggleState(true);
      }
    },
    { signal },
  );
  renderToggleState(Boolean(panel?.classList.contains("is-collapsed")));

  // "Clear all" turns off every layer that is on or still loading, across all tabs
  clearBtn?.addEventListener(
    "click",
    () => {
      if (destroyed) return;
      // The router batches; the sidebar drives the layers.
      router.asOneEntry(() => layerController.clearAll());
    },
    { signal },
  );

  // A Mangrove switch (a checkbox): its own state is the setting, and its
  // label stays "Show disabled" whichever way it is set.
  disabledToggleBtn?.addEventListener(
    "change",
    () => {
      showDisabledLayers = Boolean(disabledToggleBtn.checked);
      applyDisabledLayerVisibility();
    },
    { signal },
  );

  // The instance's live region, at the end of its root — or of the root's
  // `<body>` when the root is not an element (a document or a fragment), never
  // of the layer panel: the panel sits inside `#app-map`, which an information
  // page hides, and a region inside something hidden is never announced, which
  // is the silent behaviour this region exists to fix. Visually hidden, and
  // removed by announcer.destroy().
  (rootEl ?? rootDoc.body ?? sidebarBody).appendChild(announcer.element);

  // Populate info page with all info panels
  if (infoPage) {
    infoPanels.set("home", append(infoPage, buildHomePanel({ tabs, onNavigate: navigateTo, signal })));
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
        if (source === "tab" && panel?.classList.contains("is-collapsed")) expandPanel();
      },
    });
  }

  // Everything the sidebar renders now exists: show the tab the router picks
  // from URL state (or the initialTab option) and let it watch for external
  // changes (back/forward, links, typed URLs).
  router.onTabChange(renderTab);
  router.start();

  // Make the layer panel draggable and resizable
  if (panel) {
    makeDraggable(panel, panel.querySelector(".layer-panel-header"), { signal });
    makeResizable(panel, { signal });
  }

  /**
   * Tear down the instance: every listener (nav, panel toggle and drag/resize,
   * Clear all, Show disabled, home cards, Sources), the store subscriptions,
   * the layer rows, the controller, the router (with the hash adapter it
   * created; an injected adapter belongs to the caller), and the
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
    mapWarming?.destroy();
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
    if (disabledToggleBtn) disabledToggleBtn.checked = false;
    // The collapse control's ARIA and label describe the panel's state, so
    // they have to be restored with it, not left saying "Expand" over a panel
    // that is open.
    renderToggleState(Boolean(panel?.classList.contains("is-collapsed")));
    layersStore = null;
    layerController = null;
    if (marksRoot) rootEl.removeAttribute(ROOT_ATTR);
  }

  return {
    /** Restore the layers in URL state. Call after the SDK is ready. */
    restoreFromUrl: () => router.restoreFromUrl(),
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
      return router.activeTab;
    },
  };
}
