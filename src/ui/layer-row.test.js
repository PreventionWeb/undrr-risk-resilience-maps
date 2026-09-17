import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  runtimes: new Map(),
}));

vi.mock("./layer-controls.js", () => ({
  addOpacitySlider: mocks.addOpacitySlider,
  addLegend: mocks.addLegend,
}));
vi.mock("../external/index.js", () => ({
  isExternalLayer: (layer) => Boolean(layer.external),
  getExternalLayerRuntime: (layer) => mocks.runtimes.get(layer.key) ?? null,
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
}));

import { createLayerRow } from "./layer-row.js";
import { createLayersStore } from "../state/layers-store.js";

const simple = { key: "pop", id: "MX-POP", label: "Population", type: "vt", desc: "People." };
const compound = {
  key: "flood",
  id: null,
  label: "Flood",
  type: "rt",
  desc: "Flood.",
  widget: { type: "sub-tabs" },
  sources: [
    { id: "MX-F10", label: "10y", desc: "Ten." },
    { id: "MX-F100", label: "100y", desc: "Hundred." },
  ],
};
const external = { key: "crops", id: null, label: "Crops", type: "cc", desc: "Crops.", external: {} };
const draft = { key: "draft", id: null, label: "Draft", type: "vt", status: "disabled" };

/** A real store and a controller that only records intent (the tests play MapX). */
function setup(layer, options = {}) {
  const store = createLayersStore();
  const controller = {
    setOn: vi.fn(async (key, on) => store.set(key, { desired: on })),
    setSource: vi.fn(async (key, sourceIdx) => store.set(key, { sourceIdx })),
    setSettings: vi.fn(async (key, settings) => store.set(key, { settings })),
  };
  const row = createLayerRow(layer, { store, controller, ...options });
  store.subscribe((key, next) => {
    if (key === layer.key) row.update(next);
  });
  document.body.appendChild(row.element);
  return { store, controller, row, el: row.element };
}

/** Count DOM mutations made by fn inside element. */
async function mutationsDuring(element, fn) {
  const records = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
  fn();
  await Promise.resolve();
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records.length;
}

const eye = (el) => el.querySelector(".layer-eye");
const announcer = (el) => el.querySelector(".layer-announcer").textContent;

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.addOpacitySlider.mockClear();
  mocks.addLegend.mockClear();
  mocks.runtimes.clear();
});

describe.each(["full", "compact"])("createLayerRow (%s)", (variant) => {
  it("renders the same record twice without DOM changes or SDK calls", async () => {
    const { store, row, el } = setup(simple, { variant });
    store.set("pop", { desired: true, status: "loading" });
    store.set("pop", { applied: true, viewId: "MX-POP", status: "idle" });
    expect(mocks.addLegend).toHaveBeenCalledTimes(1);
    expect(mocks.addOpacitySlider).toHaveBeenCalledTimes(1);

    const record = store.get("pop");
    expect(await mutationsDuring(el, () => row.update(record))).toBe(0);
    expect(await mutationsDuring(el, () => row.update(record))).toBe(0);
    expect(mocks.addLegend).toHaveBeenCalledTimes(1);
    expect(mocks.addOpacitySlider).toHaveBeenCalledTimes(1);
  });

  it("shows busy switch state and labels from the record", () => {
    const { store, el } = setup(simple, { variant });
    // A switch keeps the layer's name; its state is the switch state.
    expect(eye(el).getAttribute("role")).toBe("switch");
    expect(eye(el).type).toBe("checkbox");
    expect(eye(el).closest(".mg-switch")).not.toBeNull();
    expect(eye(el).checked).toBe(false);
    expect(eye(el).getAttribute("aria-busy")).toBe("false");
    expect(eye(el).getAttribute("aria-label")).toBe("Population");

    store.set("pop", { desired: true, status: "loading" });
    expect(eye(el).checked).toBe(true);
    expect(eye(el).getAttribute("aria-busy")).toBe("true");
    expect(eye(el).getAttribute("aria-label")).toBe("Loading Population…");

    store.set("pop", { applied: true, viewId: "MX-POP", status: "idle" });
    expect(eye(el).getAttribute("aria-busy")).toBe("false");
    expect(eye(el).getAttribute("aria-label")).toBe("Population");

    store.set("pop", { desired: false, status: "removing" });
    expect(eye(el).getAttribute("aria-label")).toBe("Turning off Population…");
  });

  it("marks the switch aria-disabled while the map is not ready", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { controller, el } = setup(simple, { variant, isReady: () => false });
    expect(eye(el).getAttribute("aria-disabled")).toBe("true");

    eye(el).click();

    // The click is cancelled, so the checkbox does not stay on either.
    expect(eye(el).checked).toBe(false);
    expect(controller.setOn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows an error state on the switch, and a message, after a failed load", () => {
    const { store, el } = setup(simple, { variant });
    store.set("pop", { desired: true, status: "loading" });
    store.set("pop", { desired: false, status: "error", error: new Error("offline") });

    expect(el.querySelector(".layer-switch").classList.contains("is-error")).toBe(true);
    const message = el.querySelector(".layer-error");
    expect(message.textContent).toBe("Could not load Population. It is off.");
    // Said once, by the row's live region.
    expect(message.getAttribute("aria-hidden")).toBe("true");

    // The next attempt clears both.
    store.set("pop", { desired: true, status: "loading" });
    expect(el.querySelector(".layer-switch").classList.contains("is-error")).toBe(false);
    expect(el.querySelector(".layer-error").textContent).toBe("");
  });

  it("announces a failure and clears the message on the next call", () => {
    const { store, el } = setup(simple, { variant });
    const region = el.querySelector(".layer-announcer");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.id).toBe("");

    store.set("pop", { desired: true, status: "loading" });
    store.set("pop", { desired: false, status: "error", error: new Error("offline") });
    expect(announcer(el)).toBe("Could not load Population. It is off.");

    store.set("pop", { desired: true, status: "loading" });
    expect(announcer(el)).toBe("");
    store.set("pop", { applied: true, viewId: "MX-POP", status: "idle", error: null });
    store.set("pop", { status: "removing", desired: false });
    store.set("pop", { status: "error", desired: true, error: new Error("timeout") });
    expect(announcer(el)).toBe("Could not change Population. It is still on as before.");
  });

  it("does not announce a failure that the controls announce", () => {
    const { store, el } = setup(external, { variant, selectionPending: () => true });
    store.set("crops", { desired: true, status: "loading" });
    store.set("crops", { desired: false, status: "error", error: new Error("offline") });
    expect(announcer(el)).toBe("");
  });

  it("asks the controller for the opposite of the current intent", async () => {
    const { store, controller, el } = setup(simple, { variant });
    eye(el).click();
    expect(controller.setOn).toHaveBeenLastCalledWith("pop", true);
    eye(el).click();
    expect(controller.setOn).toHaveBeenLastCalledWith("pop", false);
    expect(store.get("pop").desired).toBe(false);
  });

  it("does nothing while the map is not ready", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { controller, el } = setup(simple, { variant, isReady: () => false });
    eye(el).click();
    expect(controller.setOn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders the slider and legend only while visible, once per view", () => {
    let visible = false;
    const { store, row, el } = setup(compound, { variant, isVisible: () => visible });
    store.set("flood", { desired: true, applied: true, viewId: "MX-F10" });
    expect(mocks.addLegend).not.toHaveBeenCalled();
    expect(mocks.addOpacitySlider).not.toHaveBeenCalled();

    visible = true;
    row.update(store.get("flood"));
    row.update(store.get("flood"));
    expect(mocks.addOpacitySlider).toHaveBeenCalledTimes(1);
    expect(mocks.addOpacitySlider).toHaveBeenCalledWith("MX-F10", el.querySelector(".layer-slider-slot"));
    expect(mocks.addLegend).toHaveBeenCalledTimes(1);
    expect(mocks.addLegend.mock.calls[0][0]).toMatchObject({ id: "MX-F10", desc: "Ten.", label: "Flood" });

    // Hidden again: rendered controls are kept, and a new view clears them at once.
    visible = false;
    row.update(store.get("flood"));
    expect(el.querySelector(".html-legend")).not.toBeNull();
    store.set("flood", { viewId: null, status: "switching" });
    expect(el.querySelector(".html-legend")).not.toBeNull();
    store.set("flood", { viewId: "MX-F100", appliedSourceIdx: 1, sourceIdx: 1, status: "idle" });
    expect(el.querySelector(".html-legend")).toBeNull();
    expect(mocks.addLegend).toHaveBeenCalledTimes(1);

    visible = true;
    row.update(store.get("flood"));
    expect(mocks.addLegend).toHaveBeenCalledTimes(2);
    expect(mocks.addLegend.mock.calls[1][0]).toMatchObject({ id: "MX-F100", desc: "Hundred." });
    expect(el.querySelector(".layer-desc").textContent).toBe("Hundred.");
  });

  it("removes its listeners and ignores records once destroyed", () => {
    const { store, controller, row, el } = setup(simple, { variant });
    row.destroy();
    // The switch's own listener stops propagation; once removed, the click bubbles.
    const bubbled = vi.fn();
    el.addEventListener("click", bubbled);

    // The checkbox still toggles itself (that is the browser, not the row),
    // but nothing reaches the controller and no record is rendered again.
    eye(el).click();
    expect(bubbled).toHaveBeenCalledTimes(1);
    if (variant === "full") el.querySelector(".layer-expand").click();
    store.set("pop", { desired: true, applied: true, viewId: "MX-POP" });

    expect(controller.setOn).not.toHaveBeenCalled();
    expect(eye(el).getAttribute("aria-busy")).toBe("false");
    expect(mocks.addLegend).not.toHaveBeenCalled();
    if (variant === "full") {
      expect(el.querySelector(".layer-expand").getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("builds no switch or announcer for an unpublished layer", () => {
    const { el } = setup(draft, { variant });
    expect(eye(el)).toBeNull();
    expect(el.querySelector(".layer-announcer")).toBeNull();
  });
});

describe("createLayerRow full variant", () => {
  const header = (el) => el.querySelector(".layer-expand");
  const expanded = (el) => header(el).getAttribute("aria-expanded") === "true";

  it("uses the accordion markup", () => {
    const { el } = setup(simple);
    expect(el.className).toBe("layer-item");
    expect(el.querySelector(".layer-body").style.display).toBe("none");
    expect(el.querySelector(".layer-meta-links a[href='#sources']")).not.toBeNull();
    expect(el.querySelector(".layer-widget-slot")).not.toBeNull();
  });

  it("expands when a switch activation applies", () => {
    const { store, el } = setup(simple);
    eye(el).click();
    expect(expanded(el)).toBe(false);
    store.set("pop", { applied: true, viewId: "MX-POP" });
    expect(expanded(el)).toBe(true);
    expect(el.classList.contains("layer-active")).toBe(true);
    expect(el.querySelector(".layer-body").style.display).toBe("block");
  });

  it("expands when a layer is turned on from elsewhere (restore, a cross-tab row)", () => {
    const { store, el } = setup(simple);
    store.set("pop", { desired: true, status: "loading" });
    store.set("pop", { applied: true, viewId: "MX-POP", status: "idle" });
    expect(expanded(el)).toBe(true);
  });

  it("does not reopen after the header started the activation and was collapsed", () => {
    const { store, controller, el } = setup(simple);
    header(el).click();
    expect(expanded(el)).toBe(true);
    expect(controller.setOn).toHaveBeenCalledWith("pop", true);
    header(el).click();
    expect(expanded(el)).toBe(false);

    store.set("pop", { applied: true, viewId: "MX-POP" });
    expect(expanded(el)).toBe(false);
    // Collapsing leaves the layer on.
    expect(controller.setOn).toHaveBeenCalledTimes(1);
  });

  it("collapses when the layer goes off, and expands on the next switch activation", () => {
    const { store, el } = setup(simple);
    header(el).click();
    store.set("pop", { applied: true, viewId: "MX-POP" });
    eye(el).click();
    store.set("pop", { applied: false, viewId: null });
    expect(expanded(el)).toBe(false);
    expect(el.querySelector(".layer-slider-slot").children).toHaveLength(0);

    // Turned on again from outside the header: it expands.
    store.set("pop", { desired: true });
    store.set("pop", { applied: true, viewId: "MX-POP" });
    expect(expanded(el)).toBe(true);
  });

  it("gives the accordion its own button beside the switch, not around it", () => {
    const { el } = setup(simple);
    const expand = header(el);
    expect(expand.tagName).toBe("BUTTON");
    // The switch is a sibling: no interactive control nested inside another.
    expect(expand.querySelector(".layer-eye")).toBeNull();
    expect(eye(el).closest(".layer-expand")).toBeNull();
    expect(eye(el).closest(".mg-switch").parentElement).toBe(expand.parentElement);
  });

  it("toggles the accordion, not the layer, on Enter or Space on the expand button", () => {
    const { controller, el } = setup(draft);
    // A native button: the browser turns Enter and Space into a click, so the
    // row cancels nothing.
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      header(el).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      header(el).click();
    }
    expect(expanded(el)).toBe(false);
    expect(controller.setOn).not.toHaveBeenCalled();
  });

  it("leaves Space on the switch to the switch and turns Enter into a toggle", () => {
    const { controller, el } = setup(simple);
    // Space is the checkbox's own key: the row must not cancel it.
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    eye(el).dispatchEvent(space);
    expect(space.defaultPrevented).toBe(false);
    expect(expanded(el)).toBe(false);

    // Enter does nothing to a checkbox, so the row activates it.
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    eye(el).dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(controller.setOn).toHaveBeenLastCalledWith("pop", true);
  });

  it("opens Sources from the citation link", () => {
    const onNavigate = vi.fn();
    const { el } = setup(simple, { onNavigate });
    el.querySelector(".layer-meta-links a[href='#sources']").click();
    expect(onNavigate).toHaveBeenCalledWith("sources");
  });

  it("builds the source widget when the layer comes on and rebuilds it when the source changes elsewhere", async () => {
    const { store, controller, el } = setup(compound);
    store.set("flood", { desired: true, applied: true, viewId: "MX-F10" });
    const tabs = () => [...el.querySelectorAll(".widget-sub-tab")];
    expect(tabs().map((tab) => tab.classList.contains("is-active"))).toEqual([true, false]);

    tabs()[1].click();
    expect(controller.setSource).toHaveBeenCalledWith("flood", 1);

    // Back/forward: the source changes outside the widget and settles.
    const widget = el.querySelector(".widget-sub-tabs");
    await Promise.resolve();
    store.set("flood", { sourceIdx: 0, status: "switching" });
    store.set("flood", { status: "idle" });
    await vi.waitFor(() => expect(tabs()[0].classList.contains("is-active")).toBe(true));
    expect(el.querySelector(".widget-sub-tabs")).not.toBe(widget);
  });

  it("removes the source widget's and external controls' listeners on destroy", () => {
    const flood = setup(compound);
    flood.store.set("flood", { desired: true, applied: true, viewId: "MX-F10" });
    const crops = setup(external);
    crops.store.set("crops", {
      desired: true,
      applied: true,
      viewId: "GJ-1",
      appliedSettings: { crop: "WHEAT" },
    });
    flood.row.destroy();
    crops.row.destroy();

    const tab = flood.el.querySelectorAll(".widget-sub-tab")[1];
    tab.click();
    // With the listener still attached, the tab would show as picked at once.
    expect(tab.classList.contains("is-active")).toBe(false);
    expect(flood.controller.setSource).not.toHaveBeenCalled();

    const select = crops.el.querySelector("select[data-external-control='crop']");
    select.value = "MAIZE";
    select.dispatchEvent(new Event("change"));
    // With the listener still attached, the controls would lock while updating.
    expect(select.disabled).toBe(false);
    expect(crops.controller.setSettings).not.toHaveBeenCalled();
  });

  it("shows external loading and error messages in the widget slot", () => {
    const { store, el } = setup(external);
    eye(el).click();
    store.set("crops", { status: "loading" });
    const status = el.querySelector(".layer-widget-slot .external-layer-status");
    expect(status.textContent).toBe("Loading Crops…");
    expect(expanded(el)).toBe(true);

    store.set("crops", { desired: false, status: "error", error: new Error("offline") });
    expect(status.textContent).toBe("Could not load Crops. Please try again.");
    expect(status.classList.contains("is-error")).toBe(true);
  });

  it("builds external controls with the applied settings and the runtime legend", () => {
    mocks.runtimes.set("crops", { idView: "GJ-1", legend: [{ color: "#000", label: "x" }] });
    const { store, el } = setup(external);
    store.set("crops", { desired: true, applied: true, viewId: "GJ-1", appliedSettings: { crop: "MAIZE" } });
    expect(el.querySelector("select[data-external-control='crop']").value).toBe("MAIZE");
    expect(mocks.addLegend.mock.calls[0][0]).toMatchObject({ id: "GJ-1", legend: [{ label: "x" }] });
  });
});

describe("createLayerRow compact variant", () => {
  const body = (el) => el.querySelector(".cross-tab-body");

  it("uses the cross-tab markup, with no accordion or source controls", () => {
    const { store, el } = setup(compound, { variant: "compact" });
    store.set("flood", { desired: true, applied: true, viewId: "MX-F10" });
    expect(el.className).toBe("cross-tab-item");
    expect(el.querySelector(".cross-tab-label").textContent).toBe("Flood");
    expect(el.querySelector(".layer-type-tag").textContent).toBe("raster");
    expect(el.querySelector(".layer-expand, .layer-widget-slot, .widget-sub-tabs")).toBeNull();
  });

  it("shows details only while the layer is on", () => {
    const { store, el } = setup(simple, { variant: "compact" });
    expect(body(el).hidden).toBe(true);

    store.set("pop", { desired: true, status: "loading" });
    expect(body(el).hidden).toBe(true);
    store.set("pop", { applied: true, viewId: "MX-POP", status: "idle" });
    expect(body(el).hidden).toBe(false);
    expect(el.querySelector(".layer-desc").textContent).toBe("People.");
    expect(el.querySelector(".layer-slider-slot .opacity-row")).not.toBeNull();
    expect(el.querySelector(".layer-legend-slot .html-legend")).not.toBeNull();

    store.set("pop", { desired: false, applied: false, viewId: null });
    expect(body(el).hidden).toBe(true);
    expect(el.querySelector(".html-legend")).toBeNull();
    expect(el.querySelector(".opacity-row")).toBeNull();
  });

  it("opens the cross-tab section it is in when the layer comes on", () => {
    const section = document.createElement("details");
    section.className = "cross-tab-section";
    const { store, el } = setup(simple, { variant: "compact" });
    section.appendChild(el);
    document.body.appendChild(section);
    store.set("pop", { desired: true, applied: true, viewId: "MX-POP" });
    expect(section.open).toBe(true);
  });

  it("renders a visible external loading or error status twice without DOM changes or control calls", async () => {
    const { store, controller, row, el } = setup(external, { variant: "compact" });
    const settle = async (patch) => {
      store.set("crops", patch);
      const record = store.get("crops");
      expect(await mutationsDuring(el, () => row.update(record))).toBe(0);
      expect(await mutationsDuring(el, () => row.update(record))).toBe(0);
    };

    await settle({ desired: true, status: "loading" });
    expect(el.querySelector(".external-layer-status").textContent).toBe("Loading Crops…");
    await settle({ desired: false, status: "error", error: new Error("offline") });
    expect(el.querySelector(".external-layer-status").textContent).toBe(
      "Could not load Crops. Please try again.",
    );

    expect(mocks.addLegend).not.toHaveBeenCalled();
    expect(mocks.addOpacitySlider).not.toHaveBeenCalled();
    for (const call of Object.values(controller)) expect(call).not.toHaveBeenCalled();
  });

  it("shows an external layer's loading and error status", () => {
    const { store, el } = setup(external, { variant: "compact" });
    const status = el.querySelector(".external-layer-status");
    store.set("crops", { desired: true, status: "loading" });
    expect(body(el).hidden).toBe(false);
    expect(status.textContent).toBe("Loading Crops…");

    store.set("crops", { desired: false, status: "error", error: new Error("offline") });
    expect(status.textContent).toBe("Could not load Crops. Please try again.");
    expect(status.classList.contains("is-error")).toBe(true);

    store.set("crops", { desired: true, status: "loading", error: null });
    store.set("crops", { desired: false, status: "idle" });
    expect(body(el).hidden).toBe(true);
    expect(status.hidden).toBe(true);
  });
});
