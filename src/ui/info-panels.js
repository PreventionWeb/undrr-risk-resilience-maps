/**
 * Static info panels: Guide, Sources, Downloads.
 * Full-page views using UNDRR Mangrove design system classes.
 */

import { downloadLayerInventory } from "../utils/export-layers.js";
import { getLayerStatus } from "../config/layers/status.js";

// ── Guide ─────────────────────────────────────────────────────────────────────

const GUIDE_STEPS = [
  {
    title: "Select a category",
    desc: "Choose Risk, Resilience, Hazard, Exposure, or Vulnerability from the navigation bar. The layer panel updates to show published layers for that category.",
  },
  {
    title: "Enable a layer",
    desc: "Click the eye icon next to any layer name to toggle it on the map.",
  },
  {
    title: "Review disabled entries",
    desc: "Use <em>Show disabled</em> in the layer panel header to reveal unpublished review-only entries. Disabled entries stay visible for discussion, but they do not have eye toggles and cannot be turned on.",
  },
  {
    title: "Expand for details",
    desc: "Click a layer name to open its accordion and see a description, opacity slider, and legend.",
  },
  {
    title: "Adjust opacity",
    desc: "Use the slider to blend a layer with the basemap and compare multiple datasets.",
  },
  {
    title: "Inspect features",
    desc: "Click any map feature to see its attribute data in a popup.",
  },
  {
    title: "Return to this page",
    desc: "Click <em>UNDRR Resilience Maps</em> in the navigation bar at any time.",
  },
];

export function buildGuidePanel() {
  return buildPanel("tab-guide", `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">Guide</h1>
        <p class="info-page-hero__intro">A step-by-step guide to using the UNDRR Risk to Resilience Maps prototype.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Getting started</h2>
        <ol class="info-steps-list">
          ${GUIDE_STEPS.map((s, i) => `
            <li class="info-step">
              <span class="info-step__num">${String(i + 1).padStart(2, "0")}</span>
              <div class="info-step__content">
                <strong class="info-step__title">${s.title}</strong>
                <p class="info-step__desc">${s.desc}</p>
              </div>
            </li>
          `).join("")}
        </ol>
      </div>
    </div>

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <div class="mg-highlight-box mg-highlight-box--secondary">
          <h3>Notes</h3>
          <ul>
            <li>Layers marked as <em>coming soon</em> are not yet available.</li>
            <li>This tool is in active development. Data and design are subject to change.</li>
            <li>For questions or feedback, contact the UNDRR digital team.</li>
          </ul>
        </div>
      </div>
    </div>
  `);
}

// ── Sources ───────────────────────────────────────────────────────────────────

import { TABS } from "../config/layers/index.js";

// Platform-level credits not tied to any specific layer.
const PLATFORM_CREDITS = [
  {
    label: "MapX",
    url: "https://app.mapx.org/",
    detailHtml: '<a href="https://app.mapx.org/" target="_blank" rel="noopener">MapX</a> (<a href="https://unepgrid.ch/" target="_blank" rel="noopener">UNEP/GRID-Geneva</a>) is a core part of this tool\'s data workflow and map interactivity. All geospatial layers are hosted, served, and rendered through the MapX platform.',
  },
  {
    label: "GRI Risk Viewer",
    url: "https://global.infrastructureresilience.org",
    detailHtml: 'This tool is inspired by the <a href="https://global.infrastructureresilience.org" target="_blank" rel="noopener">GRI Risk Viewer</a> by <a href="https://opsis.eci.ox.ac.uk/" target="_blank" rel="noopener">Oxford OPSIS</a>. Layer inventory and interaction model adapted under attribution.',
  },
];

function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceCell(source, url) {
  if (!source) return "";
  return url
    ? `<a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(source)}</a>`
    : escHtml(source);
}

function buildSourcesTable(layers) {
  const rows = layers.map((layer) => {
    const status = getLayerStatus(layer);
    const isTrackedOnly = status !== "Active";
    const rowClass = isTrackedOnly ? ' class="data-table__row--planned"' : "";
    const statusBadge = isTrackedOnly
      ? `<span class="data-table__badge">${escHtml(status)}</span> `
      : "";
    return `
      <tr${rowClass}>
        <td>${statusBadge}${escHtml(layer.label)}</td>
        <td>${sourceCell(layer.source, layer.sourceUrl)}</td>
        <td>${escHtml(layer.citation)}</td>
        <td class="data-table__license">${escHtml(layer.license)}</td>
        <td>${escHtml(layer.note || layer.desc)}</td>
      </tr>`;
  }).join("");

  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Dataset</th>
            <th scope="col">Source</th>
            <th scope="col">Citation</th>
            <th scope="col">License</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function buildSourcesPanel() {
  const categorySections = TABS.map((tab) => {
    return `
      <div class="info-page-section info-page-section--wide">
        <div class="mg-container">
          <h2 class="info-page-section__title">${escHtml(tab.label)} Data</h2>
          ${buildSourcesTable(tab.layers)}
        </div>
      </div>`;
  }).join("");

  const platformRows = PLATFORM_CREDITS.map((e) => `
    <div class="info-source-entry">
      <p class="info-source-entry__label">${e.url
        ? `<a href="${escHtml(e.url)}" target="_blank" rel="noopener">${escHtml(e.label)}</a>`
        : escHtml(e.label)
      }</p>
      <p class="info-source-entry__detail">${e.detailHtml || escHtml(e.detail || "")}</p>
    </div>
  `).join("");

  const panel = buildPanel("tab-sources", `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">Sources</h1>
        <p class="info-page-hero__intro">Full attribution, citation, and licensing information for all datasets configured in this tool. Disabled layers remain listed for transparency during prototype review.</p>
      </div>
    </div>

    ${categorySections}

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <h2 class="info-page-section__title">Platform</h2>
        <div class="info-source-entries">${platformRows}</div>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">Layer inventory</h2>
        <p>Download a full inventory of all data layers configured in this tool, including MapX view IDs, data types, source attribution, citation, license, and status notes.</p>
        <p>
          <button id="btn-download-inventory" class="mg-button mg-button-secondary">
            Download layer inventory (CSV)
          </button>
        </p>
      </div>
    </div>
  `);

  panel.querySelector("#btn-download-inventory").addEventListener("click", downloadLayerInventory);

  return panel;
}


// ── Downloads ─────────────────────────────────────────────────────────────────

export function buildDownloadsPanel() {
  return buildPanel("tab-downloads", `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">Downloads</h1>
        <p class="info-page-hero__intro">Data download links will be added here as layers are confirmed and licensed for distribution.</p>
      </div>
    </div>

    <div class="info-page-section">
      <div class="mg-container">
        <h2 class="info-page-section__title">In the meantime</h2>
        <ul class="info-plain-list">
          <li>Visit the original data providers listed in <strong>Sources</strong> for direct data access.</li>
          <li>The <a href="https://global.infrastructureresilience.org/downloads" target="_blank" rel="noopener">GRI Risk Viewer downloads page</a> provides access to GRI baseline datasets.</li>
          <li>Each dataset is subject to its own licensing terms — see Sources for full attribution.</li>
        </ul>
      </div>
    </div>

    <div class="info-page-section info-page-section--grey">
      <div class="mg-container">
        <div class="mg-highlight-box mg-highlight-box--secondary">
          <h3>Planned</h3>
          <ul>
            <li>Per-layer download links to source datasets</li>
            <li>Site data export (attribute data for a clicked location)</li>
            <li>Bulk data package download</li>
          </ul>
        </div>
      </div>
    </div>
  `);
}

// ── Helper ────────────────────────────────────────────────────────────────────

function buildPanel(id, innerHTML) {
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.id = id;
  el.innerHTML = innerHTML;
  return el;
}
