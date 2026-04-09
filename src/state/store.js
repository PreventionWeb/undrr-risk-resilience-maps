/** Active MapX views (view IDs currently displayed on the map). */
export const openViews = new Set();

/** Currently active sidebar tab ID. "home" shows the about panel. */
export let activeTab = "home";

export function setActiveTab(tabId) {
  activeTab = tabId;
}

/**
 * For compound layers: tracks which source index is active per layer.
 * Key: layer.key or layer.label. Value: index into the sources array.
 */
const activeSourceIndex = new Map();

export function getActiveSource(key) {
  return activeSourceIndex.get(key) ?? 0;
}

export function setActiveSource(key, index) {
  activeSourceIndex.set(key, index);
}
