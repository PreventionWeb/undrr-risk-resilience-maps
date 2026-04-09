/**
 * Layer transparency and filter controls.
 *
 * The SDK uses "transparency" (0 = fully opaque, 100 = invisible).
 * Our UI shows "opacity" (inverted). The conversion happens in
 * sidebar.js, not here -- these functions pass raw SDK values.
 */
import { getSDK } from "./client.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/** @returns {Promise<number>} Transparency 0-100 */
export function getViewLayerTransparency(idView) {
  return getSDK().ask("get_view_layer_transparency", { idView });
}
