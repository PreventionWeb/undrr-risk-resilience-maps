import { beforeEach, describe, expect, it, vi } from "vitest";

const { viewAdd, viewRemove } = vi.hoisted(() => ({
  viewAdd: vi.fn().mockResolvedValue(undefined),
  viewRemove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../sdk/views.js", () => ({ viewAdd, viewRemove }));
vi.mock("../sdk/client.js", () => ({ isSDKReady: () => true }));
vi.mock("./layer-controls.js", () => ({
  addOpacitySlider: vi.fn((_idView, container) => {
    const el = document.createElement("div");
    el.className = "opacity-row";
    container.appendChild(el);
  }),
  addLegend: vi.fn((_layer, container) => {
    const el = document.createElement("div");
    el.className = "html-legend";
    container.appendChild(el);
  }),
}));

import * as store from "../state/store.js";
import { buildCrossTabRow, buildLayerAccordion } from "./sidebar.js";

const layer = {
  id: "MX-TEST-LAYER",
  key: "test-layer",
  label: "Test Layer",
  type: "vt",
  geometry: "polygon",
  desc: "Test description.",
  initiative: "Test R-R initiative",
};

describe("layer accordion activation", () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="layer-clear-btn" hidden></button>';
    store.openViews.clear();
    viewAdd.mockClear();
    viewRemove.mockClear();
  });

  it("turns a layer on when expanded and leaves it on when collapsed", async () => {
    const { wrapper, eyeBtn } = buildLayerAccordion(layer);
    document.body.appendChild(wrapper);
    const header = wrapper.querySelector(".layer-header");
    const body = wrapper.querySelector(".layer-body");

    header.click();
    await vi.waitFor(() => expect(viewAdd).toHaveBeenCalledWith(layer.id));
    expect(body.style.display).toBe("block");
    expect(eyeBtn.getAttribute("role")).toBe("switch");
    expect(eyeBtn.getAttribute("aria-checked")).toBe("true");
    expect(store.openViews.has(layer.id)).toBe(true);

    header.click();
    expect(body.style.display).toBe("none");
    expect(viewRemove).not.toHaveBeenCalled();
    expect(eyeBtn.getAttribute("aria-checked")).toBe("true");
    expect(store.openViews.has(layer.id)).toBe(true);

    header.click();
    expect(body.style.display).toBe("block");
    expect(viewAdd).toHaveBeenCalledTimes(1);

    eyeBtn.click();
    await vi.waitFor(() => expect(viewRemove).toHaveBeenCalledWith(layer.id));
    expect(body.style.display).toBe("none");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(wrapper.querySelector(".layer-arrow").textContent).toBe("\u25B6");
    expect(eyeBtn.getAttribute("aria-checked")).toBe("false");
    expect(store.openViews.has(layer.id)).toBe(false);
  });

  it("does not reopen controls when collapsed during a slow activation", async () => {
    let finishAdd;
    viewAdd.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAdd = resolve;
        }),
    );
    const { wrapper, eyeBtn } = buildLayerAccordion(layer);
    document.body.appendChild(wrapper);
    const header = wrapper.querySelector(".layer-header");
    const body = wrapper.querySelector(".layer-body");

    header.click();
    header.click();
    expect(body.style.display).toBe("none");

    finishAdd();
    await vi.waitFor(() => expect(eyeBtn.getAttribute("aria-checked")).toBe("true"));
    expect(body.style.display).toBe("none");
    expect(store.openViews.has(layer.id)).toBe(true);
  });

  it("shows the R-R initiative before the layer description", () => {
    const { wrapper } = buildLayerAccordion(layer);

    expect(wrapper.querySelector(".layer-desc").textContent).toBe("Test R-R initiative. Test description.");
  });

  it("shows the legend in the cross-tab row when a layer is activated outside its tab", async () => {
    // Regression: activating a layer from another tab's cross-tab section only
    // rendered the legend into the (hidden) home-tab accordion.
    const { wrapper, eyeBtn } = buildLayerAccordion(layer);
    document.body.appendChild(wrapper);
    const crossRow = buildCrossTabRow(layer);
    document.body.appendChild(crossRow);
    const crossBody = crossRow.querySelector(".cross-tab-body");
    const crossEye = crossRow.querySelector(".layer-eye");
    // The cross-tab switch delegates to the canonical switch via layerElementMap,
    // which buildSidebar populates; drive the canonical switch directly here.
    expect(crossBody.hidden).toBe(true);

    eyeBtn.click();
    await vi.waitFor(() => expect(crossEye.getAttribute("aria-checked")).toBe("true"));
    expect(crossBody.hidden).toBe(false);
    expect(crossBody.querySelector(".layer-legend-slot .html-legend")).not.toBeNull();
    expect(crossBody.querySelector(".layer-slider-slot .opacity-row")).not.toBeNull();
    expect(crossBody.querySelector(".layer-desc").textContent).toBe("Test R-R initiative. Test description.");

    eyeBtn.click();
    await vi.waitFor(() => expect(crossEye.getAttribute("aria-checked")).toBe("false"));
    expect(crossBody.hidden).toBe(true);
    expect(crossBody.querySelector(".html-legend")).toBeNull();
  });
});
