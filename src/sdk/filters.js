/**
 * Layer transparency and filter controls.
 *
 * MapX 1.14.1 and earlier returned stored opacity on a 0-1 float scale
 * (1 = fully opaque, the default for a fresh view). MapX 1.14.2 returns
 * transparency on a 0-100 integer scale (0 = fully opaque, 100 = invisible).
 * The setter always takes transparency 0-100.
 *
 * Our UI shows opacity 0-100; normalizeLayerTransparency() converts raw SDK
 * getter values across both versions to UI opacity 0-100.
 *
 * MapX upstream: https://github.com/unep-grid/mapx/issues/1135.
 */
import { getSDK } from "./client.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/**
 * Normalizes a raw get_view_layer_transparency value into an opacity percentage (0-100).
 *
 * - In MapX 1.14.1, the getter returned opacity 0-1 (fresh view = 1).
 * - In MapX 1.14.2, the getter returns transparency 0-100 (fresh view = 0).
 *
 * Handling 0 and 1:
 * - 0: In 1.14.2, a fresh view returns 0 transparency, representing 100% opacity.
 * - 1: In 1.14.1, a fresh view returns 1.0 opacity, representing 100% opacity.
 *   (In 1.14.2, 1 transparency corresponds to 99% opacity, so rounding to 100% is safe.)
 * - 0 < value < 1: Legacy 1.14.1 float opacity (e.g. 0.75 -> 75%).
 * - value > 1: MapX 1.14.2 integer transparency (e.g. 30 -> 70%).
 *
 * @param {number} value - Raw value returned by get_view_layer_transparency
 * @returns {number} Normalized opacity percentage (0-100)
 */
export function normalizeLayerTransparency(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  // Fresh view in 1.14.2 returns 0 (0% transparency = 100% opaque)
  // Fresh view in 1.14.1 returns 1 (1.0 opacity = 100% opaque)
  if (value === 0 || value === 1) {
    return 100;
  }
  // Legacy 1.14.1 float opacity (0 < value < 1)
  if (value > 0 && value < 1) {
    return Math.min(100, Math.max(0, Math.round(value * 100)));
  }
  // MapX 1.14.2 transparency (value > 1 or negative/overflow)
  return Math.min(100, Math.max(0, 100 - Math.round(value)));
}

/**
 * Returns the layer transparency or opacity depending on the MapX version.
 *
 * @returns {Promise<number>} Opacity 0-1 (legacy MapX <= 1.14.1) or Transparency 0-100 (MapX >= 1.14.2)
 */
export function getViewLayerTransparency(idView) {
  return getSDK().ask("get_view_layer_transparency", { idView });
}
