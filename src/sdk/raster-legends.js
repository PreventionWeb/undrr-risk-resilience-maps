/** Parse GeoServer provider JSON returned by MapX get_view_legend_json.
 * Discovery, provider requests and mirror selection belong to MapX. */
import {
  displayLegendValue,
  isSafeLegendColor,
  isSafeLegendText,
  MAX_LEGEND_ENTRIES,
} from "./legend-model.js";

const SUPPORTED_COLORMAP_TYPES = new Set(["intervals", "values", "ramp"]);

function finiteOpacity(value, defaultValue = 1) {
  if (value == null || value === "") return defaultValue;
  const opacity = Number(value);
  return Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : null;
}

export function parseGeoServerRasterLegend(payload, title = "") {
  if (!payload || !Array.isArray(payload.Legend) || payload.Legend.length === 0 || payload.Legend.length > 20)
    return null;
  const groups = payload.Legend.map((legend) => parseRasterGroup(legend));
  if (groups.some((group) => group == null)) return null;
  if (groups.reduce((total, group) => total + group.entries.length, 0) > MAX_LEGEND_ENTRIES) return null;
  if (groups.length === 1)
    return { ...groups[0], title: isSafeLegendText(title) ? title.trim() : groups[0].title };
  return { title: isSafeLegendText(title) ? title.trim() : "", entries: [], groups };
}

function parseRasterGroup(legend) {
  if (!legend || !Array.isArray(legend.rules) || legend.rules.length === 0) return null;

  const symbolizers = legend.rules.flatMap((rule) =>
    Array.isArray(rule?.symbolizers) ? rule.symbolizers : [],
  );
  if (symbolizers.length !== 1 || !symbolizers[0]?.Raster) return null;

  const raster = symbolizers[0].Raster;
  const colormap = raster.colormap;
  if (!colormap || !SUPPORTED_COLORMAP_TYPES.has(colormap.type)) return null;
  if (
    !Array.isArray(colormap.entries) ||
    colormap.entries.length === 0 ||
    colormap.entries.length > MAX_LEGEND_ENTRIES
  ) {
    return null;
  }

  const rasterOpacity = finiteOpacity(raster.opacity);
  if (rasterOpacity == null) return null;

  const entries = colormap.entries.map((entry) => {
    if (!entry || !isSafeLegendColor(entry.color)) return null;
    const label = isSafeLegendText(entry.label) ? entry.label.trim() : displayLegendValue(entry.quantity);
    const entryOpacity = finiteOpacity(entry.opacity);
    if (!label || entryOpacity == null) return null;

    return {
      color: entry.color.trim(),
      label,
      opacity: rasterOpacity * entryOpacity,
      size: null,
      geometry: "polygon",
      borderColor: null,
    };
  });
  if (entries.some((entry) => entry == null)) return null;

  const resolvedTitle = isSafeLegendText(legend.title) ? legend.title.trim() : "";
  if (colormap.type === "ramp") {
    const quantities = colormap.entries.map((entry) => Number(entry.quantity));
    if (
      quantities.length < 2 ||
      quantities.some(
        (value, index) =>
          !Number.isFinite(value) ||
          !["number", "string"].includes(typeof colormap.entries[index].quantity) ||
          colormap.entries[index].quantity == null ||
          String(colormap.entries[index].quantity).trim() === "" ||
          (index > 0 && value <= quantities[index - 1]),
      )
    )
      return null;
    return { title: resolvedTitle, entries, ramp: quantities };
  }
  return { title: resolvedTitle, entries };
}
