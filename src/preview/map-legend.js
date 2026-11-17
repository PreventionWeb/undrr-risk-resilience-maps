/** Read the current structured legend contract using the preview's own manager. */
import { askWithTimeout } from "../sdk/camera.js";
import { resolveParsedMapXLegend } from "../sdk/legends.js";

export async function readPreviewLegend(manager, entry) {
  if (entry.source?.legend || entry.layer.legend)
    return { entries: entry.source?.legend ?? entry.layer.legend };
  try {
    const result = await askWithTimeout(manager, "get_view_legend_json", { idView: entry.id }, 5000);
    const { legend } = resolveParsedMapXLegend(result, entry.id);
    if (legend) return legend;
  } catch {
    // Preserve image fallback when the service cannot supply structured data.
  }
  return {
    image: await askWithTimeout(manager, "get_view_legend_image", { idView: entry.id }, 20000),
  };
}
