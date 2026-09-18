import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle, waitFor } from "../../tests/support/async.js";

// The sidebar instance lifecycle: root-scoped lookups, rebuilds, destroy()
// removing listeners and DOM, and home card navigation through a callback.
// Nav, home page, Sources page and panels.js are real; SDK calls are mocked.

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(async () => {}),
  viewRemove: vi.fn(async () => {}),
  // A controllable stand-in for the SDK client's readiness, so a test can flip
  // it and see the layer switches re-render.
  sdk: { ready: true, listeners: new Set() },
  setSDKReady(ready) {
    mocks.sdk.ready = ready;
    for (const listener of [...mocks.sdk.listeners]) listener(ready);
  },
}));

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "hazard",
      label: "Hazard",
      description: "Hazard layers",
      // The home card's visual lives on the tab (see src/config/layers/index.js).
      card: { icon: "01", color: "#c72236", desc: "Hazards." },
      layers: [{ key: "quake", id: "MX-QUAKE", label: "Earthquake", type: "rt", desc: "Quake." }],
    },
    {
      id: "exposure",
      label: "Exposure",
      description: "Exposure layers",
      card: { icon: "02", color: "#ed833f", desc: "Exposure." },
      layers: [{ key: "pop", id: "MX-POP", label: "Population", type: "vt", desc: "Pop." }],
    },
  ],
}));
vi.mock("../sdk/views.js", () => ({ viewAdd: mocks.viewAdd, viewRemove: mocks.viewRemove }));
vi.mock("../sdk/client.js", () => ({
  isSDKReady: () => mocks.sdk.ready,
  onSDKReadyChange: (listener) => {
    mocks.sdk.listeners.add(listener);
    return () => mocks.sdk.listeners.delete(listener);
  },
}));
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

/**
 * jsdom does not implement `inert`, and the warm-up feature-detects it (without
 * it the map is hidden outright instead, because `pointer-events: none` leaves
 * the keyboard able to reach an invisible overlay -- see ui/map-warming.js).
 * These tests are about the warm-up path, so they declare the support jsdom's
 * DOM otherwise lacks; `map-warming.test.js` covers both branches explicitly.
 */
if (!("inert" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "inert", { value: false, writable: true, configurable: true });
}

/** The page as index.html has it, reduced to what the sidebar uses. */
const PAGE = `
  <a href="#app-map" class="mg-skip-link" data-ui="skip-link">Skip to map</a>
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
        <label class="mg-switch"><input type="checkbox" role="switch" class="mg-switch__input" id="layer-disabled-toggle" data-ui="show-disabled" /><span class="mg-switch__track" aria-hidden="true"><span class="mg-switch__thumb"></span></span><span class="mg-switch__label">Show disabled</span></label>
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
    mocks.viewAdd.mockClear();
    mocks.viewRemove.mockClear();
    mocks.sdk.ready = true;
    mocks.sdk.listeners.clear();
  });

  afterEach(async () => {
    sidebar?.destroy();
    sidebar = null;
    // Real timers again whatever the test did, and let work the instance had in
    // flight settle here rather than inside the next test.
    vi.useRealTimers();
    await settle(() => [store.openViews.size, mocks.viewAdd.mock.calls.length]);
  });

  it("builds panels, info pages and nav links within the root", () => {
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });

    expect($$(".tab-panel").map((el) => el.dataset.tabPanel)).toEqual(["hazard", "exposure"]);
    expect($$("#info-page > .info-page-panel").map((el) => el.dataset.tabPanel)).toEqual([
      "home",
      "sources",
      "about",
    ]);
    // Panels are found by data-tab-panel; the instance creates no tab-* ids.
    expect($$("[id^='tab-']")).toEqual([]);
    expect($$(".nav-tab-link").map((a) => a.dataset.tab)).toEqual(["hazard", "exposure"]);
    expect($$(".panel-resize-grip")).toHaveLength(1);
    expect(duplicateIds()).toEqual([]);
    // No URL tab: the home page is shown, with the global footer. The map is
    // not hidden, it warms up behind the page (inert, and transparent in CSS).
    expect($("[data-tab-panel='home']").style.display).toBe("block");
    expect($("#app-map").style.display).toBe("");
    expect($("#app-map").classList.contains("is-warming")).toBe(true);
    expect($("#app-map").getAttribute("aria-hidden")).toBe("true");
    // `inert` sits on the map and on each child, and a MutationObserver puts it
    // back wherever it is removed or a child appears (Mangrove's preview gate
    // strips it from every child of <body> when the PIN is accepted; the site
    // inspector's panel is appended after this).
    expect($("#app-map").hasAttribute("inert")).toBe(true);
    expect([...$("#app-map").children].every((el) => el.hasAttribute("inert"))).toBe(true);
    // Nothing to skip to: the skip link's target is the invisible map.
    expect($("[data-ui='skip-link']").hidden).toBe(true);
    expect($("#global-footer").hidden).toBe(false);
  });

  /**
   * `#site-inspector` is built lazily, long after the first tab renders, so a
   * one-shot loop over `#app-map`'s children never reaches it. The map's own
   * `inert` covers it in normal use — but the per-child loop exists precisely
   * because Mangrove's preview gate strips that one from every child of
   * `<body>` when the PIN is accepted, and then the late child would be the one
   * reachable thing behind the information page.
   */
  it("marks a map child appended after the warm-up started", async () => {
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    expect($("#app-map").classList.contains("is-warming")).toBe(true);

    const late = document.createElement("div");
    late.id = "site-inspector";
    $("#app-map").appendChild(late);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(late.hasAttribute("inert")).toBe(true);
    expect([...$("#app-map").children].every((el) => el.hasAttribute("inert"))).toBe(true);

    // And it is released with the rest when the map comes back to the front.
    sidebar.showTab("hazard");
    expect([...$("#app-map").children].some((el) => el.hasAttribute("inert"))).toBe(false);
  });

  it("re-renders the layer switches when the map becomes ready", () => {
    mocks.sdk.ready = false;
    sidebar = createSidebar(document.body, {
      stateAdapter: memoryAdapter({ tab: "hazard", layers: [] }),
    });
    const switches = () => $$(".layer-eye");
    expect(switches().length).toBeGreaterThan(0);
    for (const input of switches()) expect(input.getAttribute("aria-disabled")).toBe("true");

    mocks.setSDKReady(true);

    // Every row, home and cross-tab, drops the disabled state without any
    // record changing.
    for (const input of switches()) expect(input.hasAttribute("aria-disabled")).toBe(false);

    mocks.setSDKReady(false);
    for (const input of switches()) expect(input.getAttribute("aria-disabled")).toBe("true");
  });

  it("stops listening for readiness changes on destroy", () => {
    sidebar = createSidebar(document.body, {
      stateAdapter: memoryAdapter({ tab: "hazard", layers: [] }),
    });
    expect(mocks.sdk.listeners.size).toBe(1);

    sidebar.destroy();

    // No listener is left holding the destroyed instance, and a late report
    // reaches nothing.
    expect(mocks.sdk.listeners.size).toBe(0);
    expect(() => mocks.setSDKReady(false)).not.toThrow();
  });

  it("leaves the collapse control describing the panel it restored", () => {
    const toggle = $("#panel-toggle");
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    sidebar.destroy();

    // destroy() re-opens the panel, so the control must not still say
    // "Expand" over an open panel.
    expect($("#sidebar").classList.contains("is-collapsed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse the layers panel");
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

  // The active tab is per instance, not module state. One case per rule: five
  // build-and-destroy cycles in a single test were the most expensive test in
  // the suite, and the first to blow vitest's timeout on a loaded machine.
  describe("the active tab is per instance", () => {
    it("starts a new instance on home, not on the previous instance's tab", () => {
      const first = createSidebar(document.body, { stateAdapter: memoryAdapter() });
      $(".nav-info-link[data-panel='sources']").click();
      expect($("[data-tab-panel='sources']").style.display).toBe("block");
      first.destroy();

      sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
      expect($("[data-tab-panel='home']").style.display).toBe("block");
      expect(sidebar.activeTab).toBe("home");
    });

    it("starts on initialTab and writes it as a replacement", () => {
      const adapter = memoryAdapter();
      sidebar = createSidebar(document.body, { stateAdapter: adapter, initialTab: "exposure" });
      expect(sidebar.activeTab).toBe("exposure");
      expect(adapter.write).toHaveBeenCalledWith({ tab: "exposure", layers: [] }, { replace: true });
    });

    it("lets a tab in the URL win over initialTab", () => {
      sidebar = createSidebar(document.body, {
        stateAdapter: memoryAdapter({ tab: "hazard", layers: [] }),
        initialTab: "exposure",
      });
      expect(sidebar.activeTab).toBe("hazard");
    });

    it("falls back to home for an unknown initialTab", () => {
      sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter(), initialTab: "nope" });
      expect(sidebar.activeTab).toBe("home");
    });
  });

  it("restores the page state it changed on destroy", () => {
    const panel = $("#sidebar");
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    $("#panel-toggle").click();
    sidebar.showTab("hazard");
    $(".nav-info-link[data-panel='sources']").click();
    expect($("#app-map").classList.contains("is-warming")).toBe(true);
    expect($("#info-page").style.display).toBe("block");
    expect($("#global-footer").hidden).toBe(false);

    sidebar.destroy();

    expect($("#app-map").classList.contains("is-warming")).toBe(false);
    expect($("#app-map").hasAttribute("inert")).toBe(false);
    expect([...$("#app-map").children].some((el) => el.hasAttribute("inert"))).toBe(false);
    expect($("[data-ui='skip-link']").hidden).toBe(false);
    expect($("#info-page").style.display).toBe("");
    expect($("#global-footer").hidden).toBe(true);
    expect($$(".is-active")).toEqual([]);
    expect(panel.classList.contains("is-collapsed")).toBe(false);

    // A panel the markup collapsed stays collapsed, and keeps no resize sizes.
    panel.classList.add("is-collapsed");
    panel.dataset.resizedWidth = "400";
    sidebar = createSidebar(document.body, { stateAdapter: memoryAdapter() });
    sidebar.showTab("hazard");
    expect(panel.classList.contains("is-collapsed")).toBe(false);
    expect(panel.style.width).toBe("400px");
    sidebar.destroy();
    expect(panel.classList.contains("is-collapsed")).toBe(true);
    expect(panel.style.width).toBe("");
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
    expect($("[data-tab-panel='exposure']").style.display).toBe("block");
    expect($("[data-tab-panel='hazard']").style.display).toBe("none");

    // One "Show disabled" click flips the switch once.
    $("#layer-disabled-toggle").click();
    expect($("#layer-disabled-toggle").checked).toBe(true);
    expect($("[data-tab-panel='exposure'] [data-layer-disabled='true']")?.hidden ?? false).toBe(false);
  });

  it("does nothing on clicks to old elements after destroy", async () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [] });
    sidebar = createSidebar(document.body, { stateAdapter: adapter });
    const quakeSwitch = $("[data-tab-panel='hazard'] .layer-item .layer-eye");
    quakeSwitch.click();
    await waitFor(() => expect(sidebar.store.get("quake").applied).toBe(true));
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
    // "Show disabled" is reset for the next instance.
    expect(disabledToggle.checked).toBe(false);
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
    // Nothing should happen, so there is no outcome to wait for: wait for quiet
    // instead of guessing at a number of ticks.
    await settle(() => [adapter.write.mock.calls.length, mocks.viewRemove.mock.calls.length]);

    expect(adapter.write).not.toHaveBeenCalled();
    expect(adapter.listenerCount()).toBe(0);
    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(mocks.viewRemove).not.toHaveBeenCalled();
    expect(sidebar.activeTab).toBe("hazard");
    expect($("#sidebar").classList.contains("is-collapsed")).toBe(false);
    // The checkbox flips itself when clicked (the browser does that), but the
    // destroyed instance no longer listens: nothing is rebuilt and no disabled
    // row reappears.
    expect(disabledToggle.checked).toBe(true);
    expect($$("[data-layer-disabled='true']")).toEqual([]);
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

    expect(sidebar.activeTab).toBe("home");
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
    expect(sidebar.activeTab).toBe("exposure");
    expect(adapter.write).toHaveBeenLastCalledWith({ tab: "exposure", layers: [] }, { replace: false });
    expect($("[data-tab-panel='exposure']").style.display).toBe("block");
    expect($("#app-map").style.display).toBe("");
    expect($("#app-map").classList.contains("is-warming")).toBe(false);
    expect($("#app-map").hasAttribute("aria-hidden")).toBe(false);
    // There is a map to skip to again.
    expect($("[data-ui='skip-link']").hidden).toBe(false);
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
    expect($("[data-tab-panel='sources']").style.display).toBe("block");
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

    $("[data-tab-panel='hazard'] .layer-item .layer-eye").click();
    await waitFor(() => expect(counts).toEqual([1]));
    $("#layer-clear-btn").click();
    await waitFor(() => expect(counts).toEqual([1, 0]));
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

  it("documents what two live instances still share: Mangrove section ids and openViews", async () => {
    // Not supported yet (see ARCHITECTURE.md); this pins the known collisions.
    const noIds = PAGE.replaceAll(/ id="[^"]*"/g, "");
    document.body.innerHTML = `<div id="a">${noIds}</div><div id="b">${noIds}</div>`;
    sidebar = createSidebar($("#a"), { stateAdapter: memoryAdapter({ tab: "hazard", layers: [] }) });
    $("#a [data-tab-panel='hazard'] .layer-item .layer-eye").click();
    await waitFor(() => expect(store.openViews.has("MX-QUAKE")).toBe(true));

    const second = createSidebar($("#b"), { stateAdapter: memoryAdapter() });
    try {
      // Creating B clears the module openViews Set that A mirrors into.
      expect(store.openViews.size).toBe(0);
      expect(sidebar.store.get("quake").applied).toBe(true);
      // The only duplicate ids are the Sources page's Mangrove tab sections,
      // which Mangrove's tab links point at by id.
      const dupes = duplicateIds();
      expect(dupes.length).toBeGreaterThan(0);
      for (const id of dupes) expect(id).toMatch(/^mg-tabs__section-sources-\d+(--trigger)?$/);
    } finally {
      second.destroy();
    }
  });

  it("skips the parts of a sidebar root nested inside its root", () => {
    // The nested root comes first in document order, so a plain querySelector
    // under the outer root would find its parts.
    const noIds = PAGE.replaceAll(/ id="[^"]*"/g, "");
    document.body.innerHTML = `<div id="outer"><div id="inner" data-ui-root>${noIds}</div>${PAGE}</div>`;
    const inner = document.querySelector("#inner");
    sidebar = createSidebar(document.querySelector("#outer"), { stateAdapter: memoryAdapter() });

    expect($("#outer").hasAttribute("data-ui-root")).toBe(true);
    expect(inner.querySelectorAll(".tab-panel, .info-page-panel, .nav-tab-link")).toHaveLength(0);
    expect($("#panel-body").querySelectorAll(".tab-panel")).toHaveLength(2);

    sidebar.destroy();
    sidebar = null;
    // It removes only the mark it added.
    expect($("#outer").hasAttribute("data-ui-root")).toBe(false);
    expect(inner.hasAttribute("data-ui-root")).toBe(true);
  });
});
