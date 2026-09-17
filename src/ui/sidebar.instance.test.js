import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sidebar instance lifecycle: root-scoped lookups, rebuilds, destroy()
// removing listeners and DOM, and home card navigation through a callback.
// Nav, home page, Sources page and panels.js are real; SDK calls are mocked.

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(async () => {}),
  viewRemove: vi.fn(async () => {}),
}));

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "hazard",
      label: "Hazard",
      description: "Hazard layers",
      layers: [{ key: "quake", id: "MX-QUAKE", label: "Earthquake", type: "rt", desc: "Quake." }],
    },
    {
      id: "exposure",
      label: "Exposure",
      description: "Exposure layers",
      layers: [{ key: "pop", id: "MX-POP", label: "Population", type: "vt", desc: "Pop." }],
    },
  ],
}));
vi.mock("../sdk/views.js", () => ({ viewAdd: mocks.viewAdd, viewRemove: mocks.viewRemove }));
vi.mock("../sdk/client.js", () => ({ isSDKReady: () => true }));
vi.mock("./layer-controls.js", () => ({ addOpacitySlider: vi.fn(), addLegend: vi.fn() }));
vi.mock("./mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
vi.mock("../utils/export-layers.js", () => ({ downloadLayerInventory: vi.fn() }));
vi.mock("../external/index.js", () => ({
  isExternalLayer: () => false,
  openExternalLayer: vi.fn(),
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
  getExternalLayerDefinition: () => ({}),
  getExternalLayerRuntime: () => null,
}));

import { createSidebar } from "./sidebar.js";
import * as store from "../state/store.js";
import { initMangroveTabs } from "./mangrove-tabs.js";

/** The page as index.html has it, reduced to what the sidebar uses. */
const PAGE = `
  <nav>
    <ul class="mg-mega-topbar" data-ui="nav">
      <li class="mg-mega-topbar__item"><a href="#" class="nav-home-link">Home</a></li>
      <li class="nav-info-sep" role="separator" aria-hidden="true"></li>
      <li class="mg-mega-topbar__item"><a href="#sources" class="nav-info-link" data-panel="sources">Sources</a></li>
      <li class="mg-mega-topbar__item"><a href="#about" class="nav-info-link" data-panel="about">About</a></li>
    </ul>
  </nav>
  <div id="info-page" data-ui="info-page"></div>
  <div id="app-map" data-ui="app-map">
    <div class="layer-panel" id="sidebar" data-ui="layer-panel">
      <div class="layer-panel-header">
        <button id="layer-disabled-toggle" data-ui="show-disabled" aria-pressed="false">Show disabled</button>
        <button id="layer-clear-btn" data-ui="clear-layers" hidden>Clear all</button>
        <button id="panel-toggle" data-ui="panel-toggle">Collapse</button>
      </div>
      <div id="panel-body" data-ui="panel-body"></div>
    </div>
  </div>
  <div id="global-footer" data-ui="global-footer" hidden></div>`;

/** A URL state adapter kept in memory, counting writes. */
function memoryAdapter(initial = { tab: null, layers: [] }) {
  let state = initial;
  const listeners = new Set();
  return {
    read: () => state,
    write: vi.fn((next) => {
      state = { tab: next.tab, layers: next.layers };
    }),
    subscribe: vi.fn((fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
    destroy: vi.fn(),
    navigate(next) {
      state = next;
      for (const fn of [...listeners]) fn(next);
    },
    listenerCount: () => listeners.size,
  };
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function duplicateIds() {
  const counts = new Map();
  for (const el of $$("[id]")) counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([id]) => id);
}

function pointer(type, init = {}) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
}

describe("createSidebar", () => {
  let sidebar;

  beforeEach(() => {
    history.replaceState(null, "", "#");
    document.body.innerHTML = PAGE;
    store.openViews.clear();
    store.setActiveTab("home");
    mocks.viewAdd.mockClear();
    mocks.viewRemove.mockClear();
  });

  afterEach(() => {
    sidebar?.destroy();
    sidebar = null;
  });

  it("builds panels, info pages and nav links within the root", () => {
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });

    expect($$(".tab-panel").map((el) => el.id)).toEqual(["tab-hazard", "tab-exposure"]);
    expect($$("#info-page > .info-page-panel").map((el) => el.id)).toEqual([
      "tab-home",
      "tab-sources",
      "tab-about",
    ]);
    expect($$(".nav-tab-link").map((a) => a.dataset.tab)).toEqual(["hazard", "exposure"]);
    expect($$(".panel-resize-grip")).toHaveLength(1);
    expect(duplicateIds()).toEqual([]);
    // No URL tab: the home page is shown, with the global footer.
    expect($("#tab-home").style.display).toBe("block");
    expect($("#app-map").style.display).toBe("none");
    expect($("#global-footer").hidden).toBe(false);
  });

  it("hands the Mangrove tabs its signal, so destroy removes their listeners", () => {
    initMangroveTabs.mockClear();
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    expect(initMangroveTabs).toHaveBeenCalledTimes(1);
    const [scope, options] = initMangroveTabs.mock.calls[0];
    expect(scope).toBe($("#info-page"));
    expect(options?.signal?.aborted).toBe(false);
    // Mangrove's destroy looks its containers up under the scope, so the signal
    // must abort while the info pages are still in the page.
    let panelsOnAbort = null;
    options.signal.addEventListener("abort", () => {
      panelsOnAbort = scope.querySelectorAll(".info-page-panel").length;
    });
    sidebar.destroy();
    expect(options.signal.aborted).toBe(true);
    expect(panelsOnAbort).toBe(3);
  });

  it("requires a panel body under the root", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => createSidebar(document.body, { stateAdapter: memoryAdapter() })).toThrow(/panel-body/);
  });

  it("leaves no duplicate ids or double handlers after destroy and create", () => {
    createSidebar(document.body, { stateAdapter: memoryAdapter() }).destroy();
    const adapter = memoryAdapter({ tab: "hazard", layers: [] });
    sidebar = createSidebar(document.body, { stateAdapter: adapter });

    expect(duplicateIds()).toEqual([]);
    expect($$(".tab-panel")).toHaveLength(2);
    expect($$(".info-page-panel")).toHaveLength(3);
    expect($$(".nav-tab-link")).toHaveLength(2);
    expect($$(".panel-resize-grip")).toHaveLength(1);
    expect($$(".cross-tab-item")).toHaveLength(2);

    // One click on the panel toggle is one toggle.
    const panel = $("#sidebar");
    $("#panel-toggle").click();
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    $("#panel-toggle").click();
    expect(panel.classList.contains("is-collapsed")).toBe(false);

    // One nav click is one tab switch and one URL write.
    adapter.write.mockClear();
    $(".nav-tab-link[data-tab='exposure']").click();
    expect(adapter.write).toHaveBeenCalledTimes(1);
    expect(adapter.write).toHaveBeenCalledWith({ tab: "exposure", layers: [] }, { replace: false });
    expect($("#tab-exposure").style.display).toBe("block");
    expect($("#tab-hazard").style.display).toBe("none");

    // One "Show disabled" click flips it once.
    $("#layer-disabled-toggle").click();
    expect($("#layer-disabled-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("does nothing on clicks to old elements after destroy", async () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [] });
    sidebar = createSidebar(document.body, { stateAdapter: adapter });
    const quakeSwitch = $("#tab-hazard .layer-item .layer-eye");
    quakeSwitch.click();
    await vi.waitFor(() => expect(sidebar.store.get("quake").applied).toBe(true));
    expect($("#layer-clear-btn").hidden).toBe(false);

    const oldTabLink = $(".nav-tab-link[data-tab='exposure']");
    const homeLink = $(".nav-home-link");
    const infoLink = $(".nav-info-link[data-panel='about']");
    const homeCard = $(".info-category-card[data-tab='exposure']");
    const clearBtn = $("#layer-clear-btn");
    const toggle = $("#panel-toggle");
    const disabledToggle = $("#layer-disabled-toggle");
    adapter.write.mockClear();

    sidebar.destroy();
    expect(sidebar.store).toBeNull();
    expect(sidebar.controller).toBeNull();
    // The instance's DOM is gone and the static controls are reset.
    expect($$(".tab-panel, .info-page-panel, .nav-tab-link, .panel-resize-grip")).toEqual([]);
    expect(clearBtn.hidden).toBe(true);

    for (const el of [
      oldTabLink,
      homeLink,
      infoLink,
      homeCard,
      quakeSwitch,
      clearBtn,
      toggle,
      disabledToggle,
    ]) {
      el.click();
    }
    sidebar.showTab("exposure");
    adapter.navigate({ tab: "exposure", layers: [] });
    await tick();

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.listenerCount()).toBe(0);
    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(mocks.viewRemove).not.toHaveBeenCalled();
    expect(store.activeTab).toBe("hazard");
    expect($("#sidebar").classList.contains("is-collapsed")).toBe(false);
    expect(disabledToggle.getAttribute("aria-pressed")).toBe("false");
    expect(homeLink.classList.contains("is-active")).toBe(false);
  });

  it("removes every document and window listener it added", () => {
    // Record registrations while the real methods run: window and document
    // through spies on the objects, elements through EventTarget.prototype.
    const added = [];
    const record = (target) =>
      function (type, fn, options) {
        added.push({ target, type, signal: options?.signal });
      };
    const windowAdd = vi.spyOn(window, "addEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, options) {
      record(this)(type, fn, options);
      return realAdd.call(this, type, fn, options);
    };
    let instance;
    try {
      // The default hash adapter, which the sidebar creates and owns.
      instance = createSidebar(document.body);
    } finally {
      EventTarget.prototype.addEventListener = realAdd;
    }
    instance.destroy();

    const globalCalls = [
      ...windowAdd.mock.calls.map(([type, , options]) => ({
        target: "window",
        type,
        signal: options?.signal,
      })),
      ...documentAdd.mock.calls.map(([type, , options]) => ({
        target: "document",
        type,
        signal: options?.signal,
      })),
    ];
    // The hash adapter's hashchange listener, and nothing on the document.
    expect(globalCalls.map(({ target, type }) => `${target}:${type}`)).toEqual(["window:hashchange"]);
    for (const { type, signal } of globalCalls) expect(signal?.aborted, type).toBe(true);
    expect(windowRemove).not.toHaveBeenCalled();
    expect(documentRemove).not.toHaveBeenCalled();
    for (const spy of [windowAdd, documentAdd, windowRemove, documentRemove]) spy.mockRestore();

    // Every listener on an element that stays in the page is removed too.
    const onPage = added.filter(({ target }) => target instanceof Node && target.isConnected);
    expect(onPage.map(({ target }) => target.id || target.className).sort()).toEqual(
      expect.arrayContaining(["layer-clear-btn", "layer-disabled-toggle", "panel-toggle"]),
    );
    // The three buttons, the drag handle, and the home and two info links (the
    // generated tab links and the resize grip are removed from the page).
    expect(onPage).toHaveLength(7);
    for (const { type, signal, target } of onPage) {
      expect(signal?.aborted, `${type} listener on ${target.id || target.className}`).toBe(true);
    }
  });

  it("stops following the URL after destroy", () => {
    sidebar = createSidebar(document.body);
    sidebar.destroy();

    history.pushState(null, "", "#exposure");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(store.activeTab).toBe("home");
  });

  it("opens a data tab from a home card through the callback, not a document event", () => {
    const adapter = memoryAdapter();
    sidebar = createSidebar(document.body, { stateAdapter: adapter });
    const dispatch = vi.spyOn(document, "dispatchEvent");
    const panel = $("#sidebar");
    panel.classList.add("is-collapsed");
    panel.dataset.resizedWidth = "400";

    $(".info-category-card[data-tab='exposure']").click();

    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
    expect(store.activeTab).toBe("exposure");
    expect(adapter.write).toHaveBeenLastCalledWith({ tab: "exposure", layers: [] }, { replace: false });
    expect($("#tab-exposure").style.display).toBe("block");
    expect($("#app-map").style.display).toBe("");
    expect($("#info-page").style.display).toBe("none");
    expect($("#global-footer").hidden).toBe(true);
    expect($(".nav-tab-link[data-tab='exposure']").classList.contains("is-active")).toBe(true);
    // Expanded, with the resized width restored.
    expect(panel.classList.contains("is-collapsed")).toBe(false);
    expect(panel.style.width).toBe("400px");
  });

  it("expands a collapsed panel from a nav category link", () => {
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    const panel = $("#sidebar");
    panel.classList.add("is-collapsed");

    $(".nav-info-link[data-panel='sources']").click();
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    expect($("#tab-sources").style.display).toBe("block");
    expect($("#global-footer").hidden).toBe(false);

    $(".nav-tab-link[data-tab='hazard']").click();
    expect(panel.classList.contains("is-collapsed")).toBe(false);
    expect($("#global-footer").hidden).toBe(true);
  });

  it("removes the panel's drag and resize listeners on destroy", () => {
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    const panel = $("#sidebar");
    const header = panel.querySelector(".layer-panel-header");
    const grip = panel.querySelector(".panel-resize-grip");
    header.setPointerCapture = () => {};
    grip.setPointerCapture = () => {};

    header.dispatchEvent(pointer("pointerdown"));
    expect(document.body.style.cursor).toBe("grabbing");
    header.dispatchEvent(pointer("pointerup"));

    sidebar.destroy();

    expect(header.classList.contains("is-draggable-handle")).toBe(false);
    expect(panel.querySelector(".panel-resize-grip")).toBeNull();
    header.dispatchEvent(pointer("pointerdown"));
    grip.dispatchEvent(pointer("pointerdown"));
    expect(document.body.style.cursor).toBe("");
    expect(panel.style.transition).toBe("");

    // A new instance makes the same panel draggable again.
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    header.dispatchEvent(pointer("pointerdown"));
    expect(document.body.style.cursor).toBe("grabbing");
    header.dispatchEvent(pointer("pointerup"));
  });

  it("reports the number of layers on the map through onViewsChanged", async () => {
    const counts = [];
    sidebar = createSidebar(document.body, {
      stateAdapter: memoryAdapter({ tab: "hazard", layers: [] }),
      onViewsChanged: (count) => counts.push(count),
    });

    $("#tab-hazard .layer-item .layer-eye").click();
    await vi.waitFor(() => expect(counts).toEqual([1]));
    $("#layer-clear-btn").click();
    await vi.waitFor(() => expect(counts).toEqual([1, 0]));
  });

  it("owns only the adapter it creates", () => {
    const adapter = memoryAdapter();
    createSidebar(document.body, { stateAdapter: adapter }).destroy();
    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(adapter.listenerCount()).toBe(0);
  });

  it("warns and restores nothing after destroy", async () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [{ key: "quake", sourceIdx: 0 }] });
    sidebar = createSidebar(document.body, { stateAdapter: adapter });
    sidebar.destroy();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sidebar.restoreFromUrl();

    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(mocks.viewAdd).not.toHaveBeenCalled();
  });

  it("does not look up elements outside its root", () => {
    // A second page copy outside the root must be left alone.
    document.body.innerHTML = `<div id="a">${PAGE}</div><div id="b">${PAGE.replaceAll(/ id="[^"]*"/g, "")}</div>`;
    const other = document.querySelector("#b");
    sidebar = createSidebar(document.querySelector("#a"), { stateAdapter: memoryAdapter() });

    expect(
      other.querySelectorAll(".tab-panel, .info-page-panel, .nav-tab-link, .panel-resize-grip"),
    ).toHaveLength(0);
    other.querySelector("[data-ui='panel-toggle']").click();
    expect(other.querySelector("[data-ui='layer-panel']").classList.contains("is-collapsed")).toBe(false);
  });
});
