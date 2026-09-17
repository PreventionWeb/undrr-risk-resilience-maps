import { beforeEach, describe, expect, it, vi } from "vitest";

const { viewAdd, viewRemove } = vi.hoisted(() => ({
  viewAdd: vi.fn().mockResolvedValue(undefined),
  viewRemove: vi.fn().mockResolvedValue(undefined),
}));

// The controller looks layers up in the config registry, so the rows built
// here must be in the config: the shared test layer and one fresh layer per
// keyboard test.
const testLayers = vi.hoisted(() => {
  const layer = {
    id: "MX-TEST-LAYER",
    key: "test-layer",
    label: "Test Layer",
    type: "vt",
    geometry: "polygon",
    desc: "Test description.",
    initiative: "Test R-R initiative",
  };
  const fresh = Array.from({ length: 6 }, (_, i) => ({
    ...layer,
    key: `fresh-layer-${i + 1}`,
    id: `MX-FRESH-${i + 1}`,
  }));
  return { layer, fresh };
});
vi.mock("../config/layers.js", () => ({
  TABS: [{ id: "test", label: "Test", layers: [testLayers.layer, ...testLayers.fresh] }],
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
import { buildLayerAccordion, getLayersStore } from "./sidebar.js";

const { layer } = testLayers;

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
    await vi.waitFor(() => expect(store.openViews.has(layer.id)).toBe(true));
    expect(viewAdd).toHaveBeenCalledWith(layer.id);
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
    await vi.waitFor(() =>
      expect(getLayersStore().get(layer.key)).toMatchObject({ applied: false, status: "idle" }),
    );
    expect(viewRemove).toHaveBeenCalledWith(layer.id);
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
    await vi.waitFor(() =>
      expect(getLayersStore().get(layer.key)).toMatchObject({ applied: true, status: "idle" }),
    );
    expect(eyeBtn.getAttribute("aria-checked")).toBe("true");
    expect(body.style.display).toBe("none");
    expect(store.openViews.has(layer.id)).toBe(true);
  });

  /**
   * Press a key the way a browser does: keydown bubbles, and unless a listener
   * cancels it, Enter/Space on a button activates it (a click).
   */
  function pressKey(target, key) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (!event.defaultPrevented && target instanceof HTMLButtonElement) target.click();
  }

  /** A layer of its own, so rows built by earlier tests don't share its record. */
  let layerCount = 0;
  const freshLayer = () => testLayers.fresh[layerCount++];

  it.each(["Enter", " "])("toggles the layer, not the accordion, on %j on the switch", async (key) => {
    const layer = freshLayer();
    const { wrapper, eyeBtn } = buildLayerAccordion(layer);
    document.body.appendChild(wrapper);
    const body = wrapper.querySelector(".layer-body");

    pressKey(eyeBtn, key);
    await vi.waitFor(() => expect(getLayersStore().get(layer.key).applied).toBe(true));
    expect(eyeBtn.getAttribute("aria-checked")).toBe("true");

    pressKey(eyeBtn, key);
    await vi.waitFor(() =>
      expect(getLayersStore().get(layer.key)).toMatchObject({
        desired: false,
        applied: false,
        status: "idle",
      }),
    );
    expect(eyeBtn.getAttribute("aria-checked")).toBe("false");
    expect(body.style.display).toBe("none");
    expect(wrapper.querySelector(".layer-header").getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["Enter", " "])("toggles the accordion on %j on the header", (key) => {
    const { wrapper } = buildLayerAccordion(freshLayer());
    document.body.appendChild(wrapper);
    const header = wrapper.querySelector(".layer-header");

    pressKey(header, key);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    pressKey(header, key);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the R-R initiative before the layer description", () => {
    const { wrapper } = buildLayerAccordion(layer);

    expect(wrapper.querySelector(".layer-desc").textContent).toBe("Test R-R initiative. Test description.");
  });
});
