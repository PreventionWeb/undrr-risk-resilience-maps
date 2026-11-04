import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "../../tests/support/async.js";

const mocks = vi.hoisted(() => {
  const calls = [];
  const table = [
    { j0_value: 2.5, iso3cd: "CCB", maplab: "Region B", gid: 2 },
    { j0_value: null, iso3cd: "CCC", maplab: "Region C", gid: 3 },
    { j0_value: 1, iso3cd: "CCA", maplab: "Region A", gid: 1 },
    { j0_value: 9, iso3cd: "xQZ", maplab: "Placeholder", gid: 4 },
  ];
  const sdk = {
    ask: vi.fn(async (method, params) => {
      calls.push([method, params]);
      return method === "get_view_table_attribute" ? table : true;
    }),
  };
  return {
    calls,
    sdk,
    viewAdd: vi.fn(async () => true),
    viewRemove: vi.fn(async () => true),
    sources: [],
  };
});

const layers = vi.hoisted(() => ({
  vector: {
    id: "MX-VEC-1",
    key: "vector-layer",
    label: "Vector Layer",
    type: "vt",
    geometry: "point",
    desc: "Values per region.",
    citation: "Provider (2026).",
    license: "CC BY 4.0",
    r2rCategory: "GAR2026",
  },
  raster: {
    id: "MX-RAS-1",
    key: "raster-layer",
    label: "Raster Layer",
    type: "rt",
    desc: "A grid.",
    downloads: [["https://gar-data.unepgrid.ch/2026/big_grid.tif", 1_500_000_000]],
  },
  live: {
    id: "MX-LIVE-1",
    key: "live-layer",
    label: "Live Layer",
    type: "cc",
    desc: "Custom code.",
    r2rCategory: "GAR2026",
  },
}));

vi.mock("../config/layers.js", () => ({
  TABS: [{ id: "test", label: "Test", layers: [layers.vector, layers.raster, layers.live] }],
}));
vi.mock("../config/registry.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { TABS } = await import("../config/layers.js");
  const registry = actual.createLayerRegistry(TABS);
  return { ...actual, getLayerRegistry: () => registry };
});
vi.mock("../sdk/views.js", () => ({ viewAdd: mocks.viewAdd, viewRemove: mocks.viewRemove }));
vi.mock("../sdk/client.js", () => ({
  isSDKReady: () => true,
  onSDKReadyChange: () => () => {},
  getSDK: () => mocks.sdk,
}));
vi.mock("./home.js", () => ({ buildHomePanel: () => document.createElement("div") }));
vi.mock("./info-panels.js", () => ({
  buildSourcesPanel: (options) => {
    mocks.sources.push(options);
    return document.createElement("div");
  },
  buildAboutPanel: () => document.createElement("div"),
}));
vi.mock("./mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
vi.mock("./layer-controls.js", () => ({ addOpacitySlider: vi.fn(), addLegend: vi.fn() }));

import { CSV_VIEWS } from "../config/downloads.js";
import { createSidebar } from "./sidebar.js";

// The test's vector layer is a reviewed CSV view.
CSV_VIEWS.add("MX-VEC-1");

describe("sidebar downloads (prototype, ?downloads=1)", () => {
  let sidebar;
  let blobs;

  function build(options = {}) {
    document.body.innerHTML = `
      <nav data-ui="nav"></nav>
      <div data-ui="info-page"></div>
      <div data-ui="app-map"><div data-ui="mapx"></div></div>
      <div data-ui="layer-panel"><div class="layer-panel-header"></div><div data-ui="panel-body"></div></div>
      <button data-ui="clear-layers" hidden></button>`;
    sidebar = createSidebar(document.body, options);
  }

  const homeRow = (layer) =>
    [...document.querySelectorAll(".tab-panel .layer-item")].find(
      (row) => row.querySelector(".layer-label").textContent === layer.label,
    );

  beforeEach(() => {
    history.replaceState(null, "", "#");
    mocks.calls.length = 0;
    mocks.sources.length = 0;
    blobs = [];
    URL.createObjectURL = vi.fn((blob) => {
      blobs.push(blob);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    sidebar?.destroy();
    sidebar = null;
  });

  it("changes nothing without the flag", () => {
    build();
    expect(document.querySelector(".layer-downloads-slot")).toBeNull();
    expect(document.querySelector(".layer-downloads")).toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
    expect(mocks.sources.at(-1).downloads).toBeNull();
    // The request link is still the route for the GAR2026 vector layer.
    expect(homeRow(layers.vector).querySelector('a[href^="mailto:"]')).not.toBeNull();
  });

  it("shows a GeoTIFF link with format, size and a large-file warning", () => {
    build({ downloadsEnabled: true });
    const link = homeRow(layers.raster).querySelector("a.layer-downloads__link");
    expect(link.href).toBe("https://gar-data.unepgrid.ch/2026/big_grid.tif");
    expect(link.getAttribute("download")).toBe("big_grid.tif");
    expect(link.textContent).toContain("Download big_grid.tif");
    expect(link.textContent).toContain("(GeoTIFF, 1.5 GB)");
    expect(homeRow(layers.raster).querySelector(".layer-downloads__warning").textContent).toContain(
      "Over 1 GB: a fast, unmetered connection is recommended.",
    );
    expect(homeRow(layers.raster).querySelector("[data-action='download-csv']")).toBeNull();
  });

  it("offers Download CSV for a vector layer in place of Request data, and keeps the request elsewhere", () => {
    build({ downloadsEnabled: true });
    const vectorRow = homeRow(layers.vector);
    expect(vectorRow.querySelector("[data-action='download-csv']").textContent).toContain("Download CSV");
    expect(vectorRow.querySelector('a[href^="mailto:"]')).toBeNull();
    const liveRow = homeRow(layers.live);
    expect(liveRow.querySelector(".layer-downloads")).toBeNull();
    expect(liveRow.querySelector('a[href^="mailto:"]')).not.toBeNull();
    expect(mocks.sources.at(-1).downloads).toEqual(
      expect.objectContaining({ handleClick: expect.any(Function) }),
    );
  });

  it("generates the CSV through the dialog, adding the unloaded view only for the read", async () => {
    build({ downloadsEnabled: true });
    sidebar.showTab("test");
    // Shown as in an expanded row (jsdom will not focus inside display: none),
    // without the expand control, which would also turn the layer on.
    homeRow(layers.vector).querySelector(".layer-body").style.display = "block";
    const button = homeRow(layers.vector).querySelector("[data-action='download-csv']");
    button.focus();
    button.click();
    const dialog = document.querySelector("dialog.download-dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Download CSV: Vector Layer");
    await waitFor(() => expect(dialog.dataset.state).toBe("done"));

    expect(document.querySelector('[data-ui="mapx"]').classList.contains("is-reading-data")).toBe(false);
    expect(mocks.calls).toEqual([
      ["view_add", { idView: "MX-VEC-1", zoomToView: false }],
      ["get_view_table_attribute", { idView: "MX-VEC-1" }],
      ["view_remove", { idView: "MX-VEC-1" }],
    ]);
    // The layer controller's record never saw the temporary view.
    expect(sidebar.store.get("vector-layer")).toMatchObject({ desired: false, applied: false, viewId: null });
    expect(mocks.viewAdd).not.toHaveBeenCalled();

    expect(dialog.querySelector('[data-part="status"]').textContent).toBe(
      "Download started: vector-layer_MX-VEC-1.csv (2 regions).",
    );
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    // UTF-8 byte-order mark, so Excel reads the names as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await blobs[0].text(); // decoding drops the mark
    const lines = text.trimEnd().split("\r\n");
    expect(lines.filter((line) => line.startsWith("#,"))).toEqual(
      expect.arrayContaining([
        "#,Title: Vector Layer",
        "#,MapX view ID: MX-VEC-1",
        "#,Citation: Provider (2026).",
      ]),
    );
    expect(lines.filter((line) => !line.startsWith("#,"))).toEqual([
      "iso3,region_name,Vector Layer",
      "CCA,Region A,1",
      "CCB,Region B,2.5",
    ]);

    // Closing returns focus to the button that opened it.
    dialog.querySelector(".download-dialog__actions [data-action='close']").click();
    expect(document.activeElement).toBe(button);

    // A second download reads the table directly: the session has loaded the view.
    mocks.calls.length = 0;
    button.click();
    await waitFor(() => expect(dialog.dataset.state).toBe("done"));
    expect(mocks.calls.map(([method]) => method)).toEqual(["get_view_table_attribute"]);
  });

  it("reads a layer that is on without adding or removing its view", async () => {
    build({ downloadsEnabled: true });
    await sidebar.controller.setOn("vector-layer", true);
    expect(mocks.viewAdd).toHaveBeenCalledWith("MX-VEC-1");
    homeRow(layers.vector).querySelector("[data-action='download-csv']").click();
    const dialog = document.querySelector("dialog.download-dialog");
    await waitFor(() => expect(dialog.dataset.state).toBe("done"));
    expect(mocks.calls.map(([method]) => method)).toEqual(["get_view_table_attribute"]);
    expect(sidebar.store.get("vector-layer")).toMatchObject({ applied: true, viewId: "MX-VEC-1" });
  });

  it("removes the dialog with the instance", () => {
    build({ downloadsEnabled: true });
    homeRow(layers.vector).querySelector("[data-action='download-csv']").click();
    expect(document.querySelector("dialog")).not.toBeNull();
    sidebar.destroy();
    sidebar = null;
    expect(document.querySelector("dialog")).toBeNull();
  });
});
