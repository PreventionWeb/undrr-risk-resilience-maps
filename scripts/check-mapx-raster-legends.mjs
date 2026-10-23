/** Live coverage audit. Explicitly opt-in: unit/e2e tests use recorded fixtures. */
import { TABS } from "../src/config/layers.js";
import { resolveParsedMapXLegend } from "../src/sdk/legends.js";
import { resolveCustomMapXLegend } from "../src/sdk/custom-legends.js";
import { resolveRasterMapXLegend } from "../src/sdk/raster-legends.js";

const sources = TABS.flatMap((tab) => tab.layers.flatMap((layer) => layer.sources ?? [layer])).filter(
  (source) => source.id,
);
const browserLikeRequest = (url, options) =>
  fetch(url, {
    ...options,
    headers: { ...options.headers, Origin: "https://viewer.example" },
  });
const results = [];
for (const source of sources) {
  const response = await fetch(`https://api.mapx.org/get/view/item/${encodeURIComponent(source.id)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${source.id}: MapX HTTP ${response.status}`);
  const view = await response.json();
  if (view?.id !== source.id) throw new Error(`${source.id}: unexpected view`);
  const resolution =
    view.type === "rt"
      ? await resolveRasterMapXLegend(view, "en", browserLikeRequest)
      : view.type === "cc"
        ? await resolveCustomMapXLegend(view)
        : resolveParsedMapXLegend(view);
  if (!resolution.legend) throw new Error(`${source.id}: ${resolution.reason}`);
  results.push({
    view: source.id,
    type: view.type,
    title: resolution.legend.title,
    transport: resolution.transport ?? "catalogue",
  });
}
console.table(results);
console.log(`HTML legend coverage passed for all ${sources.length} configured MapX views.`);
