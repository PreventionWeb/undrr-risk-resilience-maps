import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle, waitFor } from "../../tests/support/async.js";

// The order the sidebar's store subscribers run in, which the store guarantees
// by running them in subscription order:
//
//   1. `store.openViews` is mirrored,
//   2. `onViewsChanged` reports the new count,
//   3. the router writes the URL,
//   4. the rows render the switch, the slider and the legend.
//
// Nothing in the app reads the URL back from the rows, so a swap of 3 and 4
// looks harmless in every other test; a shared link written from a half-rendered
// state would not be. The invariant is asserted here by recording what the page
// looked like at the moment of each URL write.

const mocks = vi.hoisted(() => ({
  viewAdd: vi.fn(),
  viewRemove: vi.fn(),
  addOpacitySlider: vi.fn(),
  addLegend: vi.fn(),
}));

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "exposure",
      label: "Exposure",
      description: "Exposure layers",
      layers: [{ key: "pop", id: "MX-POP", label: "Population", type: "vt", desc: "Pop." }],
    },
  ],
}));
vi.mock("../sdk/views.js", () => ({ viewAdd: mocks.viewAdd, viewRemove: mocks.viewRemove }));
vi.mock("../sdk/client.js", () => ({ isSDKReady: () => true, onSDKReadyChange: () => () => {} }));
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
  isExternalLayer: () => false,
  openExternalLayer: vi.fn(),
  closeExternalLayer: vi.fn(),
  replaceExternalLayer: vi.fn(),
  getExternalLayerDefinition: () => ({}),
  getExternalLayerRuntime: () => null,
}));

import { createSidebar } from "./sidebar.js";
import * as store from "../state/store.js";

const SHELL = `
  <div id="sidebar" data-ui="layer-panel">
    <div class="layer-panel-header"></div>
    <div id="panel-body" data-ui="panel-body"></div>
  </div>
  <div id="app-map" data-ui="app-map"></div>
  <div id="info-page" data-ui="info-page"></div>`;

let sidebar = null;
/** What the page looked like at each URL write, newest last. */
let atWrite = [];

/** Population's row and its switch. */
const row = () => document.querySelector('[data-tab-panel="exposure"] .layer-item');

/**
 * URL state in memory, recording the state of the page at each write: the
 * mirrored view ids and how much of the row has been rendered.
 */
function recordingAdapter() {
  let state = { tab: null, layers: [] };
  return {
    read: () => state,
    write: (next) => {
      state = { tab: next.tab, layers: next.layers };
      atWrite.push({
        keys: next.layers.map((layer) => layer.key),
        openViews: [...store.openViews],
        legends: mocks.addLegend.mock.calls.length,
        sliders: mocks.addOpacitySlider.mock.calls.length,
        // The row marks itself active when the view arrives and unmarks it when
        // the view goes, both from the record it is handed.
        rowActive: Boolean(
          document
            .querySelector('[data-tab-panel="exposure"] .layer-item')
            ?.classList.contains("layer-active"),
        ),
      });
    },
    subscribe: () => () => {},
    destroy: () => {},
  };
}

describe("sidebar subscriber order", () => {
  beforeEach(() => {
    // replaceState, not `location.hash = ""`: assigning the hash makes jsdom
    // queue a `hashchange` task that can land inside a later test.
    history.replaceState(null, "", "#");
    document.body.innerHTML = SHELL;
    store.openViews.clear();
    atWrite = [];
    mocks.viewAdd.mockReset().mockResolvedValue(undefined);
    mocks.viewRemove.mockReset().mockResolvedValue(undefined);
    mocks.addLegend.mockClear();
    mocks.addOpacitySlider.mockClear();
    sidebar?.destroy();
    sidebar = createSidebar(document.body, { stateAdapter: recordingAdapter() });
    sidebar.showTab("exposure");
  });

  // Teardown belongs to the test that started the work: destroy the instance
  // and let its in-flight SDK replies settle here, not inside the next test.
  afterEach(async () => {
    sidebar?.destroy();
    sidebar = null;
    await settle(() => [store.openViews.size, atWrite.length]);
  });

  it("writes the URL after openViews and before the rows render", async () => {
    row().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));
    // The row did render its slider and legend, just not before the URL write.
    await waitFor(() => expect(mocks.addLegend).toHaveBeenCalled());

    const write = atWrite.findLast((entry) => entry.keys.includes("pop"));
    expect(write).toBeDefined();
    // 1. openViews is already current when the URL is written.
    expect(write.openViews).toEqual(["MX-POP"]);
    // 4. the rows have not rendered this view yet.
    expect(write.legends).toBe(0);
    expect(write.sliders).toBe(0);
    expect(write.rowActive).toBe(false);
    expect(row().classList.contains("layer-active")).toBe(true);
  });

  it("writes the URL after openViews and before the rows render when a layer goes off", async () => {
    row().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(true));
    await waitFor(() => expect(mocks.addLegend).toHaveBeenCalled());
    const legendsBefore = mocks.addLegend.mock.calls.length;
    atWrite = [];

    row().querySelector(".layer-eye").click();
    await waitFor(() => expect(sidebar.store.get("pop").applied).toBe(false));

    const write = atWrite.at(-1);
    expect(write.keys).toEqual([]);
    expect(write.openViews).toEqual([]);
    // The row's teardown of the view had not run either: it was still marked
    // active when the URL said the layer was off.
    expect(write.legends).toBe(legendsBefore);
    expect(write.rowActive).toBe(true);
    expect(row().classList.contains("layer-active")).toBe(false);
  });
});
