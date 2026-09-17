/**
 * Floating layer panel + info page routing.
 *
 * - Data tabs (from layer config): show map + sidebar.
 * - Info tabs (home / sources / about): show full-page view, hide map.
 *
 * Layer definitions come from config/layers.js; this module is purely UI.
 */
import { TABS } from "../config/layers.js";
import * as store from "../state/store.js";
import { viewAdd, viewRemove } from "../sdk/views.js";
import { isSDKReady } from "../sdk/client.js";
import { buildHomePanel } from "./home.js";
import { buildSourcesPanel, buildAboutPanel } from "./info-panels.js";
import { setGlobalFooterVisible } from "./global-footer.js";
import { initMangroveTabs } from "./mangrove-tabs.js";
import { buildWidget, isCompound } from "./widgets/index.js";
import { makeDraggable, makeResizable, onPanelCollapse, onPanelExpand } from "../utils/panels.js";
import { hashChangeAction } from "../state/hash.js";
import { createHashAdapter } from "../state/hash-adapter.js";
import {
  changesUrlState,
  createLayersStore,
  mirrorOpenViews,
  toUrlLayers,
  urlKeyOrder,
} from "../state/layers-store.js";
import { createLayerController, isBusyStatus, settingsMatch } from "../services/layer-controller.js";
import { addOpacitySlider, addLegend } from "./layer-controls.js";
import { buildExternalControls } from "./external-controls.js";
import { isLayerAvailable } from "../config/layers/status.js";
import {
  closeExternalLayer,
  getExternalLayerDefinition,
  getExternalLayerRuntime,
  isExternalLayer,
  openExternalLayer,
  replaceExternalLayer,
} from "../external/index.js";

// MapX view types: cc = custom coded (live), rt = raster tile, vt = vector tile

let _viewsChangeCallback = null;

/** Register a callback invoked whenever the set of open views changes. */
export function onViewsChanged(fn) {
  _viewsChangeCallback = fn;
}
const TYPE_LABELS = { cc: "live", rt: "raster", vt: "vector" };
const GEOMETRY_LABELS = { point: "points", polygon: "polygons", line: "lines" };

function layerBadgeLabel(layer) {
  return (layer.geometry && GEOMETRY_LABELS[layer.geometry]) || TYPE_LABELS[layer.type] || layer.type;
}

/** Build the type/geometry badge shown next to a layer label. */
function buildLayerTypeTag(layer) {
  const tag = document.createElement("span");
  tag.className = "mg-tag layer-type-tag";
  if (layer.type === "rt") tag.classList.add("mg-tag--accent");
  if (layer.type === "vt") tag.classList.add("mg-tag--secondary");
  tag.textContent = layerBadgeLabel(layer);
  return tag;
}

const INFO_TABS = ["home", "sources", "about"];

// All valid tab IDs for hash routing
const DATA_TABS = TABS.map((tab) => tab.id);
const ALL_TABS = [...INFO_TABS, ...DATA_TABS];
// Layer keys in the order the URL hash lists them (config order, not the
// grouped row order of the sidebar).
const URL_KEY_ORDER = urlKeyOrder(TABS);

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

// Maps layer.key → the layer's row in its home tab (see buildLayerAccordion):
// { layer, eyeBtn, wrapper, expandOnApply, shownSourceIdx, shownSettings, pendingSelections }.
// It is the controller's layer config lookup. Filled in sidebar row order
// (grouped tabs list rows by R2R category), so it is not the hash order; that
// is URL_KEY_ORDER.
const layerElementMap = new Map();
// Maps layer.key → [{ tabId, eyeBtn, body, desc, status, sliderSlot, legendSlot }]
// for the compact rows in cross-tab sections, so layers activated outside their
// home tab still show their details, opacity slider and legend.
const secondaryRows = new Map();
// Maps layer.key → { layer, viewId, legendLayer, status, version }: what the
// cross-tab rows should show. Only rows in the visible tab are rendered.
const secondaryState = new Map();
let showDisabledLayers = false;
// Depth of batched layer changes (restore, back/forward, clear-all). Hash
// writes inside a batch are skipped and replaced by one write when it ends,
// so a multi-layer change creates at most one history entry.
let hashBatchDepth = 0;

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
  if (url) {
    stateAdapter = adapter ?? createHashAdapter();
    if (!adapter) disposers.push(() => stateAdapter.destroy());
  }
  layersStore = createLayersStore();
  // Subscriber order matters: openViews must be current before the hash sync
  // updates the Clear button and the views-changed callback from its size.
  disposers.push(mirrorOpenViews(layersStore, store.openViews));
  disposers.push(
    layersStore.subscribe((_key, next, prev) => {
      if (changesUrlState(next, prev)) syncHashFromState();
    }),
  );
  disposers.push(layersStore.subscribe(renderLayerRecord));
  layerController = createLayerController({
    store: layersStore,
    getLayer: (key) => layerElementMap.get(key)?.layer,
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
 * subscriptions (openViews mirror, hash sync, row renderer), the layer
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
 * The DOM, and the nav, panel and `navigate-tab` listeners that predate the
 * store, are not removed yet.
 */
export function destroySidebar() {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  layersStore = null;
  layerController = null;
  stateAdapter = null;
  destroyed = true;
}

/**
 * Record what a layer's cross-tab rows should show and re-render them.
 * Pass null to clear. `status` is a { text, isError } message shown in place
 * of the controls while an external layer loads or after it fails.
 */
function setSecondaryState(layer, state) {
  if (!layer.key) return;
  if (state) {
    const version = (secondaryState.get(layer.key)?.version ?? 0) + 1;
    secondaryState.set(layer.key, {
      layer,
      viewId: null,
      legendLayer: null,
      status: null,
      ...state,
      version,
    });
  } else {
    secondaryState.delete(layer.key);
  }
  syncSecondaryRows(layer.key);
}

/**
 * Render a layer's cross-tab controls into the row in the visible tab only.
 * Each render triggers SDK calls (transparency, legend), so rows in hidden tabs
 * are filled lazily when their tab is shown, and keep their controls once
 * rendered so switching back and forth does not re-request them.
 */
function syncSecondaryRows(key) {
  const state = secondaryState.get(key);
  for (const row of secondaryRows.get(key) ?? []) {
    if (!state) {
      if (row.renderedVersion != null || !row.body.hidden) clearSecondaryRow(row);
      continue;
    }
    if (row.tabId != null && row.tabId !== store.activeTab) continue;
    if (row.renderedVersion === state.version) continue;

    clearSecondaryRow(row);
    row.renderedVersion = state.version;
    row.body.hidden = false;
    if (row.desc) setLayerDescription(row.desc, state.layer, state.legendLayer?.desc || state.layer.desc);
    if (state.status) {
      row.status.hidden = false;
      row.status.textContent = state.status.text;
      row.status.classList.toggle("is-error", Boolean(state.status.isError));
    }
    if (state.viewId) {
      addOpacitySlider(state.viewId, row.sliderSlot);
      addLegend(state.legendLayer, row.legendSlot);
    }
  }
}

function clearSecondaryRow(row) {
  row.renderedVersion = null;
  row.body.hidden = true;
  row.status.hidden = true;
  row.status.textContent = "";
  row.status.classList.remove("is-error");
  row.sliderSlot.innerHTML = "";
  row.legendSlot.innerHTML = "";
}

function setLayerToggleState(layer, button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-checked", String(active));
  button.setAttribute("aria-label", `${active ? "Turn off" : "Turn on"} ${layer.label}`);
  button.title = active ? "Turn layer off" : "Turn layer on";
}

/** Every switch for a layer: its home row and its cross-tab rows. */
function layerSwitches(key) {
  const home = layerElementMap.get(key)?.eyeBtn;
  return [...(home ? [home] : []), ...(secondaryRows.get(key) ?? []).map((row) => row.eyeBtn)];
}

/** Expand or collapse a layer accordion's body. */
function setAccordionExpanded(wrapper, expanded) {
  wrapper.querySelector(".layer-body").style.display = expanded ? "block" : "none";
  wrapper.querySelector(".layer-arrow").textContent = expanded ? "\u25BC" : "\u25B6"; // ▼ / ▶
  wrapper.querySelector(".layer-header").setAttribute("aria-expanded", String(expanded));
}

/**
 * A layer switch was clicked (home or cross-tab row): ask for the opposite of
 * the layer's current intent. Toggling intent rather than what MapX shows makes
 * a second click while loading cancel the first; the controller applies the
 * latest intent once the call in flight settles.
 * @param {string} key
 * @param {{ expand?: boolean }} [options] - open the accordion when the layer comes on
 */
function toggleLayerFromSwitch(key, { expand = true } = {}) {
  const el = layerElementMap.get(key);
  const controller = getLayerController();
  if (!el || !controller) return; // destroyed (see destroySidebar)
  // Guard: SDK must be ready before attempting map operations
  if (!isSDKReady()) {
    console.warn(`${el.layer.label} cannot be toggled yet — map is still loading.`);
    return;
  }
  const on = !getLayersStore().get(key).desired;
  if (on) el.expandOnApply = expand;
  return controller.setOn(key, on);
}

/**
 * Store subscriber: bring a layer's rows in line with its record. Switches
 * follow intent (`desired`); the details, source widget, slider and legend
 * follow what MapX shows (`applied`, `viewId`).
 */
function renderLayerRecord(key, next, prev) {
  const el = layerElementMap.get(key);
  if (!el) return;
  const { layer } = el;
  const external = isExternalLayer(layer);
  const busy = isBusyStatus(next.status);

  if (next.desired !== prev.desired) {
    for (const button of layerSwitches(key)) setLayerToggleState(layer, button, next.desired);
  }
  if (busy !== isBusyStatus(prev.status)) {
    for (const button of layerSwitches(key)) button.setAttribute("aria-busy", String(busy));
  }

  if (external && next.status === "loading" && prev.status !== "loading" && !next.applied) {
    showExternalLoading(el);
  }

  if (next.applied && !prev.applied) renderLayerOn(el, next);
  else if (!next.applied && prev.applied) renderLayerOff(el);
  else if (next.applied && next.viewId && next.viewId !== prev.viewId) renderLayerView(el, next);

  const settled = !busy && isBusyStatus(prev.status);
  if (settled && next.applied) syncLayerSelectors(el, next);
  if (settled && !next.applied && external) {
    if (next.status === "error") showExternalLoadError(el);
    else clearLayerControls(el);
  }

  if (next.desired !== prev.desired || next.applied !== prev.applied) updateClearBtn();
}

/** The layer came on: reveal its row and build its controls. */
function renderLayerOn(el, record) {
  const { layer, wrapper } = el;
  wrapper.classList.add("layer-active");
  // Auto-expand the cross-tab sections containing this layer
  for (const { eyeBtn } of secondaryRows.get(layer.key) ?? []) {
    const section = eyeBtn.closest("details.cross-tab-section");
    if (section) section.open = true;
  }

  // Direct switch activation reveals controls. Header activation already
  // manages expansion and must not reopen after a slow MapX response.
  if (el.expandOnApply) setAccordionExpanded(wrapper, true);

  wrapper.querySelector(".layer-widget-slot").innerHTML = "";
  if (isCompound(layer) && layer.widget) renderSourceWidget(el, record.sourceIdx);
  if (isExternalLayer(layer)) renderExternalControls(el, record.appliedSettings);

  renderLayerView(el, record);
}

/**
 * Show the view MapX now carries for the layer: its description, opacity
 * slider and legend, in the home row and the cross-tab rows.
 */
function renderLayerView(el, record) {
  const { layer, wrapper } = el;
  const { viewId } = record;
  let legendLayer = layer;
  if (isExternalLayer(layer)) {
    legendLayer = { ...layer, id: viewId, legend: getExternalLayerRuntime(layer)?.legend };
  } else if (isCompound(layer)) {
    // Merge the shown source's fields (desc, legend) onto the parent layer so
    // addLegend sees the right data.
    const source = layer.sources[safeSourceIdx(layer, record.appliedSourceIdx)];
    legendLayer = { ...layer, ...source, label: layer.label };
    // Show the active source's description instead of the parent's
    const descEl = wrapper.querySelector(".layer-desc");
    if (descEl) setLayerDescription(descEl, layer, source.desc || layer.desc);
  }

  const sliderSlot = wrapper.querySelector(".layer-slider-slot");
  const legendSlot = wrapper.querySelector(".layer-legend-slot");
  sliderSlot.innerHTML = "";
  addOpacitySlider(viewId, sliderSlot);
  legendSlot.innerHTML = "";
  addLegend(legendLayer, legendSlot);
  setSecondaryState(layer, { viewId, legendLayer });
}

/** The layer went off: clear its controls and return the row to its compact state. */
function renderLayerOff(el) {
  el.wrapper.classList.remove("layer-active");
  clearLayerControls(el);
  // Turning a layer off ends the interaction and returns the row to its
  // compact state. Collapsing alone still leaves an active layer on.
  setAccordionExpanded(el.wrapper, false);
}

function clearLayerControls(el) {
  const { layer, wrapper } = el;
  setSecondaryState(layer, null);
  for (const selector of [".layer-widget-slot", ".layer-slider-slot", ".layer-legend-slot"]) {
    wrapper.querySelector(selector).innerHTML = "";
  }
  el.shownSourceIdx = null;
  el.shownSettings = null;
}

function showExternalLoading(el) {
  const { layer, wrapper } = el;
  const text = `Loading ${layer.label}…`;
  if (el.expandOnApply) {
    setAccordionExpanded(wrapper, true);
    const widgetSlot = wrapper.querySelector(".layer-widget-slot");
    widgetSlot.innerHTML = "";
    const status = document.createElement("p");
    status.className = "external-layer-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = text;
    widgetSlot.appendChild(status);
  }
  setSecondaryState(layer, { status: { text } });
}

function showExternalLoadError(el) {
  const { layer, wrapper } = el;
  const text = `Could not load ${layer.label}. Please try again.`;
  const status = wrapper.querySelector(".layer-widget-slot .external-layer-status");
  if (status) {
    status.classList.add("is-error");
    status.textContent = text;
  }
  setSecondaryState(layer, { status: { text, isError: true } });
}

/**
 * Build the source switcher for a compound layer. A pick resolves to the source
 * the layer ends up on once every pick in flight has settled, so the widget
 * shows the last pick, or the source kept after a failure.
 */
function renderSourceWidget(el, sourceIdx) {
  const { layer, wrapper } = el;
  const widgetSlot = wrapper.querySelector(".layer-widget-slot");
  widgetSlot.innerHTML = "";
  el.shownSourceIdx = sourceIdx;
  const widgetEl = buildWidget(layer.widget, layer.sources, sourceIdx, async (newIdx) => {
    const controller = getLayerController();
    // Destroyed (see destroySidebar): keep showing the current source.
    if (!controller) return el.shownSourceIdx;
    el.shownSourceIdx = newIdx;
    el.pendingSelections++;
    try {
      const record = await controller.setSource(layer.key, newIdx);
      el.shownSourceIdx = record.sourceIdx;
      return record.sourceIdx;
    } finally {
      el.pendingSelections--;
    }
  });
  if (widgetEl) widgetSlot.appendChild(widgetEl);
}

/** Build an external layer's provider controls (e.g. crop, scenario). */
function renderExternalControls(el, settings) {
  const { layer, wrapper } = el;
  const widgetSlot = wrapper.querySelector(".layer-widget-slot");
  widgetSlot.innerHTML = "";
  el.shownSettings = settings;
  const controls = buildExternalControls(getExternalLayerDefinition(layer), settings, async (wanted) => {
    const controller = getLayerController();
    // Destroyed (see destroySidebar): keep showing the current settings.
    if (!controller) return { settings: el.shownSettings };
    el.shownSettings = wanted;
    el.pendingSelections++;
    try {
      const record = await controller.setSettings(layer.key, wanted);
      el.shownSettings = record.appliedSettings;
      // The controls show their own error and revert to the settings on the map.
      if (record.status === "error" && !settingsMatch(record.appliedSettings, wanted)) {
        throw record.error ?? new Error(`Could not update ${layer.label}`);
      }
      return { settings: record.appliedSettings };
    } finally {
      el.pendingSelections--;
    }
  });
  widgetSlot.appendChild(controls);
}

/**
 * After a change settles, rebuild the source widget or external controls if
 * they show something else than the record, e.g. after back/forward. Changes
 * made through the controls themselves correct their own display.
 */
function syncLayerSelectors(el, record) {
  if (el.pendingSelections > 0) return;
  const { layer } = el;
  if (isCompound(layer) && layer.widget && el.shownSourceIdx !== record.sourceIdx) {
    renderSourceWidget(el, record.sourceIdx);
  } else if (isExternalLayer(layer) && !settingsMatch(el.shownSettings, record.appliedSettings)) {
    renderExternalControls(el, record.appliedSettings);
  }
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

  // Clear stale state (guards against HMR / test re-runs)
  layerElementMap.clear();
  secondaryRows.clear();
  secondaryState.clear();

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
        // Registers published layers in layerElementMap.
        const { wrapper } = buildLayerAccordion(layer);
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

  // Second pass: append collapsed cross-tab sections to each tab panel.
  // Built after the first pass so layerElementMap is fully populated.
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
    for (const key of secondaryState.keys()) syncSecondaryRows(key);
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
 * changesUrlState), and directly after a tab switch. Inside a batch only the
 * Clear button is updated; the batch writes the hash once.
 *
 * The store runs its subscribers synchronously in subscription order, so the
 * hash is written before the row renderer updates the switches and legend. A
 * failed write is logged here and a throwing subscriber is logged by the
 * store, so neither stops the panel from finishing its update.
 * @param {{ replace?: boolean }} [options] - replace the history entry instead of pushing
 */
function syncHashFromState({ replace = false } = {}) {
  if (!layersStore) return; // destroyed (see destroySidebar)
  if (hashBatchDepth > 0) {
    updateClearBtn();
    return;
  }
  if (!stateAdapter) {
    // A store used before any buildSidebar(): no URL to write.
    updateClearBtn();
    return;
  }
  const layers = toUrlLayers(layersStore.all(), URL_KEY_ORDER);
  try {
    stateAdapter.write({ tab: store.activeTab, layers }, { replace });
  } catch (error) {
    // e.g. SecurityError when the browser rate-limits history calls. The URL
    // falls behind until the next write; the map and panel stay correct.
    console.error("Could not write layer state to the URL:", error);
  }
  updateClearBtn();
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
    if (hashBatchDepth === 0) syncHashFromState({ replace });
  }
}

/**
 * Show "Clear all" while any layer is on or asked to be on (so a layer that is
 * still loading can be cleared), and report the number of open views.
 */
function updateClearBtn() {
  const clearBtn = document.getElementById("layer-clear-btn");
  if (clearBtn && layersStore) {
    clearBtn.hidden = !layersStore.all().some((record) => record.desired || record.applied);
  }
  if (_viewsChangeCallback) _viewsChangeCallback(store.openViews.size);
}

/**
 * Clamp a sourceIdx from the hash to valid bounds for the given layer.
 * Returns 0 if the value is invalid or out of range.
 */
function safeSourceIdx(layer, sourceIdx) {
  if (!isCompound(layer)) return 0;
  const n = layer.sources.length;
  return Number.isInteger(sourceIdx) && sourceIdx >= 0 && sourceIdx < n ? sourceIdx : 0;
}

/**
 * Ask for a layer as a URL state entry describes it: on, with its (clamped)
 * source or its provider settings.
 */
function intendFromUrl(el, { sourceIdx, settings }) {
  const { layer } = el;
  const patch = { desired: true };
  if (isCompound(layer)) patch.sourceIdx = safeSourceIdx(layer, sourceIdx);
  if (isExternalLayer(layer) && settings) patch.settings = settings;
  if (!getLayersStore().get(layer.key).applied) el.expandOnApply = true;
  return getLayerController().intend(layer.key, patch);
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
          const el = layerElementMap.get(entry.key);
          if (!el || getLayersStore().get(entry.key).desired) return null;
          return intendFromUrl(el, entry);
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

  for (const key of layerElementMap.keys()) {
    const record = getLayersStore().get(key);
    if (!inHash.has(key) && (record.desired || record.applied)) {
      changes.push(getLayerController().setOn(key, false));
    }
  }
  for (const entry of hashLayers) {
    const el = layerElementMap.get(entry.key);
    if (el) changes.push(intendFromUrl(el, entry));
  }

  await Promise.all(changes);
}

export function buildLayerAccordion(layer) {
  const published = isLayerAvailable(layer);

  const wrapper = document.createElement("div");
  wrapper.className = "layer-item";

  // Header row: expand arrow + label + type tag + eye toggle (published only)
  const header = document.createElement("div");
  header.className = "layer-header";

  const arrow = document.createElement("span");
  arrow.className = "layer-arrow";
  arrow.textContent = "\u25B6"; // ▶
  arrow.setAttribute("aria-hidden", "true");
  header.appendChild(arrow);

  const label = document.createElement("span");
  label.className = "layer-label";
  label.textContent = layer.label;
  header.appendChild(label);

  header.appendChild(buildLayerTypeTag(layer));

  let eyeBtn = null;
  if (published) {
    eyeBtn = document.createElement("button");
    eyeBtn.className = "layer-eye";
    eyeBtn.setAttribute("role", "switch");
    setLayerToggleState(layer, eyeBtn, false);
    eyeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleLayerFromSwitch(layer.key);
    });
    header.appendChild(eyeBtn);
  }

  wrapper.appendChild(header);

  // Expandable body (description + controls)
  const body = document.createElement("div");
  body.className = "layer-body";
  body.style.display = "none";

  if (layer.initiative || layer.desc) {
    const desc = document.createElement("p");
    desc.className = "layer-desc mg-form-help";
    setLayerDescription(desc, layer, layer.desc);
    body.appendChild(desc);
  }

  const metadata = document.createElement("p");
  metadata.className = "layer-meta-links";
  if (layer.sourceUrl && layer.source && layer.source !== "Source to be confirmed.") {
    const sourceLink = document.createElement("a");
    sourceLink.href = layer.sourceUrl;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener";
    sourceLink.textContent = "Source";
    metadata.appendChild(sourceLink);
    metadata.append(" · ");
  }
  const detailsLink = document.createElement("a");
  detailsLink.href = "#sources";
  detailsLink.textContent = "Citation and methodology details";
  // Navigate like the nav links do; the href stays for open-in-new-tab.
  detailsLink.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("sources");
  });
  metadata.appendChild(detailsLink);
  body.appendChild(metadata);

  // Widget slot (compound layers render source-switcher here)
  const widgetSlot = document.createElement("div");
  widgetSlot.className = "layer-widget-slot";
  body.appendChild(widgetSlot);

  // Opacity slider placeholder (added when layer is active)
  const sliderSlot = document.createElement("div");
  sliderSlot.className = "layer-slider-slot";
  body.appendChild(sliderSlot);

  // Legend slot
  const legendSlot = document.createElement("div");
  legendSlot.className = "layer-legend-slot";
  body.appendChild(legendSlot);

  wrapper.appendChild(body);

  // All layers support expand/collapse so reviewers can read descriptions
  header.tabIndex = 0;
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "false");

  const toggleAccordion = () => {
    const open = body.style.display !== "none";
    setAccordionExpanded(wrapper, !open);

    // Expanding a published layer is an activation intent. Collapsing only
    // hides its controls; the layer remains on until its switch is turned off.
    // The header manages expansion itself, so a slow load must not reopen it.
    // Nothing happens once the sidebar is destroyed (see destroySidebar).
    const record = getLayersStore()?.get(layer.key);
    if (!open && eyeBtn && record && !record.desired) {
      toggleLayerFromSwitch(layer.key, { expand: false });
    }
  };

  header.addEventListener("click", toggleAccordion);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleAccordion();
    }
  });

  if (published && layer.key) {
    layerElementMap.set(layer.key, {
      layer,
      eyeBtn,
      wrapper,
      // Whether the accordion opens when the layer comes on.
      expandOnApply: true,
      // What the source widget or external controls show, and how many of
      // their own changes are still settling (see syncLayerSelectors).
      shownSourceIdx: null,
      shownSettings: null,
      pendingSelections: 0,
    });
  }

  return { wrapper, eyeBtn };
}

function setLayerDescription(element, layer, description) {
  const initiative = layer.initiative?.trim();
  const initiativeSentence = initiative ? (/[.!?]$/.test(initiative) ? initiative : `${initiative}.`) : "";
  element.textContent = [initiativeSentence, description?.trim()].filter(Boolean).join(" ");
}

/**
 * Build collapsed <details> sections for all tabs other than the current one.
 * Each section shows a compact row per published layer (label + type tag + eye toggle).
 * Eye toggles ask the controller for the layer, as its home switch does.
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
          details.appendChild(buildCrossTabRow(layer, currentTab.id));
        }
      }
    } else {
      for (const layer of publishedLayers) {
        details.appendChild(buildCrossTabRow(layer, currentTab.id));
      }
    }

    container.appendChild(details);
  }

  return container;
}

/**
 * Build a single compact row for a cross-tab section.
 * The row carries its own details area (description, opacity slider, legend)
 * that is shown while the layer is active; source/variant switching stays in
 * the layer's home tab. Registered in secondaryRows so renderLayerRecord keeps it
 * in sync; `tabId` is the tab panel the row lives in (rendered only when visible).
 */
function buildCrossTabRow(layer, tabId = null) {
  const item = document.createElement("div");
  item.className = "cross-tab-item";

  const row = document.createElement("div");
  row.className = "cross-tab-row";

  const labelEl = document.createElement("span");
  labelEl.className = "cross-tab-label";
  labelEl.textContent = layer.label;
  row.appendChild(labelEl);

  row.appendChild(buildLayerTypeTag(layer));

  const eyeBtn = document.createElement("button");
  eyeBtn.className = "layer-eye";
  eyeBtn.setAttribute("role", "switch");
  setLayerToggleState(layer, eyeBtn, false);
  eyeBtn.title += " — switch to tab for sub-source controls";
  eyeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLayerFromSwitch(layer.key);
  });
  row.appendChild(eyeBtn);
  item.appendChild(row);

  const body = document.createElement("div");
  body.className = "cross-tab-body";
  body.hidden = true;

  let desc = null;
  if (layer.initiative || layer.desc) {
    desc = document.createElement("p");
    desc.className = "layer-desc mg-form-help";
    setLayerDescription(desc, layer, layer.desc);
    body.appendChild(desc);
  }

  const status = document.createElement("p");
  status.className = "external-layer-status";
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  body.appendChild(status);

  const sliderSlot = document.createElement("div");
  sliderSlot.className = "layer-slider-slot";
  body.appendChild(sliderSlot);

  const legendSlot = document.createElement("div");
  legendSlot.className = "layer-legend-slot";
  body.appendChild(legendSlot);
  item.appendChild(body);

  if (!secondaryRows.has(layer.key)) secondaryRows.set(layer.key, []);
  secondaryRows.get(layer.key).push({ tabId, eyeBtn, body, desc, status, sliderSlot, legendSlot });

  return item;
}
