/**
 * Site inspector panel.
 *
 * Builds and manages a floating panel that shows geographic coordinates and
 * per-layer feature data when the user clicks the map in inspection mode.
 *
 * Panel content is driven by a `result` object produced by src/sdk/inspect.js:
 *   result.lngLat              — { lng, lat } geographic coordinates
 *   result.views               — { [idView]: attributes[] } per-view feature data
 *   result.openViewsSnapshot   — Set<idView> of active views at click time
 *
 * For each view in the snapshot:
 *   - Any view in batch with attributes → attribute table (incl. raster-as-VT GRAY_INDEX)
 *   - Any view in batch with no data    → "No data at this location."
 *   - RT layer not in batch             → "Raster layer — values not queryable at point."
 *   - Other layer not in batch          → "No data returned."
 */

import { TABS } from "../config/layers.js";
import { getExternalRuntimeByViewId } from "../external/index.js";
import { makeDraggable, makeResizable } from "../utils/panels.js";

// MapX internal fields not meaningful for end users
const SKIP_KEYS = ["gid", "mx_t0", "mx_t1", "geom", "geometry"];

const ATTRIBUTE_LABELS = {
  GRAY_INDEX: "Pixel Value",
  iso3cd: "Country code",
  romnam: "Country",
  jo_pml100_households_existingclimate: "PML housing loss (1-in-100-year event, current climate)",
};

// Float32 "no data" sentinel used by raster-as-VT layers (GRAY_INDEX nodata value)
const FLOAT32_NODATA = -3.4028234663852886e38;
function isNoData(v) {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Math.abs(v - FLOAT32_NODATA) / Math.abs(FLOAT32_NODATA) < 1e-6
  );
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attributeLabel(key) {
  if (ATTRIBUTE_LABELS[key]) return ATTRIBUTE_LABELS[key];
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(?:aal|pml|gdp|iso)\b/gi, (value) => value.toUpperCase())
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function attributeValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

/**
 * Build a flat index from MapX view ID → { tab, layer, source }.
 * Compound layers register all source IDs.
 */
function buildViewIndex(tabs) {
  const map = new Map();
  for (const tab of tabs) {
    for (const layer of tab.layers) {
      if (layer.id) {
        map.set(layer.id, { tab, layer, source: null });
      }
      for (const src of layer.sources ?? []) {
        if (src.id) {
          map.set(src.id, { tab, layer, source: src });
        }
      }
    }
  }
  return map;
}

const VIEW_INDEX = buildViewIndex(TABS);

let _escHandler = null;

/** Create the site inspector DOM and append it to #app-map. */
export function buildSiteInspectorPanel() {
  const existing = document.getElementById("site-inspector");
  if (existing) return existing;

  const panel = document.createElement("div");
  panel.id = "site-inspector";
  panel.className = "site-inspector";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Site inspection results");

  panel.innerHTML = `
    <div class="site-inspector-header">
      <h3 class="site-inspector-title">Site Details</h3>
      <button class="site-inspector-close" aria-label="Close inspection panel">&times;</button>
    </div>
    <div class="site-inspector-coords" aria-label="Coordinates"></div>
    <div class="site-inspector-layers"></div>
  `;

  panel.querySelector(".site-inspector-close").addEventListener("click", hideSiteInspector);

  makeDraggable(panel, panel.querySelector(".site-inspector-header"));
  makeResizable(panel);

  document.getElementById("app-map").appendChild(panel);
  return panel;
}

/** Populate and show the site inspector panel with a batch result. */
export function showSiteInspector(result) {
  const panel = document.getElementById("site-inspector");
  if (!panel) return;

  const { lngLat, views, openViewsSnapshot } = result;

  // Coordinates row
  const coordsEl = panel.querySelector(".site-inspector-coords");
  const lat = lngLat.lat.toFixed(5);
  const lng = lngLat.lng.toFixed(5);
  coordsEl.innerHTML = `
    <span class="site-inspector-coords-label">Coordinates</span>
    <span class="site-inspector-coords-value">${esc(lat)}, ${esc(lng)}</span>
    <button class="site-inspector-coords-copy" title="Copy to clipboard" aria-label="Copy coordinates"
      type="button">&#128203;</button>
  `;
  coordsEl.querySelector(".site-inspector-coords-copy").addEventListener("click", () => {
    navigator.clipboard?.writeText(`${lat}, ${lng}`).catch(() => {});
  });

  // Layer rows
  const layersEl = panel.querySelector(".site-inspector-layers");
  layersEl.innerHTML = "";

  if (!openViewsSnapshot || openViewsSnapshot.size === 0) {
    layersEl.innerHTML = `<p class="site-inspector-empty">No layers were active at this location.</p>`;
  } else {
    for (const idView of openViewsSnapshot) {
      layersEl.appendChild(buildLayerRow(idView, views));
    }
  }

  panel.hidden = false;

  // Escape to close
  if (_escHandler) document.removeEventListener("keydown", _escHandler);
  _escHandler = (e) => {
    if (e.key === "Escape") hideSiteInspector();
  };
  document.addEventListener("keydown", _escHandler);
}

function buildLayerRow(idView, views) {
  const runtime = getExternalRuntimeByViewId(idView);
  const entry = VIEW_INDEX.get(idView) ?? (runtime ? { layer: runtime.layer, source: null } : null);
  const label = entry
    ? entry.source
      ? `${entry.layer.label} — ${entry.source.label}`
      : entry.layer.label
    : idView;
  const description = entry?.source?.desc ?? entry?.layer?.desc ?? "";
  const type = entry?.layer.type ?? "vt";

  const row = document.createElement("div");
  row.className = "site-inspector-layer-row";

  const inBatch = Object.prototype.hasOwnProperty.call(views, idView);
  // Normalize: MapX sends an array of feature objects; take the first one.
  const rawAttrs = views[idView];
  const props = inBatch ? (Array.isArray(rawAttrs) ? rawAttrs[0] : rawAttrs) : null;
  const hasData = inBatch && props != null && typeof props === "object";
  const indicatorMod = hasData ? "has-data" : "no-data";

  let html = `
    <div class="site-inspector-layer-header">
      <span class="site-inspector-indicator site-inspector-indicator--${indicatorMod}"
            aria-hidden="true"></span>
      <span class="site-inspector-layer-name">${esc(label)}</span>
    </div>
  `;

  if (description) {
    html += `<p class="site-inspector-layer-desc">${esc(description)}</p>`;
  }

  if (entry?.layer) {
    const links = [];
    if (entry.layer.sourceUrl && entry.layer.source !== "Source to be confirmed.") {
      links.push(`<a href="${esc(entry.layer.sourceUrl)}" target="_blank" rel="noopener">Source</a>`);
    }
    links.push('<a href="#sources">Citation and methodology details</a>');
    html += `<p class="site-inspector-layer-links">${links.join(" · ")}</p>`;
  }

  if (hasData) {
    // Render attribute table. "inBatch" beats local type — raster-as-VT layers
    // (GRAY_INDEX) come through here too.
    const entries = Object.entries(props).filter(
      ([k, v]) => !SKIP_KEYS.includes(k.toLowerCase()) && v != null && v !== "" && !isNoData(v),
    );
    const labelledEntries = entries.map(([key, value]) => [attributeLabel(key), attributeValue(value)]);
    if (labelledEntries.length > 0) {
      html += `<table class="site-inspector-attrs">`;
      for (const [k, v] of labelledEntries) {
        html += `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;
      }
      html += `</table>`;
    } else {
      html += `<p class="site-inspector-note">No data at this location.</p>`;
    }
  } else if (inBatch) {
    // SDK reported for this view (it is queryable) but returned no features.
    html += `<p class="site-inspector-note">No data at this location.</p>`;
  } else if (type === "rt") {
    // Layer typed as raster and did not participate in click_attributes batch.
    html += `<p class="site-inspector-note">Raster layer — values not queryable at point.</p>`;
  } else {
    html += `<p class="site-inspector-note">No data returned.</p>`;
  }

  row.innerHTML = html;

  return row;
}

export function hideSiteInspector() {
  const panel = document.getElementById("site-inspector");
  if (panel) panel.hidden = true;
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }
}

export function isSiteInspectorVisible() {
  return !document.getElementById("site-inspector")?.hidden;
}
