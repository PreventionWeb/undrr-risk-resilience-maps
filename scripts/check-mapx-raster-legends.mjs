/**
 * Live MapX/GeoServer raster legend contract check.
 *
 * This intentionally stays outside the default unit-test suite because it
 * depends on two public services. It verifies that every configured
 * Earthquake PGA view still advertises a GeoServer JSON legend that the
 * viewer can render.
 */
import { resolveRasterMapXLegend } from "../src/sdk/raster-legends.js";

const VIEW_IDS = [
  "MX-J3YTW-RUQN3-40P87",
  "MX-4XSGY-9URYF-WMICZ",
  "MX-KE2UX-GL8CM-IZSIA",
  "MX-SFF5U-3O2XL-SAIL9",
  "MX-MWJ8Z-JYVYX-N9T0T",
];

const results = [];
for (const idView of VIEW_IDS) {
  const response = await fetch(`https://api.mapx.org/get/view/item/${encodeURIComponent(idView)}`);
  if (!response.ok) throw new Error(`${idView}: MapX returned HTTP ${response.status}`);

  const view = await response.json();
  if (view?.id !== idView || view?.type !== "rt") {
    throw new Error(`${idView}: MapX returned an unexpected view`);
  }

  // Simulate a cross-origin browser request. GIRI permits app.mapx.org but
  // rejects other origins, so this exercises the MapX mirror retry as well as
  // the provider's JSON contract.
  const browserLikeRequest = (url, options) =>
    fetch(url, {
      ...options,
      headers: { ...options.headers, Origin: "https://viewer.example" },
    });
  const resolution = await resolveRasterMapXLegend(view, "en", browserLikeRequest);
  if (!resolution.legend) {
    throw new Error(`${idView}: structured legend failed (${resolution.reason})`);
  }
  if (resolution.legend.entries.length !== 6) {
    throw new Error(`${idView}: expected 6 PGA classes, got ${resolution.legend.entries.length}`);
  }
  if (resolution.legend.entries[0].opacity !== 0) {
    throw new Error(`${idView}: expected the first PGA class to be transparent`);
  }

  results.push({
    view: idView,
    title: resolution.legend.title,
    classes: resolution.legend.entries.length,
    range: `${resolution.legend.entries[0].label} … ${resolution.legend.entries.at(-1).label}`,
  });
}

console.table(results);
console.log("MapX raster legend contract passed for all 5 Earthquake PGA views.");
