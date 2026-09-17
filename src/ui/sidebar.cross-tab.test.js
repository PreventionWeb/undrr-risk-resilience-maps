import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(),
  viewRemove: vi.fn(),
  addOpacitySlider: vi.fn(),
  addLegend: vi.fn(),
  openExternalLayer: vi.fn(),
}));

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
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
  getExternalLayerDefinition: () => ({}),
  getExternalLayerRuntime: () => null,
}));

import { buildSidebar, destroySidebar, getLayersStore, restoreLayersFromHash } from "./sidebar.js";
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

  it("renders cross-tab controls only in the visible tab", async () => {
    crossRow("resilience", "Recovery Speed").querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.has("MX-REC")).toBe(true));

    // Home accordion + the visible Resilience row; not the hidden Exposure row.
    expect(mocks.addLegend).toHaveBeenCalledTimes(2);
    expect(crossRow("exposure", "Recovery Speed").querySelector(".cross-tab-body").hidden).toBe(true);

    showTab("exposure");
    expect(mocks.addLegend).toHaveBeenCalledTimes(3);
    expect(crossRow("exposure", "Recovery Speed").querySelector(".cross-tab-body").hidden).toBe(false);

    // Rows keep their rendered controls while their tab is hidden, so switching
    // tabs does not re-request them.
    showTab("resilience");
    showTab("risk");
    showTab("exposure");
    expect(mocks.addLegend).toHaveBeenCalledTimes(3);
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
    await vi.waitFor(() => expect(floodEye.getAttribute("aria-checked")).toBe("false"));
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
    buildSidebar();
    showTab("resilience");
    return () => warn.mockRestore();
  });

  async function turnOn(layer) {
    crossRow("resilience", layer.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashLayerKeys()).toContain(layer.key));
  }

  describe("rapid double toggle", () => {
    it.each([
      ["simple", RECOVERY],
      ["compound", FLOOD],
    ])("leaves a %s layer in one consistent state", async (_kind, layer) => {
      const eye = crossRow("resilience", layer.label).querySelector(".layer-eye");
      eye.click();
      eye.click();

      await vi.waitFor(() => expect(hashLayerKeys()).toContain(layer.key));
      await tick();
      // The second click lands while the first is in flight and is ignored.
      expect(mocks.viewAdd).toHaveBeenCalledTimes(1);
      expect(mocks.viewRemove).not.toHaveBeenCalled();
      expectLayerState({ ...layer, on: true });
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

  // Known bug, left for the layer controller PR (unisdr/undrr-risk-resilience-maps#14):
  // clear-all only turns off layers whose switch is already active, so a layer
  // still loading survives and turns on afterwards. `it.fails` flips to a
  // failure once this is fixed; convert it to a plain `it` then.
  it.fails("turns off a layer that is still loading when Clear all is clicked", async () => {
    await turnOn(FLOOD);
    const slowAdd = deferred();
    mocks.viewAdd.mockReturnValueOnce(slowAdd.promise);
    crossRow("resilience", RECOVERY.label).querySelector(".layer-eye").click();
    expect(mocks.viewAdd).toHaveBeenLastCalledWith("MX-REC");

    document.getElementById("layer-clear-btn").click();
    slowAdd.resolve();
    for (let i = 0; i < 5; i++) await tick();

    expectLayerState({ ...FLOOD, on: false });
    expectLayerState({ ...RECOVERY, on: false });
  });

  // Known bug, left for the layer controller PR (unisdr/undrr-risk-resilience-maps#14):
  // an external layer's switch is disabled while it loads, so there is no way to
  // cancel it. This harness also stubs the external runtime registry, so the
  // case needs the controller's own tests.
  it.todo("turns off an external layer that is turned off while it is still loading");

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
    // activeSourceIndex outlives buildSidebar(); earlier tests leave Flood on 100y.
    store.setActiveSource("flood", 0);
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.viewAdd.mockResolvedValue(undefined);
    mocks.viewRemove.mockResolvedValue(undefined);
    mocks.addOpacitySlider.mockImplementation(asyncRender("opacity-row"));
    mocks.addLegend.mockImplementation(asyncRender("html-legend"));
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

  it("puts a layer back in the hash when it is re-enabled after a double switch failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    showTab("risk");
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["flood"]));

    // The new source and the rollback to the old one both fail: the layer
    // stays on with no view on the map.
    mocks.viewAdd.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline"));
    homeItem("risk", FLOOD.label).querySelectorAll(".widget-sub-tab")[1].click();
    await vi.waitFor(() => expect(mocks.viewAdd).toHaveBeenCalledTimes(3));
    await tick();
    expect(getLayersStore().get("flood")).toMatchObject({ applied: true, viewId: null });

    // Another toggle rewrites the hash without Flood, as it did on main.
    homeItem("risk", RECOVERY.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(hashSegments()).toEqual(["recovery"]));

    // Re-enabling Flood adds its view again, so the hash lists it again.
    homeItem("risk", FLOOD.label).querySelector(".layer-eye").click();
    await vi.waitFor(() => expect(store.openViews.has("MX-F10")).toBe(true));
    await tick();
    warn.mockRestore();
    expect(hashSegments()).toEqual(["recovery", "flood"]);
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
});
