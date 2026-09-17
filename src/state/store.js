/** Active MapX views (view IDs currently displayed on the map). */
export const openViews = new Set();

/** Currently active sidebar tab ID. "home" shows the about panel. */
export let activeTab = "home";

export function setActiveTab(tabId) {
  activeTab = tabId;
}
