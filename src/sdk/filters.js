/**
 * Layer transparency and filter controls for MapX 1.14.2+.
 * The SDK getter and setter use transparency 0-100; our UI displays opacity.
 */
import { getSDK } from "./client.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/** Convert SDK transparency 0-100 to UI opacity 0-100. */
export function normalizeLayerTransparency(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(0, Math.round(100 - value)));
}

/**
 * Returns the layer transparency.
 *
 * @returns {Promise<number>} Transparency 0-100 (0 = opaque)
 */
export function getViewLayerTransparency(idView) {
  return getSDK().ask("get_view_layer_transparency", { idView });
}
