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

import { buildSidebar, restoreLayersFromHash } from "./sidebar.js";
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
