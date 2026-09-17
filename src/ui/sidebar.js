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

let _viewsChangeCallback = null;

/**
 * Register a callback invoked with the number of layers on the map whenever
 * that number changes (see notifyViewsChanged).
 */
export function onViewsChanged(fn) {
  _viewsChangeCallback = fn;
}

const INFO_TABS = ["home", "sources", "about"];

// All valid tab IDs for hash routing
const DATA_TABS = TABS.map((tab) => tab.id);
const ALL_TABS = [...INFO_TABS, ...DATA_TABS];

// Per-layer records: what the user asked for and what MapX shows. The layer
// controller reconciles one into the other; `store.openViews`, the URL hash and
// the layer rows are derived from the records by subscribers. The store and
// controller are created by buildSidebar(), never on import (see
// getLayersStore, getLayerController and destroySidebar for the lifecycle).
let layersStore = null;
let layerController = null;
// Reads, writes and watches URL state (the hash, in the standalone app). Only
// buildSidebar() sets it.
let stateAdapter = null;
// Set by destroySidebar() and cleared by buildSidebar(): nothing is re-created lazily in between.
let destroyed = false;
// Undo initLayerState()/buildSidebar() subscriptions and listeners (see destroySidebar).
let disposers = [];

// The layer rows (see createLayerRow): every row built, for destroy, and the
// published rows by layer key (the home row first, then its cross-tab rows),
// which the store subscriber fans records out to. Filled in sidebar row order
// (grouped tabs list rows by R2R category), so it is not the hash order; that
// is the registry's urlKeyOrder().
const allRows = [];
const rowsByKey = new Map();
let showDisabledLayers = false;
// Depth of batched layer changes (restore, back/forward, clear-all). Hash
// writes inside a batch are skipped and replaced by one write when it ends,
// so a multi-layer change creates at most one history entry.
let hashBatchDepth = 0;
// Layer keys whose current user action has pushed a history entry while intent
// was still pending; that action's later hash writes replace the entry (see
// syncLayerHash).
const actionEntryKeys = new Set();

/**
 * Create the layers store, layer controller and URL adapter, and derive
 * openViews, the hash and the layer rows from the store. Replaces any previous
 * instance and its subscriptions.
 * @param {ReturnType<typeof createHashAdapter>} [adapter] - injected adapter,
 *   owned by the caller; the default hash adapter is owned and destroyed here
 * @param {{ url?: boolean }} [options] - `url: false` creates no adapter, so
 *   nothing reads or writes the URL (a store used before any buildSidebar())
 */
function initLayerState(adapter, { url = true } = {}) {
  destroySidebar();
  destroyed = false;
  // The new store starts empty, so drop view ids a previous build (HMR, tests)
  // left in the compatibility Set.
  store.openViews.clear();
  actionEntryKeys.clear();
  if (url) {
    stateAdapter = adapter ?? createHashAdapter();
    if (!adapter) disposers.push(() => stateAdapter.destroy());
  }
  layersStore = createLayersStore();
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
  const registry = getLayerRegistry();
  layerController = createLayerController({
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
  const controller = layerController;
  disposers.push(() => controller.destroy());
}

/**
 * The layers store the sidebar writes to (for tests and readers).
 *
 * Normally created by buildSidebar(). Rows built with buildLayerAccordion()
 * before any buildSidebar() (unit use) get a store on first use, without a URL
 * adapter, so they never touch the URL. After destroySidebar() this returns
 * null until the next buildSidebar().
 * @returns {ReturnType<typeof createLayersStore>|null}
 */
export function getLayersStore() {
  if (!layersStore && !destroyed) initLayerState(null, { url: false });
  return layersStore;
}

/**
 * The controller that applies layer changes to the map. Created with the store
 * (see getLayersStore): lazily and without a URL adapter only before any
 * buildSidebar(), and null after destroySidebar() until the next buildSidebar().
 * @returns {ReturnType<typeof createLayerController>|null}
 */
export function getLayerController() {
  if (!layerController && !destroyed) initLayerState(null, { url: false });
  return layerController;
}

/**
 * Tear down what buildSidebar() set up: the URL listener, the store
 * subscriptions (openViews mirror, hash sync, row fan-out), the layer rows, the layer
 * controller, and the hash adapter if the sidebar created it (an injected
 * adapter belongs to the caller and is not destroyed).
 *
 * Lifecycle rule: after destroySidebar() and until the next buildSidebar(),
 * getLayersStore() and getLayerController() return null and the sidebar's
 * entry points do nothing: switch and header clicks, clear-all, source and
 * variant changes, tab-switch hash writes, and restoreLayersFromHash() (which
 * warns). Nothing is re-created lazily, and the URL adapter is only ever
 * created by buildSidebar(). A MapX call that settles after destroy, or after
 * a rebuild, is dropped: the old controller writes nothing to the old or new
 * store, openViews, the URL or the rows, and starts no further MapX calls for
 * intent still pending (a view MapX already added is not removed).
 *
 * Every layer row is destroyed (its listeners removed). The DOM, and the nav,
 * panel and `navigate-tab` listeners that predate the store, are not removed yet.
 */
export function destroySidebar() {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  for (const row of allRows.splice(0)) row.destroy();
  rowsByKey.clear();
  layersStore = null;
  layerController = null;
  stateAdapter = null;
  destroyed = true;
}

/**
 * Store subscriber: hand a layer's record to each of its rows (they render
 * themselves from it, see createLayerRow), then update "Clear all".
 */
function renderLayerRows(key, next, prev) {
  for (const row of rowsByKey.get(key) ?? []) row.update(next);
  if (next.desired !== prev.desired || next.applied !== prev.applied) updateClearBtn();
}

/**
 * Re-render every row from its record, after a tab switch. Rows are idempotent,
 * so this only builds the slider and legend of rows that just became visible
 * and have not rendered their layer's current view yet.
 */
function refreshLayerRows() {
  if (!layersStore) return;
  for (const [key, rows] of rowsByKey) {
    const record = layersStore.get(key);
    for (const row of rows) row.update(record);
  }
}

/** Layer keys addLayerRow has already warned about, so each is reported once. */
const rowKeysWarned = new Set();

/**
 * The controller looks layers up in the config registry, so a published row
 * for a layer object that is not the registry's (not in `TABS`, or a copy)
 * cannot turn anything on: its switch ends in an error. Say so during
 * development instead of leaving it to be found by clicking.
 */
function warnIfNotInConfig(layer) {
  if (!layer.key || !isLayerAvailable(layer) || rowKeysWarned.has(layer.key)) return;
  if (getLayerRegistry().byKey(layer.key) === layer) return;
  rowKeysWarned.add(layer.key);
  console.warn(
    `Layer row "${layer.key}" is not the layer config's entry for that key; the controller will not find it, so its switch cannot turn it on.`,
  );
}

/**
 * Create a layer row wired to the sidebar's store and controller, and register
 * it for record updates and destroy.
 * @param {object} layer
 * @param {"full"|"compact"} variant
 * @param {string|null} tabId - the tab panel the row is in (its slider and
 *   legend render only while that tab is shown); null for a row outside tabs
 */
function addLayerRow(layer, variant, tabId) {
  warnIfNotInConfig(layer);
  // First, so a lazily created store (unit use) does not destroy this row.
  const rowStore = getLayersStore();
  const row = createLayerRow(layer, {
    variant,
    store: rowStore,
    controller: getLayerController(),
    isReady: isSDKReady,
    isVisible: () => tabId == null || store.activeTab === tabId,
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

/**
 * Build the UI and wire up all nav links.
 * @param {{ stateAdapter?: ReturnType<typeof createHashAdapter> }} [options] - URL
 *   state adapter; defaults to the hash adapter, which the sidebar then owns
 */
export function buildSidebar({ stateAdapter: adapter } = {}) {
  // Start from a fresh store and drop the previous build's subscriptions and
  // listeners (HMR / test re-runs).
  initLayerState(adapter);

  const sidebarBody = document.getElementById("panel-body");
  const panel = document.getElementById("sidebar");
  const toggle = document.getElementById("panel-toggle");
  const infoPage = document.getElementById("info-page");
  const clearBtn = document.getElementById("layer-clear-btn");
  const disabledToggleBtn = document.getElementById("layer-disabled-toggle");

  // Collapse / expand sidebar — clear/restore inline resize dimensions so the
  // collapsed CSS width isn't overridden by a prior user resize.
  toggle.addEventListener("click", () => {
    if (panel.classList.contains("is-collapsed")) {
      panel.classList.remove("is-collapsed");
      onPanelExpand(panel);
    } else {
      onPanelCollapse(panel);
      panel.classList.add("is-collapsed");
    }
  });

  // "Clear all" turns off every layer that is on or still loading, across all tabs
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const controller = getLayerController();
      if (!controller) return; // destroyed (see destroySidebar)
      batchHashWrites(() => controller.clearAll());
    });
  }

  if (disabledToggleBtn) {
    disabledToggleBtn.addEventListener("click", () => {
      showDisabledLayers = !showDisabledLayers;
      disabledToggleBtn.setAttribute("aria-pressed", String(showDisabledLayers));
      disabledToggleBtn.textContent = showDisabledLayers ? "Hide disabled" : "Show disabled";
      updateDisabledLayerVisibility();
    });
  }

  // Populate info page with all info panels
  infoPage.appendChild(buildHomePanel());
  infoPage.appendChild(buildSourcesPanel());
  infoPage.appendChild(buildAboutPanel());

  // Mangrove's tabs script only auto-initialises on DOMContentLoaded, which has
  // already fired by the time these panels exist. Enhancement is optional, so
  // the promise is not awaited.
  void initMangroveTabs(infoPage);

  // Populate sidebar with layer panels (data tabs only)
  for (const tab of TABS) {
    const tabPanel = document.createElement("div");
    tabPanel.className = "tab-panel";
    tabPanel.id = `tab-${tab.id}`;
    tabPanel.style.display = "none";

    const intro = document.createElement("div");
    intro.className = "tab-panel-intro";
    const introText = document.createElement("p");
    introText.textContent = tab.description;
    intro.appendChild(introText);
    if (tab.glossary) {
      const glossary = document.createElement("p");
      glossary.className = "tab-panel-glossary";
      glossary.textContent = tab.glossary;
      intro.appendChild(glossary);
    }
    if (tab.definitionUrl) {
      const definitionLink = document.createElement("a");
      definitionLink.href = tab.definitionUrl;
      definitionLink.target = "_blank";
      definitionLink.rel = "noopener";
      definitionLink.textContent = "UNDRR definition";
      intro.appendChild(definitionLink);
    }
    tabPanel.appendChild(intro);

    const publishedLayers = tab.layers.filter(isLayerAvailable);
    const empty = document.createElement("p");
    empty.className = "tab-panel-empty mg-form-help";
    empty.textContent =
      'No layers are currently published in this category. Use "Show disabled" to review unpublished entries retained for prototype review.';
    empty.hidden = publishedLayers.length > 0;
    tabPanel.appendChild(empty);

    const addLayersToContainer = (layers, container) => {
      for (const layer of layers) {
        const { element: wrapper } = addLayerRow(layer, "full", tab.id);
        if (!isLayerAvailable(layer)) {
          wrapper.hidden = !showDisabledLayers;
          wrapper.dataset.layerDisabled = "true";
          wrapper.classList.add("layer-disabled");
        }
        container.appendChild(wrapper);
      }
    };

    if (tab.groups) {
      for (const group of tab.groups) {
        const groupEl = document.createElement("details");
        groupEl.className = "layer-group";
        groupEl.open = true;

        const groupHeading = document.createElement("summary");
        groupHeading.className = "layer-group-heading";
        groupHeading.textContent = group.label;
        groupEl.appendChild(groupHeading);

        const groupItems = document.createElement("div");
        groupItems.className = "layer-group-items";
        addLayersToContainer(group.layers, groupItems);
        groupEl.appendChild(groupItems);

        tabPanel.appendChild(groupEl);
      }
    } else {
      addLayersToContainer(tab.layers, tabPanel);
    }

    sidebarBody.appendChild(tabPanel);
  }

  updateDisabledLayerVisibility();

  // Second pass: append collapsed cross-tab sections to each tab panel, so a
  // layer's home row comes first among its rows.
  for (const tab of TABS) {
    const tabPanel = document.getElementById(`tab-${tab.id}`);
    tabPanel.appendChild(buildCrossTabSections(tab));
  }

  // Wire nav home link
  const homeLink = document.querySelector(".nav-home-link");
  if (homeLink) {
    homeLink.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("home");
    });
  }

  // Wire nav info links
  for (const link of document.querySelectorAll(".nav-info-link")) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(link.dataset.panel);
    });
  }

  // Wire nav category links
  for (const link of document.querySelectorAll(".nav-tab-link")) {
    const tab = TABS.find((candidate) => candidate.id === link.dataset.tab);
    if (tab?.description) {
      link.title = tab.description;
      link.setAttribute("aria-description", tab.description);
    }
    link.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(link.dataset.tab);
      // Expand panel if collapsed
      panel.classList.remove("is-collapsed");
    });
  }

  // Read initial tab from URL hash, fall back to default
  const { tab: hashTab } = stateAdapter.read();
  const initialTab = hashTab && ALL_TABS.includes(hashTab) ? hashTab : store.activeTab;
  // Preserve a valid incoming hash until MapX is ready and can restore its
  // layers. Writing empty runtime state here would erase the shared link.
  switchTab(initialTab, { syncHash: !hashTab || !ALL_TABS.includes(hashTab), replaceHash: true });

  // Browser back/forward: reconcile both tab and layer state from the new hash.
  // The URL is already the target, so the tab switch must not write the old
  // layers back, and the reconcile only corrects the current entry in place.
  // Hashes the app doesn't own (in-page anchors, unknown ids) are ignored, and
  // a bare info-tab hash (e.g. an `href="#sources"` link) keeps the open layers.
  const unsubscribeUrl = stateAdapter.subscribe((parsed) => {
    const action = hashChangeAction(parsed, { dataTabs: DATA_TABS, infoTabs: INFO_TABS });
    if (action === "ignore") return;
    // The user moved through history: no earlier action's entry may be replaced.
    actionEntryKeys.clear();
    if (parsed.tab !== store.activeTab) switchTab(parsed.tab, { syncHash: false });
    if (action === "keep-layers") {
      // Rewrite the bare hash in place so the entry still carries the layers.
      syncHashFromState({ replace: true });
    } else if (isSDKReady()) {
      batchHashWrites(() => reconcileLayersFromHash(parsed.layers), { replace: true });
    }
  });
  disposers.push(unsubscribeUrl);

  // Home page category cards dispatch a custom event to navigate to a data tab
  document.addEventListener("navigate-tab", (e) => {
    const tabId = e.detail;
    if (tabId && ALL_TABS.includes(tabId)) {
      switchTab(tabId);
      // Expand the sidebar panel if it was collapsed
      const panel = document.getElementById("sidebar");
      if (panel) {
        panel.classList.remove("is-collapsed");
        onPanelExpand(panel);
      }
    }
  });

  // Make the layer panel draggable and resizable
  makeDraggable(panel, panel.querySelector(".layer-panel-header"));
  makeResizable(panel);
}

function switchTab(tabId, { syncHash = true, replaceHash = false } = {}) {
  store.setActiveTab(tabId);
  if (syncHash) syncHashFromState({ replace: replaceHash });

  const appMap = document.getElementById("app-map");
  const infoPage = document.getElementById("info-page");
  const isInfoTab = INFO_TABS.includes(tabId);

  // Toggle map vs full-page info view
  appMap.style.display = isInfoTab ? "none" : "";
  infoPage.style.display = isInfoTab ? "block" : "none";

  // The UNDRR global footer belongs to the content pages; the map view is
  // full-bleed. The syndication widget populates it independently.
  setGlobalFooterVisible(isInfoTab);

  // Active state on all nav links
  for (const link of document.querySelectorAll(".nav-tab-link")) {
    link.classList.toggle("is-active", link.dataset.tab === tabId);
  }
  const homeLink = document.querySelector(".nav-home-link");
  if (homeLink) homeLink.classList.toggle("is-active", tabId === "home");
  for (const link of document.querySelectorAll(".nav-info-link")) {
    link.classList.toggle("is-active", link.dataset.panel === tabId);
  }

  if (isInfoTab) {
    // Show the right info panel, hide the others
    for (const id of INFO_TABS) {
      const el = document.getElementById(`tab-${id}`);
      if (el) el.style.display = el.id === `tab-${tabId}` ? "block" : "none";
    }
  } else {
    // Show the right layer panel in the sidebar, hide the others
    for (const panel of document.querySelectorAll(".tab-panel")) {
      panel.style.display = panel.id === `tab-${tabId}` ? "block" : "none";
    }
    refreshLayerRows();
  }
}

function updateDisabledLayerVisibility() {
  for (const tab of TABS) {
    const tabPanel = document.getElementById(`tab-${tab.id}`);
    if (!tabPanel) continue;

    for (const wrapper of tabPanel.querySelectorAll("[data-layer-disabled='true']")) {
      wrapper.hidden = !showDisabledLayers;
    }

    // Show/hide collapsible groups based on whether they have any visible items
    for (const groupEl of tabPanel.querySelectorAll(".layer-group")) {
      const items = groupEl.querySelector(".layer-group-items");
      if (!items) continue;
      groupEl.hidden = !Array.from(items.children).some((el) => !el.hidden);
    }

    const hasPublishedLayers = tab.layers.some(isLayerAvailable);
    const empty = tabPanel.querySelector(".tab-panel-empty");
    if (empty) empty.hidden = hasPublishedLayers || showDisabledLayers;
  }
}

/**
 * Write current state (active tab + open layers) to the URL hash.
 * Runs from the layers-store subscriber when what MapX shows changes (see
 * changesUrlState), and directly after a tab switch. Inside a batch nothing is
 * written; the batch writes the hash once when it ends.
 *
 * The store runs its subscribers synchronously in subscription order, so the
 * hash is written before the rows update the switches and legend. A
 * failed write is logged here and a throwing subscriber is logged by the
 * store, so neither stops the panel from finishing its update.
 * @param {{ replace?: boolean }} [options] - replace the history entry instead of pushing
 * @returns {boolean} whether the URL state changed (an entry was pushed or replaced)
 */
function syncHashFromState({ replace = false } = {}) {
  if (!layersStore) return false; // destroyed (see destroySidebar)
  if (hashBatchDepth > 0) return false;
  // A store used before any buildSidebar(): no URL to write.
  if (!stateAdapter) return false;
  const layers = toUrlLayers(layersStore.all(), getLayerRegistry().urlKeyOrder());
  const before = JSON.stringify(stateAdapter.read());
  try {
    stateAdapter.write({ tab: store.activeTab, layers }, { replace });
  } catch (error) {
    // e.g. SecurityError when the browser rate-limits history calls. The URL
    // falls behind until the next write; the map and panel stay correct.
    console.error("Could not write layer state to the URL:", error);
    return false;
  }
  const changed = JSON.stringify(stateAdapter.read()) !== before;
  // A new entry belongs to a new action: later writes of earlier actions push.
  if (changed && !replace) actionEntryKeys.clear();
  return changed;
}

/**
 * Store subscriber's hash write for one layer's change, keeping one history
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
 * Run a multi-layer change as one hash write: pushed for a user action
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
 * Show "Clear all" while any layer is on or asked to be on. It follows intent
 * as well as the map so a layer that is still loading can be cleared, and it
 * stays while a failing turn-off leaves a layer on. It does not report views;
 * see notifyViewsChanged.
 */
function updateClearBtn() {
  const clearBtn = document.getElementById("layer-clear-btn");
  if (clearBtn && layersStore) {
    clearBtn.hidden = !layersStore.all().some((record) => record.desired || record.applied);
  }
}

/**
 * Store subscriber: tell the onViewsChanged callback how many layers are on
 * the map, whenever that number changes (a layer's `applied` flips). Intent
 * alone never fires it, and neither does a source switch: the layer stays on
 * through the gap between its old and new view, so a switch cannot report 0
 * while a layer is on (which would disable inspect mode).
 */
function notifyViewsChanged(_key, next, prev) {
  if (next.applied === prev.applied || !_viewsChangeCallback || !layersStore) return;
  _viewsChangeCallback(layersStore.all().filter((record) => record.applied).length);
}

/**
 * Ask for a layer as a URL state entry describes it: on, with its (clamped)
 * source or its provider settings.
 */
function intendFromUrl({ key, sourceIdx, settings }) {
  const layer = getLayerRegistry().byKey(key);
  const patch = { desired: true };
  if (isCompound(layer)) patch.sourceIdx = clampSourceIdx(layer, sourceIdx);
  if (isExternalLayer(layer) && settings) patch.settings = settings;
  return getLayerController().intend(key, patch);
}

/**
 * Restore layer state from the URL hash. Call after SDK is ready.
 * Layers are requested in hash order, so MapX adds their views in that order.
 */
export async function restoreLayersFromHash() {
  if (!layersStore || !stateAdapter) {
    // State and the URL adapter come only from buildSidebar() (see destroySidebar).
    console.warn("restoreLayersFromHash: no sidebar is built; nothing restored.");
    return;
  }
  const { layers } = stateAdapter.read();
  if (layers.length === 0) return;

  // The URL is only rewritten once, in place, after every layer settles.
  await batchHashWrites(
    () =>
      Promise.all(
        layers.map((entry) => {
          if (!rowsByKey.has(entry.key) || getLayersStore().get(entry.key).desired) return null;
          return intendFromUrl(entry);
        }),
      ),
    { replace: true },
  );
}

/**
 * Reconcile layer intent against a parsed hash layers array.
 * Called on hashchange (back/forward) after initial load: layers not in the
 * hash are turned off, and those in it are asked for with their source or
 * settings. The controller works out what actually has to change.
 */
async function reconcileLayersFromHash(hashLayers) {
  const inHash = new Set(hashLayers.map((entry) => entry.key));
  const changes = [];

  for (const key of rowsByKey.keys()) {
    const record = getLayersStore().get(key);
    if (!inHash.has(key) && (record.desired || record.applied)) {
      changes.push(getLayerController().setOn(key, false));
    }
  }
  for (const entry of hashLayers) {
    if (rowsByKey.has(entry.key)) changes.push(intendFromUrl(entry));
  }

  await Promise.all(changes);
}

/**
 * Build a layer's home-tab row (the full variant of createLayerRow) outside any
 * tab panel. For unit use: buildSidebar() builds its rows itself. Before any
 * buildSidebar() the row gets a store and controller without a URL adapter.
 *
 * `layer` must be the layer config's own entry (`TABS`, as the registry's
 * `byKey` returns it): the controller looks layers up there. For any other
 * layer the row warns, and turning it on ends in an error with the switch off.
 * @param {object} layer
 * @returns {{ wrapper: HTMLElement, eyeBtn: HTMLButtonElement|null }}
 */
export function buildLayerAccordion(layer) {
  const { element } = addLayerRow(layer, "full", null);
  return { wrapper: element, eyeBtn: element.querySelector(".layer-eye") };
}

/**
 * Build collapsed <details> sections for all tabs other than the current one.
 * Each section shows a compact row per published layer (the compact variant of
 * createLayerRow: label, type tag, switch, and details while the layer is on).
 */
function buildCrossTabSections(currentTab) {
  const container = document.createElement("div");
  container.className = "cross-tab-sections";

  for (const tab of TABS) {
    if (tab.id === currentTab.id) continue;

    const publishedLayers = tab.layers.filter((l) => isLayerAvailable(l) && l.key);
    if (publishedLayers.length === 0) continue;

    const details = document.createElement("details");
    details.className = "cross-tab-section";

    const summary = document.createElement("summary");
    summary.className = "cross-tab-summary";
    summary.textContent = tab.label;
    details.appendChild(summary);

    if (tab.groups) {
      for (const group of tab.groups) {
        const groupLayers = group.layers.filter((l) => isLayerAvailable(l) && l.key);
        if (groupLayers.length === 0) continue;

        const groupHeading = document.createElement("p");
        groupHeading.className = "cross-tab-group-label";
        groupHeading.textContent = group.label;
        details.appendChild(groupHeading);

        for (const layer of groupLayers) {
          details.appendChild(addLayerRow(layer, "compact", currentTab.id).element);
        }
      }
    } else {
      for (const layer of publishedLayers) {
        details.appendChild(addLayerRow(layer, "compact", currentTab.id).element);
      }
    }

    container.appendChild(details);
  }

  return container;
}
