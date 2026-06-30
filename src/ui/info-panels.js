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
    title: "Return to the home page",
    desc: "Click the <em>GRAR Metrics Facility</em> logo in the navigation bar at any time to return to this overview.",
  },
];

export function buildGuidePanel() {
  return buildPanel("tab-guide", `
    <div class="info-page-hero info-page-hero--secondary">
      <div class="mg-container">
        <h1 class="info-page-hero__title">Guide</h1>
        <p class="info-page-hero__intro">A step-by-step guide to using the GRAR Metrics Facility Map Viewer prototype.</p>
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

function mapxIds(layer) {
  if (layer.sources && layer.sources.length) {
    return layer.sources.map((s) => s.id || "—").join("\n");
  }
  return layer.id || "—";
}

function buildSourcesTable(layers) {
  const rows = layers.map((layer) => {
    const status = getLayerStatus(layer);
    const isTrackedOnly = status !== "Active";
    const rowClass = isTrackedOnly ? ' class="data-table__row--planned"' : "";
    const statusBadge = isTrackedOnly
      ? `<span class="data-table__badge">${escHtml(status)}</span> `
      : "";
    const ids = mapxIds(layer);
    const idCell = ids.includes("\n")
      ? ids.split("\n").map((id) => `<code>${escHtml(id)}</code>`).join("<br>")
      : `<code>${escHtml(ids)}</code>`;
    return `
      <tr${rowClass}>
        <td>${statusBadge}${escHtml(layer.label)}</td>
        <td class="data-table__mapx-id">${idCell}</td>
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
            <th scope="col" class="data-table__mapx-id">MapX ID</th>
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
        <label class="sources-mapx-toggle">
          <input type="checkbox" id="toggle-mapx-ids">
          Show MapX view IDs
        </label>
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

  panel.querySelector("#toggle-mapx-ids").addEventListener("change", (e) => {
    panel.classList.toggle("show-mapx-ids", e.target.checked);
  });

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

// ── About ─────────────────────────────────────────────────────────────────────

export function buildAboutPanel() {
  return buildPanel("tab-about", `
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
        <p>The source code for this map viewer is publicly available on <a href="https://github.com/unisdr/undrr-risk-resilience-maps" target="_blank" rel="noopener">GitHub</a>.</p>
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
          <li><a href="https://github.com/unisdr/undrr-risk-resilience-maps" target="_blank" rel="noopener">Source code on GitHub</a></li>
        </ul>
      </div>
    </div>
  `);
}



function buildPanel(id, innerHTML) {
  const el = document.createElement("div");
  el.className = "info-page-panel";
  el.id = id;
  el.innerHTML = innerHTML;
  return el;
}
