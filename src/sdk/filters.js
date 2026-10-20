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
 * MapX upstream: https://github.com/unep-grid/mapx/issues/1135. Once
 * production MapX runs 1.14.2+, normalizeLayerTransparency() can become
 * `100 - value` and drop the version check.
 */
import { getMapXVersion, getSDK, isMapXAtLeast } from "./client.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/**
 * Convert a raw get_view_layer_transparency value to UI opacity 0-100.
 *
 * The getter changed scale in MapX 1.14.2 (MapX app/src/js/map_helpers/view_filters.js):
 * - 1.14.2+: transparency 0-100, an integer (0 = opaque, the fresh-view default)
 * - 1.14.1 and earlier: `view._opacity` 0-1 (1 = opaque, the fresh-view default)
 *
 * The scale is picked from the Manager's version. 0 and 1 mean opposite
 * things on the two scales, so without a version this guesses from the value
 * and reads 0 and 1 as opaque, the default on both.
 *
 * @param {number} value - Raw value returned by get_view_layer_transparency
 * @param {string|null} [version] - MapX SDK version; defaults to the Manager's
 * @returns {number} Opacity 0-100, rounded to the slider's step of 1
 */
export function normalizeLayerTransparency(value, version = getMapXVersion()) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));
  if (isMapXAtLeast(version, "1.14.2")) return clamp(100 - value);
  if (version) return clamp(value * 100);
  if (value > 1) return clamp(100 - value);
  if (value > 0 && value < 1) return clamp(value * 100);
  return 100;
}

/**
 * Returns the layer transparency or opacity depending on the MapX version.
 *
 * @returns {Promise<number>} Opacity 0-1 (legacy MapX <= 1.14.1) or Transparency 0-100 (MapX >= 1.14.2)
 */
export function getViewLayerTransparency(idView) {
  return getSDK().ask("get_view_layer_transparency", { idView });
}
