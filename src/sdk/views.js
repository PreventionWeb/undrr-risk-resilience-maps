/**
 * View lifecycle operations.
 *
 * Thin wrappers around SDK postMessage calls for adding/removing map
 * layers ("views" in MapX terminology) and fetching their metadata.
 * All functions return Promises that resolve when the SDK responds.
 */
import { getSDK } from "./client.js";

export function viewAdd(idView) {
  return getSDK().ask("view_add", { idView });
}

export function viewRemove(idView) {
  return getSDK().ask("view_remove", { idView });
}

// idView → Promise of the legend image. A view's style does not change during
// a session, and each image is a base64 PNG sent over postMessage that also
// makes MapX refetch the GeoServer legend, so it is requested once per view.
const legendImageCache = new Map();

/** Returns a base64 PNG string or data URL of the server-rendered legend. */
export function getViewLegendImage(idView) {
  if (!legendImageCache.has(idView)) {
    const request = getSDK()
      .ask("get_view_legend_image", { idView })
      .catch((error) => {
        // Let a later render retry after a transient failure.
        if (legendImageCache.get(idView) === request) legendImageCache.delete(idView);
        throw error;
      });
    legendImageCache.set(idView, request);
  }
  return legendImageCache.get(idView);
}

/** Test helper for clearing cached legend images. */
export function resetViewLegendImageCache() {
  legendImageCache.clear();
}
