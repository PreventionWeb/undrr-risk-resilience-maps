/**
 * EDRA agriculture control options.
 *
 * Kept apart from the adapter so the sidebar can render controls without
 * loading the adapter and its proj4 dependency until the layer is turned on.
 */

export const EDRA_CROPS = [
  { value: "BARLEY", label: "Barley" },
  { value: "MAIZE", label: "Maize" },
  { value: "WHEAT", label: "Wheat" },
];

export const EDRA_SCENARIOS = [
  { value: "BASELINE", label: "Historical (1981–2010)", property: "value_his" },
  { value: "CURRENT", label: "Current climate", property: "value_current" },
  { value: "15", label: "+1.5 °C", property: "value_15" },
  { value: "20", label: "+2 °C", property: "value_20" },
  { value: "30", label: "+3 °C", property: "value_30" },
];

export const EDRA_CONTROLS = [
  { key: "crop", label: "Crop", options: EDRA_CROPS },
  { key: "scenario", label: "Climate scenario", options: EDRA_SCENARIOS },
];
