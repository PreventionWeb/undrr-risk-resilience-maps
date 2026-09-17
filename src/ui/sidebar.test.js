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
vi.mock("./home.js", () => ({ buildHomePanel: () => document.createElement("div") }));
vi.mock("./info-panels.js", () => ({
  buildSourcesPanel: () => document.createElement("div"),
  buildAboutPanel: () => document.createElement("div"),
}));
vi.mock("./mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
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
import { TABS } from "../config/layers.js";
import { createSidebar } from "./sidebar.js";

const { layer } = testLayers;

describe("layer accordion activation", () => {
  let sidebar;

  /** Build a sidebar for `tabs` (by default the mocked config) in a fresh page. */
  function build(tabs) {
    sidebar?.destroy();
    document.body.innerHTML = `
      <div data-ui="layer-panel"><div class="layer-panel-header"></div><div data-ui="panel-body"></div></div>
      <button data-ui="clear-layers" hidden></button>`;
    sidebar = createSidebar(document.body, tabs ? { tabs } : {});
  }

  /** A layer's home-tab row, as the old buildLayerAccordion() returned it. */
  function accordion(target, tabs = TABS) {
    const index = tabs[0].layers.indexOf(target);
    const wrapper = document.querySelectorAll(".tab-panel .layer-item")[index];
    return { wrapper, eyeBtn: wrapper.querySelector(".layer-eye") };
  }

  const getLayersStore = () => sidebar.store;

  beforeEach(() => {
    store.openViews.clear();
    viewAdd.mockClear();
    viewRemove.mockClear();
    build();
    return () => {
      sidebar.destroy();
      sidebar = null;
    };
  });

  it("turns a layer on when expanded and leaves it on when collapsed", async () => {
    const { wrapper, eyeBtn } = accordion(layer);
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

  it("warns and leaves the switch off for a layer that is not in the config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const unknown = { ...layer, key: "not-in-config", id: "MX-NOT-IN-CONFIG" };
      // A tab listing a layer the registry (built from the config) doesn't have.
      const tabs = [{ ...TABS[0], layers: [...TABS[0].layers, unknown] }];
      build(tabs);
      const { wrapper, eyeBtn } = accordion(unknown, tabs);
      expect(warn.mock.calls.some(([message]) => String(message).includes("not-in-config"))).toBe(true);

      eyeBtn.click();

      await vi.waitFor(() => expect(getLayersStore().get(unknown.key).status).toBe("error"));
      expect(getLayersStore().get(unknown.key)).toMatchObject({ desired: false, applied: false });
      expect(eyeBtn.getAttribute("aria-checked")).toBe("false");
      expect(eyeBtn.getAttribute("aria-busy")).toBe("false");
      expect(wrapper.querySelector(".layer-announcer").textContent).toBe(
        "Could not load Test Layer. It is off.",
      );
      expect(viewAdd).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not reopen controls when collapsed during a slow activation", async () => {
    let finishAdd;
    viewAdd.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAdd = resolve;
        }),
    );
    const { wrapper, eyeBtn } = accordion(layer);
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
    const { wrapper, eyeBtn } = accordion(layer);
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
    const { wrapper } = accordion(freshLayer());
    const header = wrapper.querySelector(".layer-header");

    pressKey(header, key);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    pressKey(header, key);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the R-R initiative before the layer description", () => {
    const { wrapper } = accordion(layer);

    expect(wrapper.querySelector(".layer-desc").textContent).toBe("Test R-R initiative. Test description.");
  });
});
