/**
 * Live MapX/GeoServer raster legend contract check.
 *
 * This intentionally stays outside the default unit-test suite because it
 * depends on the MapX view API, the GIRI GeoServer, and the MapX mirror. It
 * verifies that every currently configured Earthquake PGA view still
 * advertises a GeoServer JSON legend that the viewer can render.
 */
import { HAZARD_LAYERS } from "../src/config/layers/hazard.js";
import { resolveRasterMapXLegend } from "../src/sdk/raster-legends.js";

const earthquakeLayer = HAZARD_LAYERS.find((layer) => layer.key === "earthquake-pga");
const viewIds = earthquakeLayer?.sources?.map((source) => source.id) ?? [];
if (viewIds.length === 0) throw new Error("Earthquake PGA has no configured MapX views");

let mirrorRequests = 0;
const browserLikeRequest = (url, options) => {
  if (new URL(url).origin === "https://api.mapx.org") mirrorRequests += 1;
  return fetch(url, {
    ...options,
    headers: { ...options.headers, Origin: "https://viewer.example" },
  });
};

const results = [];
for (const idView of viewIds) {
  const response = await fetch(`https://api.mapx.org/get/view/item/${encodeURIComponent(idView)}`);
  if (!response.ok) throw new Error(`${idView}: MapX returned HTTP ${response.status}`);

  const view = await response.json();
  if (view?.id !== idView || view?.type !== "rt") {
    throw new Error(`${idView}: MapX returned an unexpected view`);
  }

  // Simulate a cross-origin browser request. GIRI permits app.mapx.org but
  // rejects other origins, so this exercises the MapX mirror retry as well as
  // the provider's JSON contract.
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

if (mirrorRequests !== viewIds.length) {
  throw new Error(`Expected ${viewIds.length} mirror retries, observed ${mirrorRequests}`);
}

console.table(results);
console.log(
  `MapX raster legend contract passed for all ${viewIds.length} Earthquake PGA views via the mirror retry.`,
);
