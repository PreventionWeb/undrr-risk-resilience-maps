/**
 * Layer definitions organised by category.
 *
 * Each category file defines an array of layer objects. See validate.js
 * for the expected schema. To add a new layer, edit the relevant category
 * file -- no changes to UI code should be needed.
 *
 * Simple layer fields:
 *   id       - MapX view ID (null for "coming soon" / disabled layers)
 *   label    - Display name
 *   type     - "rt" (raster), "vt" (vector), or "cc" (custom coded / live)
 *   desc     - Short description shown when the layer accordion is expanded
 *   project  - MapX project ID that owns the view
 *   licenseUrl - optional URL for the source licence/terms
 *   status   - optional unpublished state:
 *              "disabled", "disabled-awaiting-data", or
 *              "disabled-pending-removal"
 *              Unpublished layers are not currently published in the map
 *              explorer, but remain in Sources and CSV export for prototype
 *              tracking. Legacy `disabled: true` is still supported.
 *   legend   - optional [{color, label}] array for local HTML legend override.
 *              External providers own their runtime control and legend data.
 *   external - optional {provider, defaults} definition. External providers
 *              create a temporary MapX GeoJSON view at runtime, so `id` and
 *              `project` are not required.
 *
 * Compound layer fields (multiple switchable views under one accordion):
 *   id       - null (real IDs live in sources)
 *   sources  - [{id, label, desc?, legend?}] array of switchable views
 *   widget   - {type, label} specifies the source-switching UI widget
 *              type: "sub-tabs" (button bar) or "stepped-slider" (range input)
 *   (all other fields same as simple layers)
 *
 * See ARCHITECTURE.md for details on the compound layer pattern.
 */
import { HAZARD_LAYERS } from "./hazard.js";
import { EXPOSURE_LAYERS } from "./exposure.js";
import { VULNERABILITY_LAYERS } from "./vulnerability.js";
import { RISK_LAYERS } from "./risk.js";
import { RESILIENCE_LAYERS } from "./resilience.js";
export { ECO_DRR, HOME, CDC } from "./projects.js";

// Canonical R2R category display order
const R2R_ORDER = ["Societies", "Economy", "Environment"];

/**
 * Group layers by r2rCategory if more than one category is present.
 * Returns { groups, layers } — groups is null when only one category exists.
 */
function withR2rGroups(layers) {
  const seen = new Set(layers.map((l) => l.r2rCategory).filter(Boolean));
  if (seen.size <= 1) return { layers, groups: null };

  const buckets = new Map(R2R_ORDER.map((cat) => [cat, []]));
  for (const layer of layers) {
    const cat = layer.r2rCategory || "Other";
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(layer);
  }

  const groups = [...buckets.entries()]
    .filter(([, ls]) => ls.length > 0)
    .map(([label, ls]) => ({ id: label.toLowerCase(), label, layers: ls }));

  return { layers, groups };
}

export const TABS = [
  { id: "risk-resilience", label: "Risk", ...withR2rGroups(RISK_LAYERS) },
  { id: "resilience", label: "Resilience", ...withR2rGroups(RESILIENCE_LAYERS) },
  { id: "hazard", label: "Hazard", ...withR2rGroups(HAZARD_LAYERS) },
  { id: "exposure", label: "Exposure", ...withR2rGroups(EXPOSURE_LAYERS) },
  { id: "vulnerability", label: "Vulnerability", ...withR2rGroups(VULNERABILITY_LAYERS) },
];

export const PRIMARY_PROJECT = "MX-2LD-FBB-58N-ROK-8RH";
