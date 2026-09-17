import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(),
  viewRemove: vi.fn(),
  addOpacitySlider: vi.fn(),
  addLegend: vi.fn(),
  openExternalLayer: vi.fn(),
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
}));

// Runtime views of open external layers, like the real registry keeps.
const externalRuntimes = vi.hoisted(() => new Map());

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "resilience",
      label: "Resilience",
      description: "Resilience layers",
      layers: [{ key: "ews", id: "MX-EWS", label: "Early Warning", type: "vt", desc: "EWS." }],
    },
    {
      id: "risk",
      label: "Risk",
      description: "Risk layers",
      layers: [
        { key: "recovery", id: "MX-REC", label: "Recovery Speed", type: "vt", desc: "Recovery." },
        {
          key: "flood",
          label: "Flood",
          type: "rt",
          desc: "Flood.",
          widget: { type: "sub-tabs" },
          sources: [
            { id: "MX-F10", label: "10y", desc: "Ten." },
            { id: "MX-F100", label: "100y", desc: "Hundred." },
            { id: "MX-F500", label: "500y", desc: "Five hundred." },
          ],
        },
        { key: "crops", label: "Crops", type: "cc", desc: "Crops.", external: { defaults: {} } },
      ],
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
vi.mock("./layer-controls.js", () => ({
  addOpacitySlider: mocks.addOpacitySlider,
  addLegend: mocks.addLegend,
}));
vi.mock("./home.js", () => ({ buildHomePanel: () => document.createElement("div") }));
vi.mock("./info-panels.js", () => ({
  buildSourcesPanel: () => document.createElement("div"),
  buildAboutPanel: () => document.createElement("div"),
}));
vi.mock("./global-footer.js", () => ({ setGlobalFooterVisible: vi.fn() }));
vi.mock("./mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
vi.mock("../utils/panels.js", () => ({
  makeDraggable: vi.fn(),
  makeResizable: vi.fn(),
  onPanelCollapse: vi.fn(),
  onPanelExpand: vi.fn(),
}));
vi.mock("../external/index.js", () => ({
  isExternalLayer: (layer) => Boolean(layer.external),
  openExternalLayer: mocks.openExternalLayer,
  closeExternalLayer: mocks.closeExternalLayer,
  replaceExternalLayer: mocks.replaceExternalLayer,
  getExternalLayerDefinition: () => ({
    controls: [
      {
        key: "crop",
        label: "Crop",
        options: [
          { value: "WHEAT", label: "Wheat" },
          { value: "MAIZE", label: "Maize" },
        ],
      },
    ],
  }),
  getExternalLayerRuntime: (layer) => externalRuntimes.get(layer.key) ?? null,
}));

/** Default external registry behaviour: open registers a runtime view, close drops it. */
function mockExternalRegistry() {
  externalRuntimes.clear();
  mocks.openExternalLayer.mockImplementation(async (layer, settings) => {
    const runtime = { idView: `GJ-${layer.key}`, settings: { ...settings } };
    externalRuntimes.set(layer.key, runtime);
    return runtime;
  });
  mocks.closeExternalLayer.mockImplementation(async (layer) => {
    externalRuntimes.delete(layer.key);
  });
}

import {
  buildSidebar,
  destroySidebar,
  getLayersStore,
  onViewsChanged,
  restoreLayersFromHash,
} from "./sidebar.js";
import * as store from "../state/store.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Controls render asynchronously, like the real SDK-backed implementations.
function asyncRender(className) {
  return async (_arg, container) => {
    await tick();
    const el = document.createElement("div");
    el.className = className;
    container.appendChild(el);
  };
}

function showTab(tabId) {
  document.dispatchEvent(new CustomEvent("navigate-tab", { detail: tabId }));
}

/** The cross-tab row for a layer inside a given tab panel. */
function crossRow(tabId, label) {
  return [...document.querySelectorAll(`#tab-${tabId} .cross-tab-item`)].find(
    (item) => item.querySelector(".cross-tab-label").textContent === label,
  );
}

describe("cross-tab layer rows", () => {
  beforeEach(() => {
    window.location.hash = "";
    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    store.openViews.clear();
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.viewAdd.mockResolvedValue(undefined);
    mocks.viewRemove.mockResolvedValue(undefined);
    mocks.addOpacitySlider.mockImplementation(asyncRender("opacity-row"));
    mocks.addLegend.mockImplementation(asyncRender("html-legend"));
    mockExternalRegistry();
    buildSidebar();
    showTab("resilience");
  });

  it("shows the legend under the row when a layer is turned on from another tab", async () => {
    const row = crossRow("resilience", "Recovery Speed");
    const body = row.querySelector(".cross-tab-body");
    expect(body.hidden).toBe(true);

    row.querySelector(".layer-eye").click();

    await vi.waitFor(() => expect(body.querySelector(".layer-legend-slot .html-legend")).not.toBeNull());
    expect(body.hidden).toBe(false);
    expect(body.querySelector(".layer-slider-slot .opacity-row")).not.toBeNull();
    expect(body.querySelector(".layer-desc").textContent).toBe("Recovery.");
    expect(row.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("true");

    row.querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(body.hidden).toBe(true));
    expect(body.querySelector(".html-legend")).toBeNull();
  });

  it("renders layer controls only in the visible tab", async () => {
    crossRow("resilience", "Recovery Speed").querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.has("MX-REC")).toBe(true));

    // Only the visible Resilience row: not the hidden Exposure row, and not the
    // home accordion in the hidden Risk tab.
    expect(mocks.addLegend).toHaveBeenCalledTimes(1);
    expect(crossRow("exposure", "Recovery Speed").querySelector(".cross-tab-body").hidden).toBe(true);

    showTab("exposure");
    expect(mocks.addLegend).toHaveBeenCalledTimes(2);
    expect(crossRow("exposure", "Recovery Speed").querySelector(".cross-tab-body").hidden).toBe(false);

    showTab("risk");
    expect(mocks.addLegend).toHaveBeenCalledTimes(3);

    // Rows keep their rendered controls while their tab is hidden, so switching
    // tabs does not re-request them.
    showTab("resilience");
    showTab("risk");
    showTab("exposure");
    expect(mocks.addLegend).toHaveBeenCalledTimes(3);
  });

  it("renders the hidden home row's slider and legend once, when its tab is shown", async () => {
    const home = homeItem("risk", "Recovery Speed");
    const inHome = (mock) => mock.mock.calls.filter(([, container]) => home.contains(container)).length;

    crossRow("resilience", "Recovery Speed").querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(getLayersStore().get("recovery").applied).toBe(true));
    await tick();

    // Activating from a cross-tab row renders nothing into the hidden home accordion.
    expect(inHome(mocks.addLegend)).toBe(0);
    expect(inHome(mocks.addOpacitySlider)).toBe(0);
    expect(home.querySelector(".html-legend")).toBeNull();
    // The accordion still opens and shows the switch state.
    expect(home.classList.contains("layer-active")).toBe(true);
    expect(home.querySelector(".layer-body").style.display).toBe("block");

    showTab("risk");
    expect(inHome(mocks.addLegend)).toBe(1);
    expect(inHome(mocks.addOpacitySlider)).toBe(1);
    await vi.waitFor(() => expect(home.querySelector(".layer-legend-slot .html-legend")).not.toBeNull());

    for (const tab of ["resilience", "risk", "exposure", "risk", "resilience"]) showTab(tab);
    expect(inHome(mocks.addLegend)).toBe(1);
    expect(inHome(mocks.addOpacitySlider)).toBe(1);
    // Resilience and Exposure rows once each, plus the home row.
    expect(mocks.addLegend).toHaveBeenCalledTimes(3);
    expect(mocks.addOpacitySlider).toHaveBeenCalledTimes(3);
  });

  it("renders no slider or legend when a link is restored on an info tab, then one per row shown", async () => {
    showTab("sources");
    history.replaceState(null, "", "#sources?layers=recovery,pop");

    await restoreLayersFromHash();
    await tick();

    expect(store.openViews).toEqual(new Set(["MX-REC", "MX-POP"]));
    expect(mocks.addLegend).not.toHaveBeenCalled();
    expect(mocks.addOpacitySlider).not.toHaveBeenCalled();

    /** How many times each rendered row received a slider or legend. */
    const perRow = (mock) => {
      const counts = new Map();
      for (const [, container] of mock.mock.calls) {
        const row = container.closest(".layer-item, .cross-tab-item");
        counts.set(row, (counts.get(row) ?? 0) + 1);
      }
      return counts;
    };
    const resilienceRows = [crossRow("resilience", "Recovery Speed"), crossRow("resilience", "Population")];

    showTab("resilience");
    for (const mock of [mocks.addLegend, mocks.addOpacitySlider]) {
      expect([...perRow(mock).keys()]).toEqual(expect.arrayContaining(resilienceRows));
      expect([...perRow(mock).values()]).toEqual([1, 1]);
    }

    showTab("exposure");
    const exposureRows = [homeItem("exposure", "Population"), crossRow("exposure", "Recovery Speed")];
    for (const mock of [mocks.addLegend, mocks.addOpacitySlider]) {
      const counts = perRow(mock);
      expect([...counts.keys()]).toEqual(expect.arrayContaining([...resilienceRows, ...exposureRows]));
      expect([...counts.values()]).toEqual([1, 1, 1, 1]);
    }
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#tab-exposure .layer-legend-slot .html-legend")).toHaveLength(2),
    );
  });

  it("shows an external layer's load error in the cross-tab row", async () => {
    mocks.openExternalLayer.mockRejectedValue(new Error("offline"));
    const row = crossRow("resilience", "Crops");

    row.querySelector(".layer-eye").click();

    const status = row.querySelector(".cross-tab-body .external-layer-status");
    await vi.waitFor(() => expect(status.textContent).toBe("Could not load Crops. Please try again."));
    expect(status.hidden).toBe(false);
    expect(status.classList.contains("is-error")).toBe(true);
    expect(row.querySelector(".cross-tab-body").hidden).toBe(false);
    expect(row.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("false");
  });

  it("turns a layer off after a source switch that was in flight settles", async () => {
    showTab("risk");
    const floodEye = [...document.querySelectorAll("#tab-risk .layer-item")]
      .find((item) => item.querySelector(".layer-label").textContent === "Flood")
      .querySelector(".layer-eye");
    floodEye.click();
    await vi.waitFor(() => expect(store.openViews.has("MX-F10")).toBe(true));
    showTab("resilience");

    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    const tabs = floodEye.closest(".layer-item").querySelectorAll(".widget-sub-tab");
    tabs[1].click();
    await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenCalledWith("MX-F100"));

    // "Clear all" while the new source is still loading.
    document.getElementById("layer-clear-btn").click();
    slowAdd.resolve();

    const row = crossRow("resilience", "Flood");
    // The switch follows intent at once; the map catches up once the switch settles.
    expect(floodEye.getAttribute("aria-checked")).toBe("false");
    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("idle"));
    expect(store.openViews.size).toBe(0);
    expect(mocks.viewRemove).toHaveBeenLastCalledWith("MX-F100");
    expect(row.querySelector(".cross-tab-body").hidden).toBe(true);
    expect(row.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("false");
  });

  it("restores a shared link without adding history entries", async () => {
    history.replaceState(null, "", "#resilience?layers=recovery,flood:1");
    const lengthBefore = history.length;

    await restoreLayersFromHash();

    expect(store.openViews).toEqual(new Set(["MX-REC", "MX-F100"]));
    expect(history.length).toBe(lengthBefore);
    expect(location.hash).toBe("#resilience?layers=recovery,flood:1");
  });

  it("clears several layers as a single history entry", async () => {
    crossRow("resilience", "Recovery Speed").querySelector(".layer-eye").click();
    crossRow("resilience", "Population").querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.size).toBe(2));
    const lengthBefore = history.length;

    document.getElementById("layer-clear-btn").click();

    await vi.waitFor(() => expect(location.hash).toBe("#resilience"));
    expect(store.openViews.size).toBe(0);
    expect(history.length).toBe(lengthBefore + 1);
  });

  it("applies back/forward navigation without writing intermediate history", async () => {
    crossRow("resilience", "Recovery Speed").querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(location.hash).toBe("#resilience?layers=recovery"));

    // Simulate the browser moving to another entry.
    history.pushState(null, "", "#exposure?layers=pop");
    const lengthBefore = history.length;
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await vi.waitFor(() => expect(store.openViews).toEqual(new Set(["MX-POP"])));
    await tick();
    expect(store.activeTab).toBe("exposure");
    expect(location.hash).toBe("#exposure?layers=pop");
    expect(history.length).toBe(lengthBefore);
  });
});

/** Layer keys in the current hash's `layers` param. */
function hashLayerKeys() {
  const query = location.hash.split("?")[1];
  const layers = new URLSearchParams(query ?? "").get("layers");
  return layers ? layers.split(",").map((segment) => segment.split(":")[0]) : [];
}

/** The layer's own accordion in its home tab. */
function homeItem(tabId, label) {
  return [...document.querySelectorAll(`#tab-${tabId} .layer-item`)].find(
    (item) => item.querySelector(".layer-label").textContent === label,
  );
}

/**
 * Assert a layer reads the same everywhere: openViews, its home switch, a
 * cross-tab row and the URL hash.
 */
function expectLayerState({ key, label, homeTab, viewIds, on }) {
  expect(viewIds.some((id) => store.openViews.has(id))).toBe(on);
  expect(homeItem(homeTab, label).querySelector(".layer-eye").getAttribute("aria-checked")).toBe(String(on));
  expect(crossRow("resilience", label).querySelector(".layer-eye").getAttribute("aria-checked")).toBe(
    String(on),
  );
  expect(hashLayerKeys().includes(key)).toBe(on);
}

const RECOVERY = { key: "recovery", label: "Recovery Speed", homeTab: "risk", viewIds: ["MX-REC"] };
const FLOOD = { key: "flood", label: "Flood", homeTab: "risk", viewIds: ["MX-F10", "MX-F100"] };
const POP = { key: "pop", label: "Population", homeTab: "exposure", viewIds: ["MX-POP"] };

// Safety net for the layer state refactor (unisdr/undrr-risk-resilience-maps#14):
// pins the current contract between openViews, the toggles and the URL hash.
describe("layer state consistency", () => {
  let warn;

  beforeEach(() => {
    window.location.hash = "";
    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    store.openViews.clear();
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.viewAdd.mockResolvedValue(undefined);
    mocks.viewRemove.mockResolvedValue(undefined);
    mocks.addOpacitySlider.mockImplementation(asyncRender("opacity-row"));
    mocks.addLegend.mockImplementation(asyncRender("html-legend"));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExternalRegistry();
    buildSidebar();
    showTab("resilience");
    return () => warn.mockRestore();
  });

  async function turnOn(layer) {
    crossRow("resilience", layer.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashLayerKeys()).toContain(layer.key));
  }

  async function turnOnHome(layer) {
    homeItem(layer.homeTab, layer.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashLayerKeys()).toContain(layer.key));
    await vi.waitFor(() => expect(getLayersStore().get(layer.key).status).toBe("idle"));
  }

  describe("rapid double toggle", () => {
    it.each([
      ["simple", RECOVERY],
      ["compound", FLOOD],
    ])("leaves a %s layer off, as the last click asked", async (_kind, layer) => {
      const eye = crossRow("resilience", layer.label).querySelector(".layer-eye");
      eye.click();
      eye.click();

      // The second click lands while the first is in flight and is applied after it.
      await vi.waitFor(() => expect(mocks.viewRemove).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(getLayersStore().get(layer.key).status).toBe("idle"));
      expect(mocks.viewAdd).toHaveBeenCalledTimes(1);
      expectLayerState({ ...layer, on: false });
    });

    it("ends on the last of three clicks without touching the map again", async () => {
      const slowAdd = deferred();
      mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
      const eye = crossRow("resilience", RECOVERY.label).querySelector(".layer-eye");
      eye.click();
      eye.click();
      eye.click();
      slowAdd.resolve();

      await vi.waitFor(() => expect(hashLayerKeys()).toContain(RECOVERY.key));
      expect(mocks.viewAdd).toHaveBeenCalledTimes(1);
      expect(mocks.viewRemove).not.toHaveBeenCalled();
      expectLayerState({ ...RECOVERY, on: true });
    });

    it.each([
      ["simple", RECOVERY],
      ["compound", FLOOD],
    ])("turns a %s layer off when the second click follows the first settling", async (_kind, layer) => {
      await turnOn(layer);
      crossRow("resilience", layer.label).querySelector(".layer-eye").click();

      await vi.waitFor(() => expect(hashLayerKeys()).not.toContain(layer.key));
      expectLayerState({ ...layer, on: false });
    });
  });

  describe("viewRemove rejection", () => {
    it.each([
      ["simple", RECOVERY],
      ["compound", FLOOD],
    ])("keeps a %s layer on when MapX fails to remove it", async (_kind, layer) => {
      await turnOn(layer);
      mocks.viewRemove.mockRejectedValueOnce(new Error("postMessage timeout"));

      crossRow("resilience", layer.label).querySelector(".layer-eye").click();

      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      await tick();
      expectLayerState({ ...layer, on: true });
      expect(document.getElementById("layer-clear-btn").hidden).toBe(false);
    });
  });

  it("adds views in the order of the shared link's layers on restore", async () => {
    history.replaceState(null, "", "#risk?layers=pop,flood:1,recovery");

    await restoreLayersFromHash();

    expect(mocks.viewAdd.mock.calls.map(([id]) => id)).toEqual(["MX-POP", "MX-F100", "MX-REC"]);
  });

  it("turns off a layer that is still loading when Clear all is clicked", async () => {
    await turnOn(FLOOD);
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    expect(mocks.viewAdd).toHaveBeenLastCalledWith("MX-REC");
    const lengthBefore = history.length;

    document.getElementById("layer-clear-btn").click();
    slowAdd.resolve();
    await vi.waitFor(() => expect(getLayersStore().get(RECOVERY.key).status).toBe("idle"));
    await tick();

    expectLayerState({ ...FLOOD, on: false });
    expectLayerState({ ...RECOVERY, on: false });
    expect(location.hash).toBe("#resilience");
    // Clear-all is still one history entry, even though a layer was loading.
    expect(history.length).toBe(lengthBefore + 1);
  });

  it("shows Clear all while the only layer is still loading", async () => {
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    const clearBtn = document.getElementById("layer-clear-btn");

    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();

    expect(clearBtn.hidden).toBe(false);
    clearBtn.click();
    expect(clearBtn.hidden).toBe(true);
    slowAdd.resolve();
    await vi.waitFor(() => expect(getLayersStore().get(RECOVERY.key).status).toBe("idle"));
    expectLayerState({ ...RECOVERY, on: false });
  });

  it("turns off an external layer that is turned off while it is still loading", async () => {
    const slowOpen = deferred();
    const open = mocks.openExternalLayer.getMockImplementation();
    mocks.openExternalLayer.mockImplementationOnce(async (...args) => {
      await slowOpen.promise;
      return open(...args);
    });
    const eye = crossRow("resilience", "Crops").querySelector(".layer-eye");

    eye.click();
    expect(eye.disabled).toBe(false);
    eye.click();
    expect(eye.getAttribute("aria-checked")).toBe("false");
    slowOpen.resolve();

    await vi.waitFor(() => expect(mocks.closeExternalLayer).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getLayersStore().get("crops").status).toBe("idle"));
    expect(externalRuntimes.size).toBe(0);
    expect(getLayersStore().get("crops")).toMatchObject({ desired: false, applied: false, viewId: null });
    expect(hashLayerKeys()).not.toContain("crops");
    expect(crossRow("resilience", "Crops").querySelector(".cross-tab-body").hidden).toBe(true);
  });

  it("ends on the last source picked when sources are clicked quickly", async () => {
    showTab("risk");
    await turnOnHome(FLOOD);
    const item = homeItem("risk", FLOOD.label);
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    const lengthBefore = history.length;

    const tabs = item.querySelectorAll(".widget-sub-tab");
    tabs[1].click();
    await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenLastCalledWith("MX-F100"));
    tabs[2].click();
    expect(tabs[2].classList.contains("is-active")).toBe(true);
    slowAdd.resolve();

    await vi.waitFor(() => expect(location.hash).toBe("#risk?layers=flood:2"));
    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("idle"));
    await tick();
    const shown = [...item.querySelectorAll(".widget-sub-tab")].map((tab) =>
      tab.classList.contains("is-active"),
    );
    expect(shown).toEqual([false, false, true]);
    expect(getLayersStore().get("flood")).toMatchObject({
      viewId: "MX-F500",
      sourceIdx: 2,
      appliedSourceIdx: 2,
    });
    expect(store.openViews).toEqual(new Set(["MX-F500"]));
    expect(mocks.addLegend).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "MX-F500" }),
      item.querySelector(".layer-legend-slot"),
    );
    // 100y reached the map while 500y was already picked: its entry is
    // replaced by 500y's, so the quick picks are one entry, as on main.
    expect(history.length).toBe(lengthBefore + 1);
  });

  it("shows the kept source in the widget when a switch fails", async () => {
    showTab("risk");
    await turnOnHome(FLOOD);
    const item = homeItem("risk", FLOOD.label);
    mocks.viewAdd.mockRejectedValueOnce(new Error("offline"));

    item.querySelectorAll(".widget-sub-tab")[1].click();

    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("error"));
    await vi.waitFor(() =>
      expect(item.querySelectorAll(".widget-sub-tab")[0].classList.contains("is-active")).toBe(true),
    );
    expect(item.querySelectorAll(".widget-sub-tab")[1].classList.contains("is-active")).toBe(false);
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: "MX-F10", sourceIdx: 0 });
    expect(location.hash).toBe("#risk?layers=flood");
  });

  it("keeps a row collapsed when back/forward asks for the layer its header is loading", async () => {
    // The header started the activation and the user collapsed the row; a
    // history entry asking for the same layer is not a new activation, so it
    // does not reopen the row (ARCHITECTURE.md, "Expand rules").
    showTab("risk");
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    const item = homeItem("risk", RECOVERY.label);
    const header = item.querySelector(".layer-header");
    header.click();
    await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenCalledWith("MX-REC"));
    header.click();
    expect(header.getAttribute("aria-expanded")).toBe("false");

    history.pushState(null, "", "#risk?layers=recovery");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await tick();
    slowAdd.resolve();

    await vi.waitFor(() =>
      expect(getLayersStore().get("recovery")).toMatchObject({ applied: true, status: "idle" }),
    );
    await tick();
    expect(mocks.viewAdd).toHaveBeenCalledTimes(1);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(item.querySelector(".layer-body").style.display).toBe("none");
    expect(item.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("true");
    expect(location.hash).toBe("#risk?layers=recovery");
  });

  it("updates the source widget on back/forward", async () => {
    showTab("risk");
    await turnOnHome(FLOOD);
    const item = homeItem("risk", FLOOD.label);

    history.pushState(null, "", "#risk?layers=flood:2");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    await vi.waitFor(() => expect(getLayersStore().get("flood").appliedSourceIdx).toBe(2));
    await vi.waitFor(() =>
      expect(item.querySelectorAll(".widget-sub-tab")[2].classList.contains("is-active")).toBe(true),
    );
  });

  describe("hashes that are not app state", () => {
    beforeEach(async () => {
      await turnOn(RECOVERY);
      await turnOn(POP);
    });

    function navigateTo(hash) {
      history.pushState(null, "", hash);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }

    it("keeps layers for a bare info tab hash and rewrites it in place", async () => {
      const lengthBefore = history.length;
      navigateTo("#sources");
      await tick();

      expect(store.activeTab).toBe("sources");
      expect(store.openViews).toEqual(new Set(["MX-REC", "MX-POP"]));
      expect(location.hash).toBe("#sources?layers=recovery,pop");
      expect(history.length).toBe(lengthBefore + 1);
      expect(mocks.viewRemove).not.toHaveBeenCalled();
    });

    it("ignores in-page anchors and unknown ids", async () => {
      for (const hash of ["#mg-tabs__section-sources-1", "#not-a-tab?layers=ews", "#"]) {
        navigateTo(hash);
        await tick();
        expect(store.activeTab).toBe("resilience");
        expect(store.openViews).toEqual(new Set(["MX-REC", "MX-POP"]));
      }
      expect(mocks.viewRemove).not.toHaveBeenCalled();
      expect(mocks.viewAdd).toHaveBeenCalledTimes(2);
    });

    it("opens Sources from a layer's citation link without touching layers", async () => {
      const lengthBefore = history.length;
      homeItem("risk", "Recovery Speed").querySelector(".layer-meta-links a[href='#sources']").click();
      await tick();

      expect(store.activeTab).toBe("sources");
      expect(location.hash).toBe("#sources?layers=recovery,pop");
      expect(history.length).toBe(lengthBefore + 1);
      expectLayerState({ ...RECOVERY, on: true });
    });

    it("still reconciles a data tab hash without layers", async () => {
      navigateTo("#exposure");

      await vi.waitFor(() => expect(store.openViews.size).toBe(0));
      expect(store.activeTab).toBe("exposure");
      expect(location.hash).toBe("#exposure");
    });
  });
});

// Step 1 of the layer state refactor: the layers store is written alongside
// the existing state, so its records must agree with what the UI shows.
describe("layers store", () => {
  beforeEach(() => {
    window.location.hash = "";
    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    store.openViews.clear();
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.viewAdd.mockResolvedValue(undefined);
    mocks.viewRemove.mockResolvedValue(undefined);
    mocks.addOpacitySlider.mockImplementation(asyncRender("opacity-row"));
    mocks.addLegend.mockImplementation(asyncRender("html-legend"));
    mockExternalRegistry();
    buildSidebar();
    showTab("resilience");
  });

  /** Hash entries as `key` or `key:idx`, as written. */
  function hashSegments() {
    const layers = new URLSearchParams(location.hash.split("?")[1] ?? "").get("layers");
    return layers ? layers.split(",") : [];
  }

  /** Every layer's record agrees with its switches, openViews and the hash. */
  function expectStoreMatchesUi() {
    const layersStore = getLayersStore();
    for (const layer of [RECOVERY, FLOOD, POP]) {
      const record = layersStore.get(layer.key);
      const on = String(record.applied);
      expect(
        homeItem(layer.homeTab, layer.label).querySelector(".layer-eye").getAttribute("aria-checked"),
      ).toBe(on);
      expect(
        crossRow("resilience", layer.label).querySelector(".layer-eye").getAttribute("aria-checked"),
      ).toBe(on);
      expect(hashLayerKeys().includes(layer.key)).toBe(record.applied);
      expect(record.status).toBe("idle");
      if (record.applied) {
        expect(record.desired).toBe(true);
        expect(layer.viewIds).toContain(record.viewId);
        expect(store.openViews.has(record.viewId)).toBe(true);
      } else {
        expect(record.viewId).toBeNull();
        expect(layer.viewIds.some((id) => store.openViews.has(id))).toBe(false);
      }
    }
    expect(new Set(layersStore.openViewIds())).toEqual(store.openViews);
  }

  it("matches the UI after toggling on and off", async () => {
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    crossRow("resilience", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery", "flood"]));
    expectStoreMatchesUi();
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: "MX-F10", sourceIdx: 0 });

    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));
    expectStoreMatchesUi();
  });

  it("matches the UI after a source switch", async () => {
    showTab("risk");
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));
    const lengthBefore = history.length;

    homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();

    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood:1"]));
    await tick();
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: "MX-F100", sourceIdx: 1 });
    // One entry for the switch; the transient gap between views writes nothing.
    expect(history.length).toBe(lengthBefore + 1);
    showTab("resilience");
    expectStoreMatchesUi();
  });

  it("puts a layer back in the hash when its view returns after another layer wrote the hash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    showTab("risk");
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));

    // The new source is slow and then fails; the old one is put back.
    const slowAdd = deferred();
    mocks.viewAdd.mockImplementation((id) => (id === "MX-F100" ? slowAdd.promise : Promise.resolve()));
    homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();
    await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenCalledWith("MX-F100"));
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: null });

    // Another toggle during the switch rewrites the hash without Flood, which
    // has no view on the map at that moment.
    homeItem("risk", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery"]));

    // The rollback re-adds MX-F10: nothing but the view changed, and the hash
    // lists Flood again.
    slowAdd.resolve(Promise.reject(new Error("offline")));
    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("error"));
    await tick();
    warn.mockRestore();
    expect(getLayersStore().get("flood")).toMatchObject({
      applied: true,
      viewId: "MX-F10",
      appliedSourceIdx: 0,
    });
    expect(hashSegments()).toEqual(["recovery", "flood"]);
  });

  describe("one history entry per user action", () => {
    beforeEach(async () => {
      // Let beforeEach's queued hashchange settle before counting entries.
      await tick();
    });

    it("pushes one entry for a single toggle", async () => {
      const lengthBefore = history.length;
      crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("recovery").status).toBe("idle"));

      expect(location.hash).toBe("#resilience?layers=recovery");
      expect(history.length).toBe(lengthBefore + 1);
    });

    it("pushes one entry for a single source switch", async () => {
      showTab("risk");
      await turnOnHomeFlood();
      const lengthBefore = history.length;

      homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();
      await vi.waitFor(() => expect(getLayersStore().get("flood").appliedSourceIdx).toBe(1));
      await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("idle"));

      expect(location.hash).toBe("#risk?layers=flood:1");
      expect(history.length).toBe(lengthBefore + 1);
    });

    it("ends a double-click where it started, with one entry that Back cannot turn the layer on from", async () => {
      const lengthBefore = history.length;
      const hashBefore = location.hash;
      const eye = crossRow("resilience", RECOVERY.label).querySelector(".layer-eye");

      eye.click();
      eye.click();
      await vi.waitFor(() => expect(mocks.viewRemove).toHaveBeenCalledWith("MX-REC"));
      await vi.waitFor(() => expect(getLayersStore().get("recovery").status).toBe("idle"));

      // The add reached the map and pushed an entry listing the layer; the
      // removal replaced it. One entry, holding the pre-click state.
      expect(location.hash).toBe(hashBefore);
      expect(history.length).toBe(lengthBefore + 1);

      history.back();
      await tick();
      await tick();
      expect(location.hash).toBe(hashBefore);
      expect(getLayersStore().get("recovery")).toMatchObject({ desired: false, applied: false });
    });

    it("pushes one entry for quick A→B→C source picks where B reaches the map first", async () => {
      showTab("risk");
      await turnOnHomeFlood();
      const item = homeItem("risk", FLOOD.label);
      const slowAdd = deferred();
      mocks.viewAdd.mockImplementation((id) => (id === "MX-F100" ? slowAdd.promise : Promise.resolve()));
      const lengthBefore = history.length;

      item.querySelectorAll(".widget-sub-tab")[1].click();
      await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenLastCalledWith("MX-F100"));
      item.querySelectorAll(".widget-sub-tab")[2].click();
      slowAdd.resolve();
      await vi.waitFor(() => expect(getLayersStore().get("flood").appliedSourceIdx).toBe(2));
      await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("idle"));

      expect(location.hash).toBe("#risk?layers=flood:2");
      expect(history.length).toBe(lengthBefore + 1);
    });

    it("pushes a new entry for the next action after a double-click", async () => {
      const eye = crossRow("resilience", RECOVERY.label).querySelector(".layer-eye");
      eye.click();
      eye.click();
      await vi.waitFor(() => expect(mocks.viewRemove).toHaveBeenCalledWith("MX-REC"));
      await vi.waitFor(() => expect(getLayersStore().get("recovery").status).toBe("idle"));
      const lengthBefore = history.length;

      eye.click();
      await vi.waitFor(() => expect(getLayersStore().get("recovery").applied).toBe(true));

      expect(location.hash).toBe("#resilience?layers=recovery");
      expect(history.length).toBe(lengthBefore + 1);
    });

    async function turnOnHomeFlood() {
      homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("flood").applied).toBe(true));
      await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("idle"));
    }
  });

  describe("accessibility while loading", () => {
    const announcerText = (row) => row.querySelector(".layer-announcer").textContent;

    it("marks the switch busy while loading and announces a failed load in the rows", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const slowAdd = deferred();
      mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
      const row = crossRow("resilience", POP.label);
      const eye = row.querySelector(".layer-eye");

      eye.click();

      expect(eye.getAttribute("aria-checked")).toBe("true");
      expect(eye.getAttribute("aria-busy")).toBe("true");
      expect(eye.getAttribute("aria-label")).toBe("Loading Population…");
      const home = homeItem("exposure", POP.label);
      expect(home.querySelector(".layer-eye").getAttribute("aria-busy")).toBe("true");

      slowAdd.resolve(Promise.reject(new Error("offline")));
      await vi.waitFor(() => expect(getLayersStore().get("pop").status).toBe("error"));
      warn.mockRestore();

      expect(eye.getAttribute("aria-checked")).toBe("false");
      expect(eye.getAttribute("aria-busy")).toBe("false");
      expect(eye.getAttribute("aria-label")).toBe("Turn on Population");
      expect(announcerText(row)).toBe("Could not load Population. It is off.");
      expect(announcerText(home)).toBe("Could not load Population. It is off.");
      const announcer = row.querySelector(".layer-announcer");
      expect(announcer.getAttribute("aria-live")).toBe("polite");
      expect(announcer.classList.contains("mg-u-sr-only")).toBe(true);
      expect(announcer.id).toBe("");

      // The next attempt clears the message; success leaves it empty.
      eye.click();
      expect(announcerText(row)).toBe("");
      await vi.waitFor(() => expect(getLayersStore().get("pop").applied).toBe(true));
      expect(announcerText(row)).toBe("");
      expect(eye.getAttribute("aria-label")).toBe("Turn off Population");
    });

    it("announces a failed turn-off", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const row = crossRow("resilience", RECOVERY.label);
      row.querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("recovery").applied).toBe(true));
      mocks.viewRemove.mockRejectedValueOnce(new Error("postMessage timeout"));

      row.querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("recovery").status).toBe("error"));
      warn.mockRestore();

      expect(announcerText(row)).toBe("Could not change Recovery Speed. It is still on as before.");
      expect(row.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("true");
    });

    it("announces a failed external layer load", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.openExternalLayer.mockRejectedValueOnce(new Error("offline"));
      const row = crossRow("resilience", "Crops");

      row.querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("crops").status).toBe("error"));
      warn.mockRestore();

      expect(announcerText(row)).toBe("Could not load Crops. It is off.");
    });
  });

  it("never reports zero layers while one is on, even mid source switch", async () => {
    const counts = [];
    onViewsChanged((count) => counts.push(count));
    try {
      showTab("risk");
      homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("flood").applied).toBe(true));

      const slowAdd = deferred();
      mocks.viewAdd.mockImplementation((id) => (id === "MX-F100" ? slowAdd.promise : Promise.resolve()));
      homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();
      // Flood is in the gap between its views: on, but with no view in openViews.
      await vi.waitFor(() =>
        expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: null }),
      );
      expect(store.openViews.size).toBe(0);

      homeItem("risk", RECOVERY.label).querySelector(".layer-eye").click();
      await vi.waitFor(() => expect(getLayersStore().get("recovery").applied).toBe(true));
      slowAdd.resolve();
      await vi.waitFor(() => expect(getLayersStore().get("flood").viewId).toBe("MX-F100"));

      expect(counts).toEqual([1, 2]);
    } finally {
      onViewsChanged(null);
    }
  });

  it("ends off after a double switch failure, and can be turned on again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    showTab("risk");
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));

    // The new source and the rollback to the old one both fail: nothing of the
    // layer is on the map, so it is recorded as off, never on without a view.
    mocks.viewAdd.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();
    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("error"));
    await tick();
    expect(getLayersStore().get("flood")).toMatchObject({
      desired: false,
      applied: false,
      viewId: null,
      sourceIdx: 0,
    });
    expect(hashSegments()).toEqual([]);
    const home = homeItem("risk", FLOOD.label);
    expect(home.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("false");

    // Turning it on again adds the kept source and lists it in the hash.
    home.querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.has("MX-F10")).toBe(true));
    await tick();
    warn.mockRestore();
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, status: "idle", error: null });
    expect(hashSegments()).toEqual(["flood"]);
  });

  it("finishes updating the UI when the hash write throws", async () => {
    // Let beforeEach's queued hashchange run first: with the write failing, the
    // hash would not list the layer, and a late reconcile would turn it off.
    await tick();
    // Browsers throw SecurityError from pushState when history calls are rate-limited.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pushState = vi.spyOn(history, "pushState").mockImplementationOnce(() => {
      throw new DOMException("Too many calls", "SecurityError");
    });
    const row = crossRow("resilience", RECOVERY.label);

    row.querySelector(".layer-eye").click();

    await vi.waitFor(() => expect(row.querySelector(".layer-legend-slot .html-legend")).not.toBeNull());
    pushState.mockRestore();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(getLayersStore().get("recovery")).toMatchObject({ applied: true, viewId: "MX-REC" });
    expect(store.openViews.has("MX-REC")).toBe(true);
    expect(row.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("true");
    const home = homeItem("risk", RECOVERY.label);
    expect(home.querySelector(".layer-eye").getAttribute("aria-checked")).toBe("true");
    expect(home.classList.contains("layer-active")).toBe(true);
    // The home row's legend renders once its tab is shown.
    showTab("risk");
    await vi.waitFor(() => expect(home.querySelector(".layer-legend-slot .html-legend")).not.toBeNull());
    expect(document.getElementById("layer-clear-btn").hidden).toBe(false);
  });

  it("records a failed turn-off as an error, resets intent, and clears it on the next success", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery"]));
    const failure = new Error("postMessage timeout");
    mocks.viewRemove.mockRejectedValueOnce(failure);

    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();

    await vi.waitFor(() => expect(getLayersStore().get("recovery").status).toBe("error"));
    expect(getLayersStore().get("recovery")).toMatchObject({
      desired: true,
      applied: true,
      viewId: "MX-REC",
      error: failure,
    });

    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual([]));
    warn.mockRestore();
    expect(getLayersStore().get("recovery")).toMatchObject({
      desired: false,
      applied: false,
      status: "idle",
      error: null,
    });
  });

  it("records a failed source switch as an error and keeps the previous source", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    showTab("risk");
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));
    const failure = new Error("offline");
    mocks.viewAdd.mockRejectedValueOnce(failure);

    homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();

    await vi.waitFor(() => expect(getLayersStore().get("flood").status).toBe("error"));
    warn.mockRestore();
    expect(getLayersStore().get("flood")).toMatchObject({
      desired: true,
      applied: true,
      viewId: "MX-F10",
      sourceIdx: 0,
      error: failure,
    });
    expect(hashSegments()).toEqual(["flood"]);
  });

  it("records a failed external variant change as an error", async () => {
    mocks.openExternalLayer.mockImplementation(async (layer) => {
      const runtime = { idView: "MX-GJ-1", settings: { crop: "WHEAT" } };
      externalRuntimes.set(layer.key, runtime);
      return runtime;
    });
    const failure = new Error("provider down");
    mocks.replaceExternalLayer.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    showTab("risk");
    const crops = homeItem("risk", "Crops");
    crops.querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(getLayersStore().get("crops").applied).toBe(true));

    const select = crops.querySelector("select[data-external-control='crop']");
    select.value = "MAIZE";
    select.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(getLayersStore().get("crops").status).toBe("error"));
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    warn.mockRestore();
    expect(getLayersStore().get("crops")).toMatchObject({
      desired: true,
      applied: true,
      viewId: "MX-GJ-1",
      // Intent is reset to the settings of the view the registry still has.
      settings: { crop: "WHEAT" },
      appliedSettings: { crop: "WHEAT" },
      error: failure,
    });
    expect(select.value).toBe("WHEAT");
    // The controls announce their own error; the row does not repeat it.
    expect(crops.querySelector(".layer-announcer").textContent).toBe("");
  });

  it("records a failed load as an error and leaves the layer off", async () => {
    const failure = new Error("offline");
    mocks.viewAdd.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    crossRow("resilience", POP.label).querySelector(".layer-eye").click();

    await vi.waitFor(() => expect(getLayersStore().get("pop").status).toBe("error"));
    warn.mockRestore();
    expect(getLayersStore().get("pop")).toMatchObject({ desired: false, applied: false, error: failure });
    expect(location.hash).toBe("#resilience");
  });

  it("matches the UI after clear-all", async () => {
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    crossRow("resilience", POP.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery", "pop"]));

    document.getElementById("layer-clear-btn").click();

    await vi.waitFor(() => expect(location.hash).toBe("#resilience"));
    expectStoreMatchesUi();
    expect(getLayersStore().openViewIds()).toEqual([]);
  });

  it("matches the UI after restoring a shared link", async () => {
    history.replaceState(null, "", "#resilience?layers=flood:1,pop");

    await restoreLayersFromHash();

    expect(location.hash).toBe("#resilience?layers=flood:1,pop");
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: "MX-F100", sourceIdx: 1 });
    expectStoreMatchesUi();
  });

  it("matches the UI after back/forward", async () => {
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery"]));

    // Forward to an entry with other layers, then back to the first one.
    history.pushState(null, "", "#exposure?layers=flood:1,pop");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => expect(getLayersStore().openViewIds().sort()).toEqual(["MX-F100", "MX-POP"]));
    await tick();
    expect(location.hash).toBe("#exposure?layers=flood:1,pop");
    expectStoreMatchesUi();

    history.pushState(null, "", "#resilience?layers=recovery");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await vi.waitFor(() => expect(getLayersStore().openViewIds()).toEqual(["MX-REC"]));
    await tick();
    expect(location.hash).toBe("#resilience?layers=recovery");
    expectStoreMatchesUi();
  });

  it("stops following the hash once destroyed", async () => {
    destroySidebar();
    history.pushState(null, "", "#exposure?layers=pop");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await tick();

    expect(mocks.viewAdd).not.toHaveBeenCalled();
    expect(store.activeTab).toBe("resilience");
  });

  it("ignores switch clicks after destroy instead of recreating state", async () => {
    await tick();
    const lengthBefore = history.length;
    destroySidebar();
    expect(getLayersStore()).toBeNull();

    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await tick();

    expect(mocks.viewAdd).not.toHaveBeenCalled();
    expect(getLayersStore()).toBeNull();
    expect(store.openViews.size).toBe(0);
    expect(history.length).toBe(lengthBefore);
  });

  it("drops a MapX response that settles after destroy", async () => {
    await tick();
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    const eye = crossRow("resilience", RECOVERY.label).querySelector(".layer-eye");
    eye.click();
    const orphan = getLayersStore();
    expect(orphan.get("recovery").status).toBe("loading");

    destroySidebar();
    slowAdd.resolve();
    for (let i = 0; i < 3; i++) await tick();

    // Nothing is written into the destroyed store, openViews, the URL or the
    // row. The switch keeps showing the intent from the click; no controls are built.
    expect(orphan.get("recovery")).toMatchObject({ desired: true, applied: false, status: "loading" });
    expect(store.openViews.size).toBe(0);
    expect(location.hash).toBe("#resilience");
    expect(eye.getAttribute("aria-checked")).toBe("true");
    expect(mocks.addLegend).not.toHaveBeenCalled();
  });

  it("drops a MapX response that settles after a rebuild", async () => {
    await tick();
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    const orphan = getLayersStore();

    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    buildSidebar();
    showTab("resilience");
    await tick();
    const hashBefore = location.hash;
    slowAdd.resolve();
    for (let i = 0; i < 3; i++) await tick();

    // Neither the old nor the new store, openViews, the URL or the new rows see it.
    expect(orphan.get("recovery").applied).toBe(false);
    expect(getLayersStore()).not.toBe(orphan);
    expect(getLayersStore().all()).toEqual([]);
    expect(store.openViews.size).toBe(0);
    expect(location.hash).toBe(hashBefore);
    expect(
      crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("clears openViews left by a previous build", async () => {
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.has("MX-REC")).toBe(true));

    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    buildSidebar();

    expect(store.openViews.size).toBe(0);
    expect(getLayersStore().openViewIds()).toEqual([]);
  });

  it("leaves an injected adapter to its owner on destroy", () => {
    const unsubscribe = vi.fn();
    const adapter = {
      read: () => ({ tab: "exposure", layers: [] }),
      write: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
      destroy: vi.fn(),
    };
    buildSidebar({ stateAdapter: adapter });

    destroySidebar();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(getLayersStore()).toBeNull();
  });

  it("does not restore from the URL when no sidebar is built", async () => {
    destroySidebar();
    history.replaceState(null, "", "#exposure?layers=pop");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreLayersFromHash();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(mocks.viewAdd).not.toHaveBeenCalled();
    expect(getLayersStore()).toBeNull();
  });
});
