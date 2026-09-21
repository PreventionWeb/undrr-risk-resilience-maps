/**
 * Layer panel content for data tabs: one `.tab-panel` per tab (intro, R2R
 * groups or a flat list of full layer rows, the empty state) and the collapsed
 * cross-tab sections that list other tabs' published layers as compact rows.
 *
 * These builders only create DOM. Rows come from the caller's `addRow`, which
 * creates them (see createLayerRow) and registers them with the sidebar
 * instance for record updates and destroy. Nothing here queries the document
 * or registers listeners outside the rows.
 */
import { isLayerAvailable } from "../config/layers/status.js";

export const EMPTY_TAB_MESSAGE =
  'No layers are currently published in this category. Use "Show disabled" to review unpublished entries retained for prototype review.';

/**
 * @callback AddRow
 * @param {object} layer
 * @param {"full"|"compact"} variant
 * @param {string} tabId - the tab panel the row is in
 * @returns {{ element: HTMLElement }}
 */

/**
 * The "nothing published here" message, as Mangrove's empty-state component
 * (compact panel variant: a description only, at sidebar scale).
 * @param {boolean} hidden
 * @returns {HTMLElement}
 */
function buildEmptyState(hidden) {
  const empty = document.createElement("div");
  empty.className = "tab-panel-empty mg-empty-state mg-empty-state--compact mg-empty-state--panel";
  empty.hidden = hidden;
  const description = document.createElement("p");
  description.className = "mg-empty-state__description";
  description.textContent = EMPTY_TAB_MESSAGE;
  empty.appendChild(description);
  return empty;
}

/**
 * Build a data tab's panel: intro, empty state and a full row per layer,
 * grouped when the tab has R2R groups. Unpublished layers are marked
 * `data-layer-disabled` and hidden unless `showDisabled`.
 * @param {object} tab - a TABS entry
 * @param {{ addRow: AddRow, showDisabled?: boolean }} options
 * @returns {HTMLElement}
 */
export function buildTabPanel(tab, { addRow, showDisabled = false }) {
  const tabPanel = document.createElement("div");
  tabPanel.className = "tab-panel";
  tabPanel.dataset.tabPanel = tab.id;
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
  tabPanel.appendChild(buildEmptyState(publishedLayers.length > 0));

  const addLayersToContainer = (layers, container) => {
    for (const layer of layers) {
      const { element: wrapper } = addRow(layer, "full", tab.id);
      if (!isLayerAvailable(layer)) {
        wrapper.hidden = !showDisabled;
        wrapper.dataset.layerDisabled = "true";
        wrapper.classList.add("layer-disabled");
      }
      container.appendChild(wrapper);
    }
  };

  if (tab.groups) {
    // Mangrove's accordion, flush variant (documented for sidebars and panels):
    // one container around the whole disclosure stack. It supplies the summary
    // chevron and its reduced-motion handling, the 2.75rem hit target and the
    // inset focus ring; layer-accordion.css only scales the type back to panel
    // size. The `<details>` elements stay exactly as they were.
    const groups = document.createElement("div");
    groups.className = "layer-groups mg-accordion mg-accordion--flush";

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

      groups.appendChild(groupEl);
    }

    tabPanel.appendChild(groups);
  } else {
    addLayersToContainer(tab.layers, tabPanel);
  }

  return tabPanel;
}

/**
 * Apply "Show disabled" to one tab panel: unpublished rows, groups left with no
 * visible rows, and the empty state (shown when the tab has no published layers
 * and disabled layers are hidden).
 * @param {HTMLElement} tabPanel - built by buildTabPanel
 * @param {object} tab - the TABS entry it was built from
 * @param {boolean} showDisabled
 */
export function updateDisabledLayerVisibility(tabPanel, tab, showDisabled) {
  for (const wrapper of tabPanel.querySelectorAll("[data-layer-disabled='true']")) {
    wrapper.hidden = !showDisabled;
  }

  // Show/hide collapsible groups based on whether they have any visible items
  for (const groupEl of tabPanel.querySelectorAll(".layer-group")) {
    const items = groupEl.querySelector(".layer-group-items");
    if (!items) continue;
    groupEl.hidden = !Array.from(items.children).some((el) => !el.hidden);
  }

  const hasPublishedLayers = tab.layers.some(isLayerAvailable);
  const empty = tabPanel.querySelector(".tab-panel-empty");
  if (empty) empty.hidden = hasPublishedLayers || showDisabled;
}

/**
 * Build collapsed <details> sections for all tabs other than the current one.
 * Each section shows a compact row per published layer (the compact variant of
 * createLayerRow: label, type tag, switch, and details while the layer is on).
 * @param {object} currentTab - the TABS entry whose panel gets the sections
 * @param {object[]} tabs - every TABS entry, in nav order
 * @param {{ addRow: AddRow }} options
 * @returns {HTMLElement}
 */
export function buildCrossTabSections(currentTab, tabs, { addRow }) {
  // The same flush Mangrove accordion as the layer groups above.
  const container = document.createElement("div");
  container.className = "cross-tab-sections mg-accordion mg-accordion--flush";

  const currentCollection = currentTab.collection ?? "r2r";
  if (currentTab.crossTab === false) return container;

  for (const tab of tabs) {
    const tabCollection = tab.collection ?? "r2r";
    if (tab.id === currentTab.id || tab.crossTab === false || tabCollection !== currentCollection) continue;

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
          details.appendChild(addRow(layer, "compact", currentTab.id).element);
        }
      }
    } else {
      for (const layer of publishedLayers) {
        details.appendChild(addRow(layer, "compact", currentTab.id).element);
      }
    }

    container.appendChild(details);
  }

  return container;
}
