import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/layers.js", () => ({
  TABS: [
    {
      id: "test-tab",
      label: "Test",
      layers: [
        { id: "vt-view", key: "vt-layer", label: "VT Layer", type: "vt" },
        { id: "rt-view", key: "rt-layer", label: "RT Layer", type: "rt" },
        {
          id: null,
          key: "compound",
          label: "Compound Layer",
          type: "vt",
          sources: [
            { id: "compound-src-0", label: "Source A" },
            { id: "compound-src-1", label: "Source B" },
          ],
        },
      ],
    },
  ],
}));

import {
  buildSiteInspectorPanel,
  showSiteInspector,
  hideSiteInspector,
  isSiteInspectorVisible,
} from "./site-inspector.js";

function setupDOM() {
  document.body.innerHTML = `<div id="app-map"></div>`;
}

beforeEach(() => {
  setupDOM();
});

describe("buildSiteInspectorPanel", () => {
  it("appends the panel to #app-map", () => {
    buildSiteInspectorPanel();
    expect(document.getElementById("site-inspector")).toBeTruthy();
    expect(document.getElementById("app-map").contains(document.getElementById("site-inspector"))).toBe(true);
  });

  it("starts hidden", () => {
    buildSiteInspectorPanel();
    expect(document.getElementById("site-inspector").hidden).toBe(true);
  });

  it("does not duplicate the panel if called twice", () => {
    buildSiteInspectorPanel();
    buildSiteInspectorPanel();
    expect(document.querySelectorAll("#site-inspector").length).toBe(1);
  });
});

describe("showSiteInspector / hideSiteInspector", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows the panel", () => {
    showSiteInspector({
      lngLat: { lat: 10, lng: 20 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    expect(isSiteInspectorVisible()).toBe(true);
  });

  it("hides the panel", () => {
    showSiteInspector({
      lngLat: { lat: 10, lng: 20 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    hideSiteInspector();
    expect(isSiteInspectorVisible()).toBe(false);
  });

  it("renders coordinates", () => {
    showSiteInspector({
      lngLat: { lat: 12.34567, lng: -56.78901 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    const coords = document.querySelector(".site-inspector-coords-value").textContent;
    expect(coords).toContain("12.34567");
    expect(coords).toContain("-56.78901");
  });

  it("closes on Escape key", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isSiteInspectorVisible()).toBe(false);
  });

  it("removes Escape handler after close", () => {
    showSiteInspector({ lngLat: { lat: 0, lng: 0 }, views: {}, openViewsSnapshot: new Set() });
    hideSiteInspector();
    // Should not throw
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
});

describe("layer rows — VT with data", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows attribute table for VT view with hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ country: "Japan", pop: 125 }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).toContain("Japan");
    expect(html).toContain("125");
  });

  it("uses has-data indicator for VT view with hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ name: "X" }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-indicator--has-data")).toBeTruthy();
  });

  it("filters SKIP_KEYS from attribute table", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ gid: 1, geom: "POINT(0 0)", name: "Visible" }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).not.toContain(">1<");
    expect(html).not.toContain("POINT");
    expect(html).toContain("Visible");
  });

  it("escapes HTML in attribute values", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [{ name: '<script>alert("xss")</script>' }] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("layer rows — VT with no hit", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows 'no data' note for VT view with empty attributes", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("No data");
  });

  it("uses no-data indicator for VT view with no hit", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "vt-view": [] },
      openViewsSnapshot: new Set(["vt-view"]),
    });
    expect(document.querySelector(".site-inspector-indicator--no-data")).toBeTruthy();
  });
});

describe("layer rows — RT layer", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows 'not queryable' note for RT layer absent from batch", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(["rt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("Raster layer");
  });

  it("shows GRAY_INDEX attribute table for RT layer that fired click_attributes", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "rt-view": [{ GRAY_INDEX: 42 }] },
      openViewsSnapshot: new Set(["rt-view"]),
    });
    const html = document.querySelector(".site-inspector-layers").innerHTML;
    expect(html).toContain("Pixel Value");
    expect(html).toContain("42");
    expect(html).not.toContain("Raster layer");
  });

  it("shows 'no data' when GRAY_INDEX is the float32 nodata sentinel", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "rt-view": [{ GRAY_INDEX: -3.4028234663852886e38 }] },
      openViewsSnapshot: new Set(["rt-view"]),
    });
    expect(document.querySelector(".site-inspector-layers").textContent).toContain("No data");
    expect(document.querySelector(".site-inspector-layers").textContent).not.toContain("3.40");
  });
});

describe("layer rows — compound layer", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows the source label for a compound source view", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: { "compound-src-1": [{ value: 99 }] },
      openViewsSnapshot: new Set(["compound-src-1"]),
    });
    const text = document.querySelector(".site-inspector-layer-name").textContent;
    expect(text).toBe("Source B");
  });
});

describe("empty state", () => {
  beforeEach(() => buildSiteInspectorPanel());

  it("shows empty message when no views in snapshot", () => {
    showSiteInspector({
      lngLat: { lat: 0, lng: 0 },
      views: {},
      openViewsSnapshot: new Set(),
    });
    expect(document.querySelector(".site-inspector-empty")).toBeTruthy();
  });
});
