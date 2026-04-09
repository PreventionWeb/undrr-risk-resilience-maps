/**
 * Map camera and display controls.
 *
 * Navigation (fly-to, zoom), country/region bounding box fitting,
 * and basemap toggling. All calls go through the SDK postMessage bridge.
 */
import { getSDK } from "./client.js";

/** Animate the camera to a position. Options: { center, zoom, bearing, pitch, duration }. */
export function mapFlyTo(options) {
  return getSDK().ask("map_fly_to", options);
}

export function mapGetZoom() {
  return getSDK().ask("map_get_zoom");
}

/**
 * Fit the map to a country or region bounding box.
 * @param {string} code - ISO 3166 country code or M49 region code
 * @param {object} param - Animation options, e.g. { duration: 2000 }
 */
export function commonLocFitBbox(code, param) {
  return getSDK().ask("common_loc_fit_bbox", { code, param });
}

/** Returns available country (ISO 3166) and region (M49) codes. */
export function commonLocGetListCodes() {
  return getSDK().ask("common_loc_get_list_codes");
}

/** Toggle satellite basemap. @param {string} action - "toggle", "show", or "hide" */
export function setModeAerial(action) {
  return getSDK().ask("set_mode_aerial", { action });
}
