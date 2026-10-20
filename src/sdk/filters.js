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
import { getMapXEnvironment } from "./availability.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/**
 * Normalizes a raw get_view_layer_transparency value into an opacity percentage (0-100).
 *
 * - In MapX 1.14.1, the getter returned opacity on a 0-1 float scale:
 *   - 0.0: invisible (0% opacity)
 *   - 1.0: fully opaque (100% opacity, fresh view default)
 *   - 0 < value < 1: fractional opacity (e.g. 0.75 -> 75%)
 * - In MapX 1.14.2, the getter returns transparency on a 0-100 integer scale:
 *   - 0: fully opaque (0% transparent = 100% opacity, fresh view default)
 *   - 1: 1% transparent = 99% opacity
 *   - 100: invisible (100% transparent = 0% opacity)
 *
 * Disambiguation strategy:
 * 1. Explicit options: `options.version` or `options.env` (ideal for unit testing and caller override).
 * 2. Runtime SDK inspection: `window.mxsdk?.version` (e.g. "1.14.2-alpha" vs "1.14.1").
 * 3. Environment detection: `getMapXEnvironment()` ("staging" -> 1.14.2 scale, "prod" -> 1.14.1 scale).
 * 4. Safe fallback for edge cases:
 *    - value > 1: unambiguously 1.14.2 transparency (0-100 scale).
 *    - 0 < value < 1: unambiguously 1.14.1 float opacity (0-1 scale).
 *    - 0 and 1:
 *      - MapX 1.14.2 (staging / v1.14.2+): 0 transparency = 100% opacity, 1 transparency = 99% opacity.
 *      - MapX 1.14.1 (prod / v1.14.1): 0.0 opacity = 0% opacity, 1.0 opacity = 100% opacity.
 *      - Unconfigured fallback without version context: 0 and 1 default to 100% opacity (fresh view).
 *
 * @param {number} value - Raw value returned by get_view_layer_transparency
 * @param {{ version?: string, env?: string }} [options] - Optional SDK version or environment override
 * @returns {number} Normalized opacity percentage (0-100)
 */
export function normalizeLayerTransparency(value, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }

  // Detect whether we are running against MapX 1.14.2+ or legacy MapX <= 1.14.1
  let isLegacy = false;
  let isV1142 = false;

  const version =
    options.version ??
    (typeof window !== "undefined" && typeof window.mxsdk?.version === "string"
      ? window.mxsdk.version
      : undefined);

  if (typeof version === "string") {
    if (version.startsWith("1.14.2") || version.startsWith("1.15") || version.startsWith("2.")) {
      isV1142 = true;
    } else if (version.startsWith("1.14.1") || version.startsWith("1.14.0") || version.startsWith("1.13")) {
      isLegacy = true;
    }
  }

  if (!isLegacy && !isV1142) {
    const env =
      options.env ??
      (typeof window !== "undefined" && window?.location?.search ? getMapXEnvironment() : undefined);
    if (env === "prod" || env === "production") {
      isLegacy = true;
    } else if (env === "staging") {
      isV1142 = true;
    }
  }

  // If detected as legacy MapX (<= 1.14.1 float opacity 0-1)
  if (isLegacy) {
    if (value <= 0) return 0;
    if (value >= 1 && value <= 1) return 100;
    if (value > 1) return Math.min(100, Math.max(0, 100 - Math.round(value)));
    return Math.min(100, Math.max(0, Math.round(value * 100)));
  }

  // If detected as MapX 1.14.2+ (integer transparency 0-100)
  if (isV1142) {
    if (value > 0 && value < 1) {
      return Math.min(100, Math.max(0, Math.round(value * 100)));
    }
    return Math.min(100, Math.max(0, 100 - Math.round(value)));
  }

  // Safe fallback when neither explicit version nor query param environment is specified:
  // - Fractional values (0 < value < 1) are unambiguously legacy 1.14.1 float opacity
  if (value > 0 && value < 1) {
    return Math.min(100, Math.max(0, Math.round(value * 100)));
  }
  // - Values > 1 are unambiguously 1.14.2 transparency (0-100 scale)
  if (value > 1) {
    return Math.min(100, Math.max(0, 100 - Math.round(value)));
  }
  // - Out-of-bounds negative values
  if (value < 0) {
    return 100;
  }
  // - Ambiguous 0 and 1 without version context:
  // Fresh view in 1.14.2 returns 0 (100% opacity); fresh view in 1.14.1 returns 1 (100% opacity).
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
