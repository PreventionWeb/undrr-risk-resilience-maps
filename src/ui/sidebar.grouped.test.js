import { beforeEach, describe, expect, it, vi } from "vitest";

// A tab whose sidebar groups (R2R categories) list its layers in a different
// order from `tab.layers`. The hash must follow `tab.layers` (config order),
// as it always has, not the order the rows appear in.
vi.mock("../config/layers.js", () => {
  const econ = { key: "econ", id: "MX-ECON", label: "Economy", type: "vt", r2rCategory: "Economy" };
  const soc = { key: "soc", id: "MX-SOC", label: "Societies", type: "vt", r2rCategory: "Societies" };
  return {
    TABS: [
      {
        id: "risk",
        label: "Risk",
        description: "Risk layers",
        layers: [econ, soc],
        groups: [
          { id: "societies", label: "Societies", layers: [soc] },
          { id: "economy", label: "Economy", layers: [econ] },
        ],
      },
    ],
  };
});
vi.mock("../sdk/views.js", () => ({ viewAdd: vi.fn(async () => {}), viewRemove: vi.fn(async () => {}) }));
vi.mock("../sdk/client.js", () => ({ isSDKReady: () => true }));
vi.mock("./layer-controls.js", () => ({ addOpacitySlider: vi.fn(), addLegend: vi.fn() }));
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
  isExternalLayer: () => false,
  openExternalLayer: vi.fn(),
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
  getExternalLayerDefinition: () => ({}),
  getExternalLayerRuntime: () => null,
}));

import { buildSidebar, restoreLayersFromHash } from "./sidebar.js";
import * as store from "../state/store.js";

function eye(label) {
  return [...document.querySelectorAll("#tab-risk .layer-item")]
    .find((item) => item.querySelector(".layer-label").textContent === label)
    .querySelector(".layer-eye");
}

describe("hash order for a grouped tab", () => {
  beforeEach(() => {
    history.replaceState(null, "", "#risk");
    document.body.innerHTML = `
      <div id="sidebar"><div class="layer-panel-header"></div><div id="panel-body"></div></div>
      <button id="panel-toggle"></button>
      <button id="layer-clear-btn" hidden></button>
      <div id="app-map"></div>
      <div id="info-page"></div>`;
    store.openViews.clear();
    buildSidebar();
  });

  it("lists layers in config order, not sidebar group order", async () => {
    // Groups show Societies first, so the rows are in the opposite order.
    const labels = [...document.querySelectorAll("#tab-risk .layer-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Societies", "Economy"]);

    eye("Economy").click();
    await vi.waitFor(() => expect(location.hash).toBe("#risk?layers=econ"));
    eye("Societies").click();

    await vi.waitFor(() => expect(location.hash).toBe("#risk?layers=econ,soc"));
  });

  it("restores a config-order link without rewriting it", async () => {
    history.replaceState(null, "", "#risk?layers=econ,soc");
    const lengthBefore = history.length;

    await restoreLayersFromHash();

    expect(store.openViews).toEqual(new Set(["MX-ECON", "MX-SOC"]));
    expect(location.hash).toBe("#risk?layers=econ,soc");
    expect(history.length).toBe(lengthBefore);
  });
});
