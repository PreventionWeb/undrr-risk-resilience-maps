/**
 * Static info panels: Sources and About.
 * Full-page views using UNDRR Mangrove design system classes.
 */

import { downloadLayerInventory } from "../utils/export-layers.js";
import { escapeHtml } from "../utils/html.js";
import { getLayerStatus } from "../config/layers/status.js";
import { TABS } from "../config/layers/index.js";

// ── Sources ───────────────────────────────────────────────────────────────────

const STATUS_LABEL_MODIFIERS = {
  "Awaiting data": "waiting-information",
  "Pending removal": "negative",
};

function statusLabel(status) {
  const modifier = STATUS_LABEL_MODIFIERS[status] || "draft";
  return `<span class="data-table__badge mg-status-label mg-status-label--${modifier}"><span class="mg-status-label__indicator" aria-hidden="true"></span>${escapeHtml(status)}</span> `;
}

function sourceCell(source, url) {
  if (!source) return "";
  return url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(source)}</a>`
    : escapeHtml(source);
}

function mapxIds(layer) {
  if (layer.external) return "— (external runtime)";
  if (layer.sources && layer.sources.length) {
    return layer.sources.map((s) => s.id || "—").join("\n");
  }
  return layer.id || "—";
}

function buildSourcesTable(layers) {
  const rows = layers
    .map((layer) => {
      const status = getLayerStatus(layer);
      const isTrackedOnly = status !== "Active";
      const rowClass = isTrackedOnly ? ' class="data-table__row--planned"' : "";
      const statusBadge = isTrackedOnly ? statusLabel(status) : "";
      const ids = mapxIds(layer);
      // `mg-table__td--code` puts the cell in Mangrove's code face, so the ids
      // no longer need a `<code>` element each.
      const idCell = ids
        .split("\n")
        .map((id) => escapeHtml(id))
        .join("<br>");
      return `
      <tr${rowClass}>
        <td>${statusBadge}${escapeHtml(layer.label)}</td>
        <td class="data-table__mapx-id mg-table__td--code">${idCell}</td>
        <td>${sourceCell(layer.source, layer.sourceUrl)}</td>
        <td>${escapeHtml(layer.citation)}</td>
        <td class="data-table__license">${sourceCell(layer.license, layer.licenseUrl)}</td>
        <td>${escapeHtml(layer.note || layer.desc)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="data-table-wrap mg-table-scroll-region" role="region" aria-label="Dataset sources table" tabindex="0">
      <table class="data-table mg-table mg-table--data">
        <thead>
          <tr>
            <th scope="col" class="mg-table__th--sticky">Dataset</th>
            <th scope="col" class="data-table__mapx-id mg-table__th--sticky">MapX ID</th>
            <th scope="col" class="mg-table__th--sticky">Source</th>
            <th scope="col" class="mg-table__th--sticky">Citation</th>
            <th scope="col" class="mg-table__th--sticky">License</th>
            <th scope="col" class="mg-table__th--sticky">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Build the Sources page.
 * @param {{ signal?: AbortSignal }} [options] - removes the page's listeners
 */
export function buildSourcesPanel({ signal } = {}) {
  // One tab per layer category. Mangrove's tabs script progressively enhances
  // this markup: it wires up ARIA, keyboard navigation and deep linking, and
  // with `data-mg-js-tabs-stack-on-mobile` it collapses the rail into stacked
  // disclosures below 480px. Without the script the panels simply render in
  // sequence, which is the pre-tabs behaviour.
  const tabItems = TABS.map((tab, i) => {
    const sectionId = `mg-tabs__section-sources-${i + 1}`;
    return `
      <li class="mg-tabs__item" role="presentation">
        <a class="mg-tabs__link" href="#${sectionId}" id="${sectionId}--trigger" data-tabs__item="${sectionId}" aria-controls="${sectionId}" role="tab">${escapeHtml(tab.label)}</a>
      </li>`;
  }).join("");

  const tabPanels = TABS.map((tab, i) => {
    const sectionId = `mg-tabs__section-sources-${i + 1}`;
    const available = tab.layers.filter((layer) => getLayerStatus(layer) === "Active");
    const planned = tab.layers.filter((layer) => getLayerStatus(layer) !== "Active");
    const plannedSection =
      planned.length > 0
        ? `
          <details class="sources-planned mg-details">
            <summary>Metrics under development (${planned.length})</summary>
            <p class="sources-planned__intro">These entries are retained for transparent prototype planning. Their data, methodology or publication status is not yet confirmed.</p>
            ${buildSourcesTable(planned)}
          </details>`
        : "";
    return `
      <div class="mg-tabs-content" data-mg-js-tabs-content="true">
        <section class="mg-tabs__section" id="${sectionId}" role="tabpanel" aria-labelledby="${sectionId}--trigger" tabindex="-1">
          <h2 class="info-page-section__title">${escapeHtml(tab.label)} Data</h2>
          <h3 class="info-source-subtitle">Available data</h3>
          ${available.length > 0 ? buildSourcesTable(available) : '<p class="info-source-empty">No datasets are currently published in this category.</p>'}
          ${plannedSection}
        </section>
      </div>`;
  }).join("");

  const categorySections = `
    <div class="info-page-section info-page-section--wide">
      <div class="mg-container">
        <article
          class="mg-tabs mg-tabs--horizontal"
          data-mg-js-tabs="true"
          data-mg-js-tabs-variant="horizontal"
          data-mg-js-tabs-stack-on-mobile
          data-mg-js-tabs-label="Data categories"
        >
          <div class="mg-tabs__rail">
            <div class="mg-tabs__scroll">
              <ul class="mg-tabs__list" role="tablist" aria-label="Data categories">${tabItems}</ul>
            </div>
          </div>
          <div class="mg-tabs__panels">${tabPanels}</div>
        </article>
      </div>
    </div>`;

  const panel = buildPanel(
    "sources",
    `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">Sources</h1>
        <p class="info-page-hero__intro">Attribution, citation, licensing and methodology information for published datasets. Metrics still under development are separated into collapsed planning sections.</p>
        <label class="sources-mapx-toggle mg-switch">
          <input type="checkbox" role="switch" class="mg-switch__input" data-action="toggle-mapx-ids">
          <span class="mg-switch__track" aria-hidden="true">
            <span class="mg-switch__thumb"></span>
          </span>
          <span class="mg-switch__label">Show MapX view IDs</span>
        </label>
      </div>
    </div>

    ${categorySections}

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Layer inventory</h2>
        <p>Download a full inventory of all data layers configured in this tool, including MapX view IDs, data types, source attribution, citation, license, and status notes.</p>
        <p>
          <button class="mg-button mg-button-secondary" data-action="download-inventory">
            Download layer inventory (CSV)
          </button>
        </p>
      </div>
    </div>
  `,
  );

  panel
    .querySelector("[data-action='download-inventory']")
    .addEventListener("click", downloadLayerInventory, { signal });

  panel.querySelector("[data-action='toggle-mapx-ids']").addEventListener(
    "change",
    (e) => {
      panel.classList.toggle("show-mapx-ids", e.target.checked);
    },
    { signal },
  );

  return panel;
}

// ── About ─────────────────────────────────────────────────────────────────────

export function buildAboutPanel() {
  return buildPanel(
    "about",
    `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">About</h1>
        <p class="info-page-hero__intro">The GRAR Metrics Facility Map Viewer is an interactive geospatial platform developed by UNDRR to make global risk and resilience data explorable and actionable.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">What is this tool?</h2>
        <p>The <strong>GRAR Metrics Facility Map Viewer</strong> (working title) is part of UNDRR's <a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener">Risk &amp; Resilience Metrics initiative</a> — an effort to close the resilience gap by translating disaster risk science into clear signals that decision-makers can act on.</p>
        <p>It provides a single visualization platform for global risk and resilience data layers: hazard exposure, economic impacts, vulnerability indicators, and resilience benchmarks across the eight hazards that cause 90% of all economic damage — floods, storms, drought, extreme heat, earthquake, tsunami, landslide, and wildfire.</p>
        <p>The map viewer is one component of a broader GRAR Metrics Facility that also includes country risk profiles and supporting analytical resources. Learn more at <a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener">undrr.org/building-risk-knowledge/risk-and-resilience</a>.</p>
      </div>
    </div>

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <div class="mg-highlight-box mg-highlight-box--secondary">
          <h3>Platform status</h3>
          <p>This tool is currently a <strong>prototype in active development</strong>, shared for interaction review and early stakeholder feedback. It does not yet reflect final data, branding, or functionality.</p>
          <ul>
            <li>Layer inventory is being confirmed — many entries are placeholders awaiting data.</li>
            <li>The name <em>GRAR Metrics Facility Map Viewer</em> is a working title and may change.</li>
            <li>Data, design, and structure are subject to change without notice.</li>
            <li>For questions or feedback, contact the UNDRR digital team.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">How it was built</h2>
        <p>This tool is built on the open-source interaction model and layer inventory of the <a href="https://global.infrastructureresilience.org" target="_blank" rel="noopener">Global Infrastructure Resilience (GRI) Risk Viewer</a>, developed by the <a href="https://opsis.eci.ox.ac.uk/" target="_blank" rel="noopener">Oxford Programme for Sustainable Infrastructure Systems (OPSIS)</a> at the University of Oxford. The GRI platform itself is the result of collaboration across the infrastructure resilience research community.</p>
        <p>All geospatial layers are hosted, served, and rendered through <a href="https://app.mapx.org/" target="_blank" rel="noopener">MapX</a>, a global geospatial platform developed by <a href="https://unepgrid.ch/" target="_blank" rel="noopener">UNEP/GRID-Geneva</a>. The user interface uses the <a href="https://github.com/unisdr/undrr-mangrove" target="_blank" rel="noopener">UNDRR Mangrove</a> design system.</p>
        <p>The source code for this map viewer is publicly available on <a href="https://github.com/PreventionWeb/undrr-risk-resilience-maps" target="_blank" rel="noopener">GitHub</a>.</p>
      </div>
    </div>

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <h2 class="info-page-section__title">Acknowledgements</h2>
        <ul class="info-plain-list">
          <li><strong>Oxford OPSIS / GRI</strong> — interaction model, layer inventory structure, and open-source codebase this tool builds upon.</li>
          <li><strong>UNEP/GRID-Geneva — MapX</strong> — geospatial data hosting, rendering, and map interactivity.</li>
          <li><strong>Data providers</strong> — GEM, JRC, GIRI/UNEP, and others listed in full on the <a href="#sources">Sources</a> page.</li>
          <li><strong>UNDRR</strong> — programme ownership, branding, and the broader Risk and Resilience Metrics initiative.</li>
        </ul>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Further reading</h2>
        <ul class="info-plain-list">
          <li><a href="https://www.undrr.org/building-risk-knowledge/risk-and-resilience" target="_blank" rel="noopener">UNDRR Risk &amp; Resilience — initiative overview and country profiles</a></li>
          <li><a href="https://global.infrastructureresilience.org" target="_blank" rel="noopener">GRI Risk Viewer — the open-source platform this tool is based on</a></li>
          <li><a href="https://app.mapx.org/" target="_blank" rel="noopener">MapX — UNEP/GRID-Geneva geospatial platform</a></li>
          <li><a href="https://github.com/PreventionWeb/undrr-risk-resilience-maps" target="_blank" rel="noopener">Source code on GitHub</a></li>
        </ul>
      </div>
    </div>
  `,
  );
}

/**
 * An info page panel, marked with its tab id. Panels carry no element id, so
 * a rebuilt or second sidebar creates no duplicate ids.
 */
function buildPanel(tabId, innerHTML) {
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.dataset.tabPanel = tabId;
  el.innerHTML = innerHTML;
  return el;
}
