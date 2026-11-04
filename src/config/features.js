// Temporary programme-lead preference while the map info-window design is
// revisited. Keep inspection implemented and tested so it can be restored.
// Runtime overrides: ?inspect=1 / ?inspect=0, or createRiskMap's boolean
// inspectionEnabled option. Applies to standalone and embedded viewers alike.
export const MAP_INSPECTION_ENABLED = false;

export function inspectionEnabledFromSearch(search, fallback = MAP_INSPECTION_ENABLED) {
  const values = new URLSearchParams(search).getAll("inspect");
  if (values.length === 0) return fallback;
  // Only an unambiguous, explicit opt-in enables popups. Invalid values fail closed.
  return values.length === 1 && ["1", "true"].includes(values[0]);
}

// Prototype data downloads (#64): GeoTIFF links for raster layers and a
// values-only CSV for region-level vector layers. Off until the programme signs
// off on public downloads; the "Request data" email link stays the public route.
// Runtime opt-in: ?downloads=1 (or true), or createRiskMap's boolean
// downloadsEnabled option. Applies to standalone and embedded viewers alike.
export const MAP_DOWNLOADS_ENABLED = false;

export function downloadsEnabledFromSearch(search, fallback = MAP_DOWNLOADS_ENABLED) {
  const values = new URLSearchParams(search).getAll("downloads");
  if (values.length === 0) return fallback;
  // Same rule as inspection: only one unambiguous opt-in enables downloads.
  // Blank, unknown or repeated values fail closed.
  return values.length === 1 && ["1", "true"].includes(values[0]);
}
