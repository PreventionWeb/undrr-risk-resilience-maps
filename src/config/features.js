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
