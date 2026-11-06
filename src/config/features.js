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

// Repository kill switch for user-facing map downloads (GeoTIFF + values CSV).
// Set false and rebuild/redeploy to hide the controls in every viewer, including
// embeds. URL parameters and programmatic options cannot override this switch.
export const MAP_DOWNLOADS_ENABLED = true;

export function resolveDownloadsEnabled(requested = true, enabled = MAP_DOWNLOADS_ENABLED) {
  return enabled === true && requested === true;
}

export function downloadsEnabledFromSearch(search, enabled = MAP_DOWNLOADS_ENABLED) {
  const values = new URLSearchParams(search).getAll("downloads");
  // On by default. Explicit opt-outs, blank, unknown or repeated values disable
  // this instance; even an explicit opt-in must respect the repository switch.
  const requested = values.length === 0 || (values.length === 1 && ["1", "true"].includes(values[0]));
  return resolveDownloadsEnabled(requested, enabled);
}
