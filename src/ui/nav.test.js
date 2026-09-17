import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildNavTabItem, createNav, INFO_TABS, tabPanelId } from "./nav.js";

const TABS = [
  { id: "risk", label: "Risk", description: "Risk layers" },
  { id: "hazard", label: "Hazard", description: "Hazard layers" },
  { id: "exposure", label: "Exposure" },
];

/** The static nav markup from index.html, without data tab links. */
const NAV = `
  <ul class="mg-mega-topbar" data-ui="nav">
    <li class="mg-mega-topbar__item" role="none">
      <a href="#" role="menuitem" class="mg-mega-topbar__item-link nav-home-link">Home</a>
    </li>
    <li class="nav-info-sep" role="separator" aria-hidden="true"></li>
    <li class="mg-mega-topbar__item" role="none">
      <a href="#sources" class="mg-mega-topbar__item-link nav-info-link" data-panel="sources">Sources</a>
    </li>
    <li class="mg-mega-topbar__item" role="none">
      <a href="#about" class="mg-mega-topbar__item-link nav-info-link" data-panel="about">About</a>
    </li>
  </ul>`;

function click(el) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("nav helpers", () => {
  it("names tab panels and lists the info tabs", () => {
    expect(tabPanelId("hazard")).toBe("tab-hazard");
    expect(INFO_TABS).toEqual(["home", "sources", "about"]);
  });

  it("builds a data tab item with the topbar markup", () => {
    const item = buildNavTabItem({ id: "hazard", label: "Hazard" });
    expect(item.outerHTML).toBe(
      '<li class="mg-mega-topbar__item" role="none"><a href="#hazard" role="menuitem" class="mg-mega-topbar__item-link nav-tab-link" data-tab="hazard">Hazard</a></li>',
    );
  });
});

describe("createNav", () => {
  let root;

  beforeEach(() => {
    document.body.innerHTML = NAV;
    root = document.querySelector("[data-ui='nav']");
  });

  const tabLinks = () => [...root.querySelectorAll(".nav-tab-link")];

  it("generates a link per data tab, in config order, before the separator", () => {
    createNav(root, { tabs: TABS, onSelect: vi.fn() });

    expect(tabLinks().map((a) => [a.dataset.tab, a.textContent])).toEqual([
      ["risk", "Risk"],
      ["hazard", "Hazard"],
      ["exposure", "Exposure"],
    ]);
    const items = [...root.children];
    const separator = root.querySelector(".nav-info-sep");
    expect(items.indexOf(tabLinks().at(-1).parentElement)).toBe(items.indexOf(separator) - 1);
    expect(items.indexOf(tabLinks()[0].parentElement)).toBe(1);
  });

  it("describes tab links with the tab description", () => {
    createNav(root, { tabs: TABS, onSelect: vi.fn() });

    const [risk, , exposure] = tabLinks();
    expect(risk.title).toBe("Risk layers");
    expect(risk.getAttribute("aria-description")).toBe("Risk layers");
    expect(exposure.hasAttribute("title")).toBe(false);
  });

  it("wires links already in the markup instead of duplicating them", () => {
    const existing = buildNavTabItem(TABS[1]);
    root.insertBefore(existing, root.querySelector(".nav-info-sep"));
    const onSelect = vi.fn();

    const nav = createNav(root, { tabs: TABS, onSelect });
    expect(tabLinks().map((a) => a.dataset.tab)).toEqual(["hazard", "risk", "exposure"]);

    click(existing.firstChild);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("hazard", "tab");

    nav.destroy();
    // Only generated items are removed.
    expect(tabLinks().map((a) => a.dataset.tab)).toEqual(["hazard"]);
  });

  it("reports clicks with their source and prevents the default navigation", () => {
    const onSelect = vi.fn();
    createNav(root, { tabs: TABS, onSelect });

    expect(click(root.querySelector(".nav-home-link")).defaultPrevented).toBe(true);
    expect(click(root.querySelector("[data-panel='about']")).defaultPrevented).toBe(true);
    expect(click(tabLinks()[1]).defaultPrevented).toBe(true);

    expect(onSelect.mock.calls).toEqual([
      ["home", "home"],
      ["about", "info"],
      ["hazard", "tab"],
    ]);
  });

  it("marks the active link", () => {
    const nav = createNav(root, { tabs: TABS, onSelect: vi.fn() });
    const active = () =>
      [...root.querySelectorAll(".is-active")].map((a) => a.dataset.tab ?? a.dataset.panel ?? "home");

    nav.setActive("hazard");
    expect(active()).toEqual(["hazard"]);
    nav.setActive("sources");
    expect(active()).toEqual(["sources"]);
    nav.setActive("home");
    expect(active()).toEqual(["home"]);
  });

  it("removes generated links and every listener on destroy", () => {
    const onSelect = vi.fn();
    const nav = createNav(root, { tabs: TABS, onSelect });
    const oldTabLink = tabLinks()[0];

    nav.destroy();
    nav.destroy();

    expect(tabLinks()).toEqual([]);
    click(oldTabLink);
    click(root.querySelector(".nav-home-link"));
    click(root.querySelector("[data-panel='sources']"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("is destroyed when the caller's signal aborts", () => {
    const onSelect = vi.fn();
    const controller = new AbortController();
    createNav(root, { tabs: TABS, onSelect, signal: controller.signal });

    controller.abort();

    expect(tabLinks()).toEqual([]);
    click(root.querySelector(".nav-home-link"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("builds and wires nothing when the signal is already aborted", () => {
    const onSelect = vi.fn();
    const nav = createNav(root, { tabs: TABS, onSelect, signal: AbortSignal.abort() });

    expect(tabLinks()).toEqual([]);
    click(root.querySelector(".nav-home-link"));
    click(root.querySelector("[data-panel='sources']"));
    expect(onSelect).not.toHaveBeenCalled();
    nav.setActive("sources");
    expect(root.querySelectorAll(".is-active")).toHaveLength(0);
    expect(() => nav.destroy()).not.toThrow();
  });

  it("can be created again after destroy without duplicating links or handlers", () => {
    createNav(root, { tabs: TABS, onSelect: vi.fn() }).destroy();
    const onSelect = vi.fn();
    createNav(root, { tabs: TABS, onSelect });

    expect(tabLinks()).toHaveLength(3);
    click(tabLinks()[2]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("queries only within its root", () => {
    document.body.insertAdjacentHTML("beforeend", NAV);
    const [first, second] = document.querySelectorAll("[data-ui='nav']");
    const onSelect = vi.fn();

    createNav(first, { tabs: TABS, onSelect });

    expect(second.querySelectorAll(".nav-tab-link")).toHaveLength(0);
    click(second.querySelector(".nav-home-link"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
