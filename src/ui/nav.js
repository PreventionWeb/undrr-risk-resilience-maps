/**
 * Category navigation: the data tab links, generated from the tab config, and
 * the static home and info links, all wired within one nav root.
 *
 * `index.html` holds the nav list with the home link, a separator and the info
 * links (Sources, About). createNav() inserts a link per data tab before the
 * separator, so adding a tab to `TABS` needs no markup change. A data tab that
 * already has a `.nav-tab-link[data-tab]` in the root (hand-written markup) is
 * wired as it is, not duplicated.
 *
 * Nothing here queries the document: every lookup goes through the root, and
 * every listener is removed by destroy() or the caller's signal.
 */

/** Tabs that show a full page instead of the map (hash routing ids). */
export const INFO_TABS = ["home", "sources", "about"];

/**
 * The element id of a tab's panel (`tab-hazard`, `tab-home`). Kept for CSS
 * and in-page links; the sidebar holds panel references instead of looking
 * panels up by id.
 * @param {string} tabId
 */
export function tabPanelId(tabId) {
  return `tab-${tabId}`;
}

/**
 * Build a data tab's nav item, matching the Mangrove topbar markup.
 * @param {{ id: string, label: string }} tab
 * @returns {HTMLLIElement}
 */
export function buildNavTabItem(tab) {
  const item = document.createElement("li");
  item.className = "mg-mega-topbar__item";
  item.setAttribute("role", "none");
  const link = document.createElement("a");
  link.href = `#${tab.id}`;
  link.setAttribute("role", "menuitem");
  link.className = "mg-mega-topbar__item-link nav-tab-link";
  link.dataset.tab = tab.id;
  link.textContent = tab.label;
  item.appendChild(link);
  return item;
}

/**
 * Generate and wire the nav within `root`.
 * @param {HTMLElement} root - the nav list (or an element containing it)
 * @param {object} options
 * @param {object[]} options.tabs - data tabs (TABS entries), in nav order
 * @param {(tabId: string, source: "home"|"info"|"tab") => void} options.onSelect -
 *   a link was clicked (its default navigation is prevented)
 * @param {AbortSignal} [options.signal] - aborting it destroys the nav
 * @returns {{ setActive(tabId: string): void, destroy(): void }}
 */
export function createNav(root, { tabs, onSelect, signal }) {
  // Already destroyed by the caller: build and wire nothing (as panels.js does).
  if (signal?.aborted) return { setActive() {}, destroy() {} };
  const controller = new AbortController();
  const listen = { signal: controller.signal };
  signal?.addEventListener("abort", () => destroy(), { once: true, signal: controller.signal });

  // Generate the data tab links the markup doesn't already have.
  const created = [];
  const list = root.matches("ul") ? root : (root.querySelector("ul") ?? root);
  const separator = list.querySelector(".nav-info-sep");
  const existing = new Set([...root.querySelectorAll(".nav-tab-link[data-tab]")].map((a) => a.dataset.tab));
  for (const tab of tabs) {
    if (existing.has(tab.id)) continue;
    const item = buildNavTabItem(tab);
    list.insertBefore(item, separator?.parentNode === list ? separator : null);
    created.push(item);
  }

  const homeLink = root.querySelector(".nav-home-link");
  const infoLinks = [...root.querySelectorAll(".nav-info-link")];
  const tabLinks = [...root.querySelectorAll(".nav-tab-link")];
  // The markup's own links and their active state, restored on destroy.
  const initialActive = new Map(
    [homeLink, ...infoLinks, ...tabLinks]
      .filter((link) => link && !created.some((item) => item.contains(link)))
      .map((link) => [link, link.classList.contains("is-active")]),
  );

  homeLink?.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      onSelect("home", "home");
    },
    listen,
  );

  for (const link of infoLinks) {
    link.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        onSelect(link.dataset.panel, "info");
      },
      listen,
    );
  }

  for (const link of tabLinks) {
    const tab = tabs.find((candidate) => candidate.id === link.dataset.tab);
    if (tab?.description) {
      link.title = tab.description;
      link.setAttribute("aria-description", tab.description);
    }
    link.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        onSelect(link.dataset.tab, "tab");
      },
      listen,
    );
  }

  function setActive(tabId) {
    for (const link of tabLinks) link.classList.toggle("is-active", link.dataset.tab === tabId);
    homeLink?.classList.toggle("is-active", tabId === "home");
    for (const link of infoLinks) link.classList.toggle("is-active", link.dataset.panel === tabId);
  }

  function destroy() {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const item of created.splice(0)) item.remove();
    for (const [link, active] of initialActive) link.classList.toggle("is-active", active);
  }

  return { setActive, destroy };
}
