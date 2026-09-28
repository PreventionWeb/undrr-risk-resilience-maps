/**
 * View lifecycle operations.
 *
 * Thin wrappers around SDK postMessage calls for adding/removing map
 * layers ("views" in MapX terminology) and fetching their metadata.
 * All functions return Promises that resolve when the SDK responds.
 *
 * MapX upstream: https://github.com/unep-grid/mapx/issues/1132. Up to 1.14.0 a failing call never settles (no
 * rejection, no timeout). From 1.14.1, ask() rejects with a MapxSdkError and
 * the Manager's `requestTimeoutMs` (default 120 s) applies; once prod runs
 * 1.14.1+, callers can rely on rejections instead of hanging.
 */
import { getSDK } from "./client.js";

export function viewAdd(idView) {
  return getSDK().ask("view_add", { idView });
}

export function viewRemove(idView) {
  return getSDK().ask("view_remove", { idView });
}

// idView → Promise of the legend image. A view's style does not change during
// a session, and each image is costly: for a vector view MapX screenshots its
// own legend DOM with html2canvas (adding the view for the capture if it is not
// open, then removing it again); for a raster view it fetches the view's
// `data.source.legend` URL. The base64 PNG then crosses postMessage, so it is
// requested once per view.
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
