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
import { buildWidget, isCompound, compoundKey } from "./widgets/index.js";
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

// Per-layer records: whether each layer is on, its source/variant and view.
// `store.openViews` and the URL hash are derived from it by subscribers. Both
// are created on first use (see initLayerState), not on import.
let layersStore = null;
// Reads, writes and watches URL state (the hash, in the standalone app).
let stateAdapter = null;
// Undo initLayerState()/buildSidebar() subscriptions and listeners (see destroySidebar).
let disposers = [];

// Built by buildSidebar(); maps layer.key → { layer, eyeBtn, wrapper }
// Used by restoreLayersFromHash and reconcileLayersFromHash to avoid
// positional DOM queries that break when layer order changes in config.
// Filled in sidebar row order (grouped tabs list rows by R2R category), so it
// is not the hash order; that is URL_KEY_ORDER.
const layerElementMap = new Map();
// Maps layer.key → [{ tabId, eyeBtn, body, desc, status, sliderSlot, legendSlot }]
// for the compact rows in cross-tab sections, so layers activated outside their
// home tab still show their details, opacity slider and legend.
const secondaryRows = new Map();
// Maps layer.key → { layer, viewId, legendLayer, status, version }: what the
// cross-tab rows should show. Only rows in the visible tab are rendered.
const secondaryState = new Map();
// Keys of layers whose toggle is currently in-flight (prevents race on rapid clicks).
const toggleInFlight = new Set();
// Keys of compound layers mid source-switch, and those asked to turn off meanwhile.
const sourceSwitchInFlight = new Set();
const pendingToggleOff = new Set();
let showDisabledLayers = false;
// Depth of batched layer changes (restore, back/forward, clear-all). Hash
// writes inside a batch are skipped and replaced by one write when it ends,
// so a multi-layer change creates at most one history entry.
let hashBatchDepth = 0;

/**
 * Create the layers store and URL adapter, and derive openViews and the hash
 * from the store. Replaces any previous instance and its subscriptions.
 * @param {ReturnType<typeof createHashAdapter>} [adapter] - injected adapter,
 *   owned by the caller; the default hash adapter is owned and destroyed here
 */
function initLayerState(adapter) {
  destroySidebar();
  stateAdapter = adapter ?? createHashAdapter();
  if (!adapter) disposers.push(() => stateAdapter.destroy());
  layersStore = createLayersStore();
  // Subscriber order matters: openViews must be current before the hash sync
  // updates the Clear button and the views-changed callback from its size.
  disposers.push(mirrorOpenViews(layersStore, store.openViews));
  disposers.push(
    layersStore.subscribe((_key, next, prev) => {
      if (changesUrlState(next, prev)) syncHashFromState();
    }),
  );
}

/** The layers store the sidebar writes to (for tests and readers). */
export function getLayersStore() {
  if (!layersStore) initLayerState();
  return layersStore;
}

/**
 * Remove the URL listener and store subscriptions added by buildSidebar().
 * The DOM, and the nav, panel and `navigate-tab` listeners that predate the
 * store, are not covered yet.
 */
export function destroySidebar() {
  for (const dispose of disposers.splice(0).reverse()) dispose();
}

/** Write to a layer's record; layers without a key have no record. */
function setLayerRecord(layer, patch) {
  if (layer.key) getLayersStore().set(layer.key, patch);
}

/**
 * Whether a layer is on. Every published layer in config has a key; the switch
 * class is only a fallback for a keyless layer, which the store can't track.
 */
function isLayerApplied(layer, eyeBtn) {
  return layer.key ? getLayersStore().get(layer.key).applied : eyeBtn.classList.contains("is-active");
}

function setLayerToggleDisabled(layer, eyeBtn, disabled) {
  eyeBtn.disabled = disabled;
  for (const { eyeBtn: btn } of secondaryRows.get(layer.key) ?? []) {
    btn.disabled = disabled;
  }
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

/** Expand or collapse a layer accordion's body. */
function setAccordionExpanded(wrapper, expanded) {
  wrapper.querySelector(".layer-body").style.display = expanded ? "block" : "none";
  wrapper.querySelector(".layer-arrow").textContent = expanded ? "\u25BC" : "\u25B6"; // ▼ / ▶
  wrapper.querySelector(".layer-header").setAttribute("aria-expanded", String(expanded));
}

function externalSettingsMatch(left, right) {
  if (!left || !right) return false;
  return Object.keys(right).every((key) => left[key] === right[key]);
}

async function updateExternalVariant(layer, settings, eyeBtn, wrapper) {
  const sliderSlot = wrapper.querySelector(".layer-slider-slot");
  const legendSlot = wrapper.querySelector(".layer-legend-slot");
  if (layer.key) toggleInFlight.add(layer.key);
  setLayerToggleDisabled(layer, eyeBtn, true);
  setLayerRecord(layer, { status: "switching" });
  try {
    const result = await replaceExternalLayer(layer, settings);
    // Moves openViews from the previous view to the new one and writes the hash.
    setLayerRecord(layer, { viewId: result.runtime.idView, settings: result.runtime.settings });

    sliderSlot.innerHTML = "";
    addOpacitySlider(result.runtime.idView, sliderSlot);
    legendSlot.innerHTML = "";
    const legendLayer = { ...layer, id: result.runtime.idView, legend: result.runtime.legend };
    addLegend(legendLayer, legendSlot);
    setSecondaryState(layer, { viewId: result.runtime.idView, legendLayer });
    return result.runtime;
  } finally {
    setLayerRecord(layer, { status: "idle" });
    setLayerToggleDisabled(layer, eyeBtn, false);
    if (layer.key) toggleInFlight.delete(layer.key);
  }
}

function renderExternalControls(layer, runtime, eyeBtn, wrapper, externalDefinition) {
  const widgetSlot = wrapper.querySelector(".layer-widget-slot");
  widgetSlot.innerHTML = "";
  const controls = buildExternalControls(externalDefinition, runtime.settings, (settings) =>
    updateExternalVariant(layer, settings, eyeBtn, wrapper),
  );
  widgetSlot.appendChild(controls);
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

  // "Clear all" turns off every active layer across all tabs
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      batchHashWrites(() =>
        Promise.all(
          Array.from(layerElementMap.values())
            .filter(({ layer, eyeBtn }) => isLayerApplied(layer, eyeBtn))
            .map(({ layer, eyeBtn, wrapper }) => toggleLayer(layer, eyeBtn, wrapper)),
        ),
      );
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
        const { wrapper, eyeBtn } = buildLayerAccordion(layer);
        if (!isLayerAvailable(layer)) {
          wrapper.hidden = !showDisabledLayers;
          wrapper.dataset.layerDisabled = "true";
          wrapper.classList.add("layer-disabled");
        } else if (layer.key) {
          layerElementMap.set(layer.key, { layer, eyeBtn, wrapper });
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
 * Runs from the layers-store subscriber when a layer's on/off state, source or
 * variant changes, and directly after a tab switch. Inside a batch only the
 * Clear button is updated; the batch writes the hash once.
 * @param {{ replace?: boolean }} [options] - replace the history entry instead of pushing
 */
function syncHashFromState({ replace = false } = {}) {
  if (hashBatchDepth > 0) {
    updateClearBtn();
    return;
  }
  const layers = toUrlLayers(getLayersStore().all(), URL_KEY_ORDER);
  stateAdapter.write({ tab: store.activeTab, layers }, { replace });
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

/** Show/hide the "Clear all" button based on whether any layers are active. */
function updateClearBtn() {
  const clearBtn = document.getElementById("layer-clear-btn");
  if (clearBtn) clearBtn.hidden = store.openViews.size === 0;
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
 * Restore layer state from the URL hash. Call after SDK is ready.
 * Uses layerElementMap (built during buildSidebar) for key-based lookup,
 * eliminating positional DOM queries that break when layer order changes.
 */
export async function restoreLayersFromHash() {
  getLayersStore(); // creates the store and adapter if buildSidebar() hasn't run
  const { layers } = stateAdapter.read();
  if (layers.length === 0) return;

  // Toggles start in hash order (MapX adds views in request order) and the
  // URL is only rewritten once, in place, after they all settle.
  await batchHashWrites(
    () =>
      Promise.all(
        layers.map(({ key, sourceIdx, settings }) => {
          const el = layerElementMap.get(key);
          if (!el || isLayerApplied(el.layer, el.eyeBtn)) return null;
          const { layer, eyeBtn, wrapper } = el;
          if (isCompound(layer)) {
            // Always set source index — even 0, to clear any prior state
            store.setActiveSource(compoundKey(layer), safeSourceIdx(layer, sourceIdx));
          }
          return toggleLayer(layer, eyeBtn, wrapper, settings);
        }),
      ),
    { replace: true },
  );
}

/**
 * Reconcile open layer state against a parsed hash layers array.
 * Called on hashchange (back/forward) after initial load.
 * - Turns off layers not in the hash.
 * - Turns on layers that should be on.
 * - Switches source index for compound layers that stay on but change source.
 */
async function reconcileLayersFromHash(hashLayers) {
  const targetMap = new Map(hashLayers.map((l) => [l.key, l]));
  const changes = [];

  for (const [key, { layer, eyeBtn, wrapper }] of layerElementMap) {
    const isOn = isLayerApplied(layer, eyeBtn);
    const hashEntry = targetMap.get(key);
    const shouldBeOn = Boolean(hashEntry);

    if (isOn !== shouldBeOn) {
      if (shouldBeOn && isCompound(layer)) {
        // Always set — including 0 — so any prior source state is cleared
        store.setActiveSource(compoundKey(layer), safeSourceIdx(layer, hashEntry.sourceIdx));
      }
      changes.push(toggleLayer(layer, eyeBtn, wrapper, hashEntry?.settings));
    } else if (isOn && isCompound(layer)) {
      // Layer stays on: switch source if hash encodes a different index
      const safeIdx = safeSourceIdx(layer, hashEntry.sourceIdx);
      if (safeIdx !== store.getActiveSource(compoundKey(layer))) {
        changes.push(switchSource(layer, compoundKey(layer), safeIdx, wrapper));
      }
    } else if (isOn && isExternalLayer(layer) && hashEntry.settings) {
      const runtime = getExternalLayerRuntime(layer);
      if (runtime && !externalSettingsMatch(runtime.settings, hashEntry.settings)) {
        changes.push(
          updateExternalVariant(layer, hashEntry.settings, eyeBtn, wrapper)
            .then((updated) =>
              renderExternalControls(layer, updated, eyeBtn, wrapper, getExternalLayerDefinition(layer)),
            )
            .catch((error) => console.warn(`Failed to restore external variant for ${layer.key}:`, error)),
        );
      }
    }
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
      toggleLayer(layer, eyeBtn, wrapper);
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
    if (!open && eyeBtn && !isLayerApplied(layer, eyeBtn)) {
      toggleLayer(layer, eyeBtn, wrapper, null, false);
    }
  };

  header.addEventListener("click", toggleAccordion);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleAccordion();
    }
  });

  return { wrapper, eyeBtn };
}

async function toggleLayer(layer, eyeBtn, wrapper, initialExternalSettings = null, expandOnActivate = true) {
  // Guard: SDK must be ready before attempting map operations
  if (!isSDKReady()) {
    const label = wrapper.querySelector(".layer-label");
    const msg = label
      ? `${label.textContent} cannot be toggled yet — map is still loading.`
      : "Map is still loading.";
    console.warn(msg);
    return;
  }

  // A source switch is mid-flight: defer a turn-off until it settles, otherwise
  // the switch would re-add its new view after the layer was turned off.
  if (layer.key && sourceSwitchInFlight.has(layer.key)) {
    pendingToggleOff.add(layer.key);
    setLayerRecord(layer, { desired: false });
    return;
  }

  // Guard: prevent concurrent toggles for the same layer (rapid clicks / secondary + primary race)
  if (layer.key && toggleInFlight.has(layer.key)) return;
  if (layer.key) toggleInFlight.add(layer.key);
  const external = isExternalLayer(layer);
  if (external) setLayerToggleDisabled(layer, eyeBtn, true);

  try {
    const widgetSlot = wrapper.querySelector(".layer-widget-slot");
    const sliderSlot = wrapper.querySelector(".layer-slider-slot");
    const legendSlot = wrapper.querySelector(".layer-legend-slot");
    const compound = isCompound(layer);
    const externalDefinition = external ? getExternalLayerDefinition(layer) : null;
    // Determine which view ID is currently active
    const key = compound ? compoundKey(layer) : null;
    // Guard against an out-of-bounds index (defensive; config is validated)
    const activeIdx = compound ? safeSourceIdx(layer, store.getActiveSource(key)) : 0;
    let runtime = external ? getExternalLayerRuntime(layer) : null;
    let activeViewId = external ? runtime?.idView : compound ? layer.sources[activeIdx].id : layer.id;

    // Is this layer currently on? For compound layers, check if ANY source is open.
    const isOn = external
      ? Boolean(runtime)
      : compound
        ? layer.sources.some((s) => store.openViews.has(s.id))
        : store.openViews.has(layer.id);

    if (isOn) {
      setLayerRecord(layer, { desired: false, status: "removing" });
      // Turn off -- remove whichever source view is active
      const removeId = external
        ? runtime.idView
        : compound
          ? layer.sources.find((s) => store.openViews.has(s.id))?.id
          : layer.id;
      if (removeId) {
        try {
          if (external) {
            await closeExternalLayer(layer);
          } else {
            await viewRemove(removeId);
          }
        } catch (err) {
          // MapX may still show the view, so every layer kind stays on in the
          // toggles, cross-tab rows, openViews and hash rather than desync.
          console.warn(`Failed to remove view ${removeId}; keeping ${layer.key || removeId} on:`, err);
          setLayerRecord(layer, { desired: true, status: "idle" });
          return;
        }
      }
      // Removes the view from openViews and writes the hash.
      setLayerRecord(layer, { applied: false, viewId: null, status: "idle" });
      setLayerToggleState(layer, eyeBtn, false);
      for (const { eyeBtn: btn } of secondaryRows.get(layer.key) ?? []) {
        setLayerToggleState(layer, btn, false);
      }
      setSecondaryState(layer, null);
      wrapper.classList.remove("layer-active");
      widgetSlot.innerHTML = "";
      sliderSlot.innerHTML = "";
      legendSlot.innerHTML = "";

      // Turning a layer off ends the interaction and returns the row to its
      // compact state. Collapsing alone still leaves an active layer on.
      setAccordionExpanded(wrapper, false);
    } else {
      // Turn on
      setLayerRecord(layer, { desired: true, status: "loading", error: null });
      let externalStatus = null;
      if (external && expandOnActivate) {
        setAccordionExpanded(wrapper, true);

        widgetSlot.innerHTML = "";
        externalStatus = document.createElement("p");
        externalStatus.className = "external-layer-status";
        externalStatus.setAttribute("aria-live", "polite");
        externalStatus.textContent = `Loading ${layer.label}…`;
        widgetSlot.appendChild(externalStatus);
      }
      if (external) setSecondaryState(layer, { status: { text: `Loading ${layer.label}…` } });

      try {
        if (external) {
          runtime = await openExternalLayer(layer, initialExternalSettings ?? layer.external.defaults);
          activeViewId = runtime.idView;
        } else {
          await viewAdd(activeViewId);
        }
      } catch (err) {
        console.warn(`Failed to add layer ${layer.key || activeViewId}:`, err);
        if (externalStatus) {
          externalStatus.classList.add("is-error");
          externalStatus.textContent = `Could not load ${layer.label}. Please try again.`;
        }
        if (external) {
          setSecondaryState(layer, {
            status: { text: `Could not load ${layer.label}. Please try again.`, isError: true },
          });
        }
        setLayerRecord(layer, { desired: false, status: "error", error: err });
        return;
      }
      // Adds the view to openViews and writes the hash.
      setLayerRecord(layer, {
        applied: true,
        viewId: activeViewId,
        sourceIdx: activeIdx,
        settings: external ? runtime.settings : null,
        status: "idle",
      });
      setLayerToggleState(layer, eyeBtn, true);
      for (const { eyeBtn: btn } of secondaryRows.get(layer.key) ?? []) {
        setLayerToggleState(layer, btn, true);
        // Auto-expand the cross-tab section containing this button
        const section = btn.closest("details.cross-tab-section");
        if (section) section.open = true;
      }
      wrapper.classList.add("layer-active");

      // Direct switch activation reveals controls. Header activation already
      // manages expansion and must not reopen after a slow MapX response.
      if (expandOnActivate) setAccordionExpanded(wrapper, true);

      // Build source-switching widget for compound layers
      if (compound && layer.widget) {
        const descEl = wrapper.querySelector(".layer-desc");
        const widgetEl = buildWidget(layer.widget, layer.sources, activeIdx, (newIdx) =>
          switchSource(layer, key, newIdx, wrapper),
        );
        if (widgetEl) widgetSlot.appendChild(widgetEl);

        // Show the active source's description instead of the parent's
        if (descEl) {
          setLayerDescription(descEl, layer, layer.sources[activeIdx].desc || layer.desc);
        }
      }

      if (external) {
        renderExternalControls(layer, runtime, eyeBtn, wrapper, externalDefinition);
      }

      addOpacitySlider(activeViewId, sliderSlot);
      // For compound layers, merge the active source's fields (desc, legend)
      // onto the parent layer so addLegend sees the right data.
      const legendLayer = external
        ? { ...layer, id: activeViewId, legend: runtime.legend }
        : compound
          ? { ...layer, ...layer.sources[activeIdx], label: layer.label }
          : layer;
      addLegend(legendLayer, legendSlot);
      setSecondaryState(layer, { viewId: activeViewId, legendLayer });
    }
  } finally {
    if (external) setLayerToggleDisabled(layer, eyeBtn, false);
    if (layer.key) toggleInFlight.delete(layer.key);
  }
}

/**
 * Switch between sources within a compound layer.
 * Removes the old view, adds the new one, and rebuilds controls.
 * @returns {Promise<boolean>} false if the switch was rejected (another change
 *   is in flight) or failed, so the source widget can show the actual source
 */
async function switchSource(layer, key, newIdx, wrapper) {
  if (layer.key && (toggleInFlight.has(layer.key) || sourceSwitchInFlight.has(layer.key))) return false;
  if (layer.key) {
    toggleInFlight.add(layer.key);
    sourceSwitchInFlight.add(layer.key);
  }
  setLayerRecord(layer, { status: "switching" });
  let switched;
  try {
    switched = await applySourceSwitch(layer, key, newIdx, wrapper);
  } finally {
    setLayerRecord(layer, { status: "idle" });
    if (layer.key) {
      toggleInFlight.delete(layer.key);
      sourceSwitchInFlight.delete(layer.key);
    }
  }
  if (layer.key && pendingToggleOff.delete(layer.key)) {
    const el = layerElementMap.get(layer.key);
    if (el && isLayerApplied(el.layer, el.eyeBtn)) await toggleLayer(layer, el.eyeBtn, el.wrapper);
  }
  return switched;
}

async function applySourceSwitch(layer, key, newIdx, wrapper) {
  const oldIdx = store.getActiveSource(key);
  const oldId = layer.sources[oldIdx].id;
  const newId = layer.sources[newIdx].id;
  if (oldId === newId) return true;

  // Remove old, add new
  try {
    await viewRemove(oldId);
  } catch (e) {
    console.warn(e);
  }
  // The layer stays on, but no view carries it until the new one is added.
  setLayerRecord(layer, { viewId: null });

  try {
    await viewAdd(newId);
  } catch (e) {
    // Rollback: re-add old view if new one fails
    console.warn(`Failed to switch to source ${newIdx}:`, e);
    try {
      await viewAdd(oldId);
      setLayerRecord(layer, { viewId: oldId });
    } catch {
      /* */
    }
    return false;
  }
  store.setActiveSource(key, newIdx);
  // Adds the new view to openViews and writes the hash.
  setLayerRecord(layer, { viewId: newId, sourceIdx: newIdx });

  // Update description to the new source's text
  const descEl = wrapper.querySelector(".layer-desc");
  if (descEl) {
    setLayerDescription(descEl, layer, layer.sources[newIdx].desc || layer.desc);
  }

  // Rebuild opacity slider and legend for the new source
  const sliderSlot = wrapper.querySelector(".layer-slider-slot");
  const legendSlot = wrapper.querySelector(".layer-legend-slot");
  sliderSlot.innerHTML = "";
  addOpacitySlider(newId, sliderSlot);

  legendSlot.innerHTML = "";
  const legendLayer = { ...layer, ...layer.sources[newIdx], label: layer.label };
  addLegend(legendLayer, legendSlot);
  setSecondaryState(layer, { viewId: newId, legendLayer });
  return true;
}

function setLayerDescription(element, layer, description) {
  const initiative = layer.initiative?.trim();
  const initiativeSentence = initiative ? (/[.!?]$/.test(initiative) ? initiative : `${initiative}.`) : "";
  element.textContent = [initiativeSentence, description?.trim()].filter(Boolean).join(" ");
}

/**
 * Build collapsed <details> sections for all tabs other than the current one.
 * Each section shows a compact row per published layer (label + type tag + eye toggle).
 * Eye toggles delegate to the canonical eye button in layerElementMap.
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
 * the layer's home tab. Registered in secondaryRows so toggleLayer keeps it in
 * sync; `tabId` is the tab panel the row lives in (rendered only when visible).
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
    layerElementMap.get(layer.key)?.eyeBtn.click();
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
