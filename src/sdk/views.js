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

/** Returns a base64 PNG string or data URL of the server-rendered legend. */
export function getViewLegendImage(idView) {
  return getSDK().ask("get_view_legend_image", { idView });
}

/** Returns project/title/abstract metadata. Does NOT include style rules. */
export function getViewMeta(idView) {
  return getSDK().ask("get_view_meta", { idView });
}
