/**
 * Layer transparency and filter controls.
 *
 * The getter and setter do not share a scale. The setter takes transparency
 * 0-100 (0 = opaque, 100 = invisible); the getter, despite its name, returns
 * MapX's stored opacity 0-1 (1 = opaque, the default for a fresh view). Our
 * UI shows opacity 0-100; the conversion happens in src/ui/layer-controls.js,
 * not here -- these functions pass raw SDK values.
 */
import { getSDK } from "./client.js";

/** @param {number} value - Transparency 0-100 (0 = opaque, 100 = invisible) */
export function setViewLayerTransparency(idView, value) {
  return getSDK().ask("set_view_layer_transparency", { idView, value });
}

/**
 * Upstream `get_view_layer_transparency` returns `viewGetOpacityValue()`
 * (`view._opacity`, defaulting to 1), not the 0-100 transparency the setter
 * takes (MapX app/src/js/map_helpers/view_filters.js).
 *
 * @returns {Promise<number>} Opacity 0-1 (1 = opaque)
 */
export function getViewLayerTransparency(idView) {
  return getSDK().ask("get_view_layer_transparency", { idView });
}
