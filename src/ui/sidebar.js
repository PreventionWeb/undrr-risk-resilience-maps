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
import { buildWidget, isCompound, compoundKey } from "./widgets/index.js";
import { makeDraggable, makeResizable, onPanelCollapse, onPanelExpand } from "../utils/panels.js";
import { parseHash, writeHash } from "../state/hash.js";
import { addOpacitySlider, addLegend } from "./layer-controls.js";
import { buildExternalControls } from "./external-controls.js";
import { isLayerPublished } from "../config/layers/status.js";
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

// Built by buildSidebar(); maps layer.key → { layer, eyeBtn, wrapper }
// Used by restoreLayersFromHash and reconcileLayersFromHash to avoid
// positional DOM queries that break when layer order changes in config.
const layerElementMap = new Map();
// Maps layer.key → [secondary eye buttons] across cross-tab sections.
const secondaryEyeBtns = new Map();
// Keys of layers whose toggle is currently in-flight (prevents race on rapid clicks).
const toggleInFlight = new Set();
let showDisabledLayers = false;

function setLayerToggleDisabled(layer, eyeBtn, disabled) {
  eyeBtn.disabled = disabled;
  for (const btn of secondaryEyeBtns.get(layer.key) ?? []) {
    btn.disabled = disabled;
  }
}

function setLayerToggleState(layer, button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-checked", String(active));
  button.setAttribute("aria-label", `${active ? "Turn off" : "Turn on"} ${layer.label}`);
  button.title = active ? "Turn layer off" : "Turn layer on";
}

function externalSettingsMatch(left, right) {
  if (!left || !right) return false;
  return Object.keys(right).every((key) => left[key] === right[key]);
}

async function updateExternalVariant(
  layer,
  settings,
  eyeBtn,
  wrapper,
  externalDefinition,
  updateHash = true,
) {
  const sliderSlot = wrapper.querySelector(".layer-slider-slot");
  const legendSlot = wrapper.querySelector(".layer-legend-slot");
  if (layer.key) toggleInFlight.add(layer.key);
  setLayerToggleDisabled(layer, eyeBtn, true);
  try {
    const result = await replaceExternalLayer(layer, settings);
    store.openViews.delete(result.previousIdView);
    store.openViews.add(result.runtime.idView);

    sliderSlot.innerHTML = "";
    addOpacitySlider(result.runtime.idView, sliderSlot);
    legendSlot.innerHTML = "";
    addLegend({ ...layer, id: result.runtime.idView, legend: result.runtime.legend }, legendSlot);
    if (updateHash) syncHashFromState();
    return result.runtime;
  } finally {
    setLayerToggleDisabled(layer, eyeBtn, false);
    if (layer.key) toggleInFlight.delete(layer.key);
  }
}

function renderExternalControls(layer, runtime, eyeBtn, wrapper, externalDefinition) {
  const widgetSlot = wrapper.querySelector(".layer-widget-slot");
  widgetSlot.innerHTML = "";
  const controls = buildExternalControls(externalDefinition, runtime.settings, (settings) =>
    updateExternalVariant(layer, settings, eyeBtn, wrapper, externalDefinition),
  );
  widgetSlot.appendChild(controls);
}

/**
 * Build the UI and wire up all nav links.
 */
export function buildSidebar() {
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
      for (const { eyeBtn } of layerElementMap.values()) {
        if (eyeBtn.classList.contains("is-active")) eyeBtn.click();
      }
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
  secondaryEyeBtns.clear();

  // Populate info page with all info panels
  infoPage.appendChild(buildHomePanel());
  infoPage.appendChild(buildSourcesPanel());
  infoPage.appendChild(buildAboutPanel());

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

    const publishedLayers = tab.layers.filter(isLayerPublished);
    const empty = document.createElement("p");
    empty.className = "tab-panel-empty mg-form-help";
    empty.textContent =
      'No layers are currently published in this category. Use "Show disabled" to review unpublished entries retained for prototype review.';
    empty.hidden = publishedLayers.length > 0;
    tabPanel.appendChild(empty);

    const addLayersToContainer = (layers, container) => {
      for (const layer of layers) {
        const { wrapper, eyeBtn } = buildLayerAccordion(layer);
        if (!isLayerPublished(layer)) {
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
  const { tab: hashTab } = parseHash();
  const initialTab = hashTab && ALL_TABS.includes(hashTab) ? hashTab : store.activeTab;
  // Preserve a valid incoming hash until MapX is ready and can restore its
  // layers. Writing empty runtime state here would erase the shared link.
  switchTab(initialTab, { syncHash: !hashTab || !ALL_TABS.includes(hashTab) });

  // Browser back/forward: reconcile both tab and layer state from the new hash
  window.addEventListener("hashchange", () => {
    const { tab, layers: hashLayers } = parseHash();
    if (tab && ALL_TABS.includes(tab) && tab !== store.activeTab) switchTab(tab);
    if (isSDKReady()) reconcileLayersFromHash(hashLayers);
  });

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

function switchTab(tabId, { syncHash = true } = {}) {
  store.setActiveTab(tabId);
  if (syncHash) syncHashFromState();

  const appMap = document.getElementById("app-map");
  const infoPage = document.getElementById("info-page");
  const isInfoTab = INFO_TABS.includes(tabId);

  // Toggle map vs full-page info view
  appMap.style.display = isInfoTab ? "none" : "";
  infoPage.style.display = isInfoTab ? "block" : "none";

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

    const hasPublishedLayers = tab.layers.some(isLayerPublished);
    const empty = tabPanel.querySelector(".tab-panel-empty");
    if (empty) empty.hidden = hasPublishedLayers || showDisabledLayers;
  }
}

/**
 * Write current state (active tab + open layers) to the URL hash.
 * Called after every tab switch, layer toggle, and source switch.
 */
function syncHashFromState() {
  const layers = [];
  for (const tab of TABS) {
    for (const layer of tab.layers) {
      if (!layer.key || layer.disabled) continue;
      const compound = isCompound(layer);
      if (compound) {
        const activeSource = layer.sources.find((s) => store.openViews.has(s.id));
        if (activeSource) {
          const idx = layer.sources.indexOf(activeSource);
          layers.push({ key: layer.key, sourceIdx: idx });
        }
      } else if (isExternalLayer(layer)) {
        const runtime = getExternalLayerRuntime(layer);
        if (runtime) {
          layers.push({ key: layer.key, sourceIdx: 0, settings: runtime.settings });
        }
      } else if (store.openViews.has(layer.id)) {
        layers.push({ key: layer.key, sourceIdx: 0 });
      }
    }
  }
  writeHash(store.activeTab, layers);
  updateClearBtn();
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
  const { layers } = parseHash();
  if (layers.length === 0) return;

  for (const { key, sourceIdx, settings } of layers) {
    const el = layerElementMap.get(key);
    if (!el) continue;
    const { layer, eyeBtn } = el;

    if (isCompound(layer)) {
      // Always set source index — even 0, to clear any prior state
      store.setActiveSource(compoundKey(layer), safeSourceIdx(layer, sourceIdx));
    }

    if (!eyeBtn.classList.contains("is-active")) {
      if (isExternalLayer(layer)) {
        await toggleLayer(layer, eyeBtn, el.wrapper, settings);
      } else {
        eyeBtn.click();
      }
    }
  }
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

  for (const [key, { layer, eyeBtn, wrapper }] of layerElementMap) {
    const isOn = eyeBtn.classList.contains("is-active");
    const hashEntry = targetMap.get(key);
    const shouldBeOn = Boolean(hashEntry);

    if (isOn && !shouldBeOn) {
      eyeBtn.click(); // turn off
    } else if (!isOn && shouldBeOn) {
      if (isCompound(layer)) {
        // Always set — including 0 — so any prior source state is cleared
        store.setActiveSource(compoundKey(layer), safeSourceIdx(layer, hashEntry.sourceIdx));
      }
      if (isExternalLayer(layer)) {
        await toggleLayer(layer, eyeBtn, wrapper, hashEntry.settings);
      } else {
        eyeBtn.click(); // turn on
      }
    } else if (isOn && shouldBeOn && isCompound(layer)) {
      // Layer stays on: switch source if hash encodes a different index
      const safeIdx = safeSourceIdx(layer, hashEntry.sourceIdx);
      const currentIdx = store.getActiveSource(compoundKey(layer));
      if (safeIdx !== currentIdx) {
        const descEl = wrapper.querySelector(".layer-desc");
        const sliderSlot = wrapper.querySelector(".layer-slider-slot");
        const legendSlot = wrapper.querySelector(".layer-legend-slot");
        await switchSource(layer, compoundKey(layer), safeIdx, descEl, sliderSlot, legendSlot);
      }
    } else if (isOn && shouldBeOn && isExternalLayer(layer) && hashEntry.settings) {
      const runtime = getExternalLayerRuntime(layer);
      if (runtime && !externalSettingsMatch(runtime.settings, hashEntry.settings)) {
        const externalDefinition = getExternalLayerDefinition(layer);
        try {
          const updated = await updateExternalVariant(
            layer,
            hashEntry.settings,
            eyeBtn,
            wrapper,
            externalDefinition,
            false,
          );
          renderExternalControls(layer, updated, eyeBtn, wrapper, externalDefinition);
        } catch (error) {
          console.warn(`Failed to restore external variant for ${layer.key}:`, error);
        }
      }
    }
  }
}

export function buildLayerAccordion(layer) {
  const published = isLayerPublished(layer);

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
    body.style.display = open ? "none" : "block";
    arrow.textContent = open ? "\u25B6" : "\u25BC"; // ▶ / ▼
    header.setAttribute("aria-expanded", String(!open));

    // Expanding a published layer is an activation intent. Collapsing only
    // hides its controls; the layer remains on until its switch is turned off.
    if (!open && eyeBtn && !eyeBtn.classList.contains("is-active")) {
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
    const activeIdx = compound ? store.getActiveSource(key) : 0;
    // Guard against out-of-bounds active index (defensive; shouldn't happen with validated config)
    const safeIdx = compound && activeIdx < layer.sources.length ? activeIdx : 0;
    let runtime = external ? getExternalLayerRuntime(layer) : null;
    let activeViewId = external ? runtime?.idView : compound ? layer.sources[safeIdx].id : layer.id;

    // Is this layer currently on? For compound layers, check if ANY source is open.
    const isOn = external
      ? Boolean(runtime)
      : compound
        ? layer.sources.some((s) => store.openViews.has(s.id))
        : store.openViews.has(layer.id);

    if (isOn) {
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
          console.warn(`Failed to remove view ${removeId}:`, err);
          if (external) return;
        }
        store.openViews.delete(removeId);
      }
      setLayerToggleState(layer, eyeBtn, false);
      for (const btn of secondaryEyeBtns.get(layer.key) ?? []) {
        setLayerToggleState(layer, btn, false);
      }
      wrapper.classList.remove("layer-active");
      widgetSlot.innerHTML = "";
      sliderSlot.innerHTML = "";
      legendSlot.innerHTML = "";

      // Turning a layer off ends the interaction and returns the row to its
      // compact state. Collapsing alone still leaves an active layer on.
      const body = wrapper.querySelector(".layer-body");
      const header = wrapper.querySelector(".layer-header");
      const arrow = wrapper.querySelector(".layer-arrow");
      body.style.display = "none";
      arrow.textContent = "\u25B6";
      header.setAttribute("aria-expanded", "false");
      syncHashFromState();
    } else {
      // Turn on
      let externalStatus = null;
      if (external && expandOnActivate) {
        const body = wrapper.querySelector(".layer-body");
        const header = wrapper.querySelector(".layer-header");
        const arrow = wrapper.querySelector(".layer-arrow");
        body.style.display = "block";
        arrow.textContent = "\u25BC";
        header.setAttribute("aria-expanded", "true");

        widgetSlot.innerHTML = "";
        externalStatus = document.createElement("p");
        externalStatus.className = "external-layer-status";
        externalStatus.setAttribute("aria-live", "polite");
        externalStatus.textContent = `Loading ${layer.label}…`;
        widgetSlot.appendChild(externalStatus);
      }

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
        return;
      }
      store.openViews.add(activeViewId);
      setLayerToggleState(layer, eyeBtn, true);
      for (const btn of secondaryEyeBtns.get(layer.key) ?? []) {
        setLayerToggleState(layer, btn, true);
        // Auto-expand the cross-tab section containing this button
        const section = btn.closest("details.cross-tab-section");
        if (section) section.open = true;
      }
      wrapper.classList.add("layer-active");

      // Direct switch activation reveals controls. Header activation already
      // manages expansion and must not reopen after a slow MapX response.
      if (expandOnActivate) {
        const body = wrapper.querySelector(".layer-body");
        const header = wrapper.querySelector(".layer-header");
        const arrow = wrapper.querySelector(".layer-arrow");
        body.style.display = "block";
        arrow.textContent = "\u25BC";
        header.setAttribute("aria-expanded", "true");
      }

      // Build source-switching widget for compound layers
      if (compound && layer.widget) {
        const descEl = wrapper.querySelector(".layer-desc");
        const widgetEl = buildWidget(layer.widget, layer.sources, activeIdx, (newIdx) =>
          switchSource(layer, key, newIdx, descEl, sliderSlot, legendSlot),
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
      syncHashFromState();
    }
  } finally {
    if (external) setLayerToggleDisabled(layer, eyeBtn, false);
    if (layer.key) toggleInFlight.delete(layer.key);
  }
}

/**
 * Switch between sources within a compound layer.
 * Removes the old view, adds the new one, and rebuilds controls.
 */
async function switchSource(layer, key, newIdx, descEl, sliderSlot, legendSlot) {
  const oldIdx = store.getActiveSource(key);
  const oldId = layer.sources[oldIdx].id;
  const newId = layer.sources[newIdx].id;
  if (oldId === newId) return;

  // Remove old, add new
  try {
    await viewRemove(oldId);
  } catch (e) {
    console.warn(e);
  }
  store.openViews.delete(oldId);

  try {
    await viewAdd(newId);
  } catch (e) {
    // Rollback: re-add old view if new one fails
    console.warn(`Failed to switch to source ${newIdx}:`, e);
    try {
      await viewAdd(oldId);
      store.openViews.add(oldId);
    } catch {
      /* */
    }
    return;
  }
  store.openViews.add(newId);
  store.setActiveSource(key, newIdx);
  syncHashFromState();

  // Update description to the new source's text
  if (descEl) {
    setLayerDescription(descEl, layer, layer.sources[newIdx].desc || layer.desc);
  }

  // Rebuild opacity slider and legend for the new source
  sliderSlot.innerHTML = "";
  addOpacitySlider(newId, sliderSlot);

  legendSlot.innerHTML = "";
  const legendLayer = { ...layer, ...layer.sources[newIdx], label: layer.label };
  addLegend(legendLayer, legendSlot);
}

function setLayerDescription(element, layer, description) {
  const initiative = layer.initiative?.trim();
  const initiativeSentence = initiative
    ? /[.!?]$/.test(initiative)
      ? initiative
      : `${initiative}.`
    : "";
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

    const publishedLayers = tab.layers.filter((l) => isLayerPublished(l) && l.key);
    if (publishedLayers.length === 0) continue;

    const details = document.createElement("details");
    details.className = "cross-tab-section";

    const summary = document.createElement("summary");
    summary.className = "cross-tab-summary";
    summary.textContent = tab.label;
    details.appendChild(summary);

    if (tab.groups) {
      for (const group of tab.groups) {
        const groupLayers = group.layers.filter((l) => isLayerPublished(l) && l.key);
        if (groupLayers.length === 0) continue;

        const groupHeading = document.createElement("p");
        groupHeading.className = "cross-tab-group-label";
        groupHeading.textContent = group.label;
        details.appendChild(groupHeading);

        for (const layer of groupLayers) {
          details.appendChild(buildCrossTabRow(layer));
        }
      }
    } else {
      for (const layer of publishedLayers) {
        details.appendChild(buildCrossTabRow(layer));
      }
    }

    container.appendChild(details);
  }

  return container;
}

/**
 * Build a single compact row for a cross-tab section.
 * Registers the eye button in secondaryEyeBtns so toggleLayer can keep it in sync.
 */
function buildCrossTabRow(layer) {
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

  if (!secondaryEyeBtns.has(layer.key)) secondaryEyeBtns.set(layer.key, []);
  secondaryEyeBtns.get(layer.key).push(eyeBtn);

  return row;
}
