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
 *   status   - optional unpublished state:
 *              "disabled", "disabled-awaiting-data", or
 *              "disabled-pending-removal"
 *              Unpublished layers are not currently published in the map
 *              explorer, but remain in Sources and CSV export for prototype
 *              tracking. Legacy `disabled: true` is still supported.
 *   legend   - optional [{color, label}] array for local HTML legend override
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

export const TABS = [
  { id: "risk", label: "Risk", layers: RISK_LAYERS },
  { id: "resilience", label: "Resilience", layers: RESILIENCE_LAYERS },
  { id: "hazard", label: "Hazard", layers: HAZARD_LAYERS },
  { id: "exposure", label: "Exposure", layers: EXPOSURE_LAYERS },
  { id: "vulnerability", label: "Vulnerability", layers: VULNERABILITY_LAYERS },
];

export const PRIMARY_PROJECT = "MX-2LD-FBB-58N-ROK-8RH";
