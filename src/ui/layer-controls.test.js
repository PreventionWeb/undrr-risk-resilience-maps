import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../sdk/filters.js", () => ({
  getViewLayerTransparency: vi.fn(),
  setViewLayerTransparency: vi.fn(),
}));
vi.mock("../sdk/views.js", () => ({
  getViewLegendImage: vi.fn(),
}));

import { getViewLayerTransparency, setViewLayerTransparency } from "../sdk/filters.js";
import { getViewLegendImage } from "../sdk/views.js";
import { addOpacitySlider, addLegend } from "./layer-controls.js";

// ─── addOpacitySlider ─────────────────────────────────────────────────────────
describe("addOpacitySlider", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    vi.resetAllMocks();
  });

  it("appends an opacity slider row to the container", async () => {
    getViewLayerTransparency.mockResolvedValue(0);
    await addOpacitySlider("view-1", container);
    expect(container.querySelector("input[type=range]")).not.toBeNull();
  });

  it("defaults slider to 100 when SDK returns transparency 0 (fully opaque)", async () => {
    getViewLayerTransparency.mockResolvedValue(0);
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    expect(slider.value).toBe("100");
  });

  it("converts SDK transparency to UI opacity (opacity = 100 - transparency)", async () => {
    getViewLayerTransparency.mockResolvedValue(40);
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    expect(slider.value).toBe("60");
  });

  it("shows the current opacity in the value display span", async () => {
    getViewLayerTransparency.mockResolvedValue(25);
    await addOpacitySlider("view-1", container);
    const display = container.querySelector(".opacity-value");
    expect(display.textContent).toBe("75%");
  });

  it("defaults to 100% opacity when SDK call throws", async () => {
    getViewLayerTransparency.mockRejectedValue(new Error("SDK error"));
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    expect(slider.value).toBe("100");
  });

  it("calls setViewLayerTransparency with inverted value on input event", async () => {
    getViewLayerTransparency.mockResolvedValue(0);
    setViewLayerTransparency.mockResolvedValue(undefined);
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    slider.value = "70";
    slider.dispatchEvent(new Event("input"));
    // Give the async handler a tick to run
    await Promise.resolve();
    expect(setViewLayerTransparency).toHaveBeenCalledWith("view-1", 30);
  });

  it("updates the display span on slider input", async () => {
    getViewLayerTransparency.mockResolvedValue(0);
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    const display = container.querySelector(".opacity-value");
    slider.value = "55";
    slider.dispatchEvent(new Event("input"));
    expect(display.textContent).toBe("55%");
  });

  it("does not throw when setViewLayerTransparency rejects on input", async () => {
    getViewLayerTransparency.mockResolvedValue(0);
    setViewLayerTransparency.mockRejectedValue(new Error("SDK write error"));
    await addOpacitySlider("view-1", container);
    const slider = container.querySelector("input[type=range]");
    slider.value = "80";
    // Should not throw
    await expect(
      new Promise((resolve) => {
        slider.dispatchEvent(new Event("input"));
        setTimeout(resolve, 0);
      })
    ).resolves.toBeUndefined();
  });
});

// ─── addLegend ────────────────────────────────────────────────────────────────
describe("addLegend", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    vi.resetAllMocks();
  });

  const simpleLayer = {
    id: "view-1",
    legend: [
      { color: "#f00", label: "High" },
      { color: "#0f0", label: "Low" },
    ],
  };

  it("renders HTML swatches when layer has a local legend", async () => {
    getViewLegendImage.mockResolvedValue(null);
    await addLegend(simpleLayer, container);
    const swatches = container.querySelectorAll(".html-legend-swatch");
    expect(swatches).toHaveLength(2);
  });

  it("renders correct label text for each legend entry", async () => {
    getViewLegendImage.mockResolvedValue(null);
    await addLegend(simpleLayer, container);
    const labels = [...container.querySelectorAll(".html-legend-label")].map((el) => el.textContent);
    expect(labels).toEqual(["High", "Low"]);
  });

  it("sets swatch background color from legend item", async () => {
    getViewLegendImage.mockResolvedValue(null);
    await addLegend(simpleLayer, container);
    const swatch = container.querySelector(".html-legend-swatch");
    expect(swatch.style.background).toBe("rgb(255, 0, 0)");
  });

  it("uses #ccc fallback for a missing color", async () => {
    getViewLegendImage.mockResolvedValue(null);
    const layer = { id: "v", legend: [{ label: "X" }] };
    await addLegend(layer, container);
    const swatch = container.querySelector(".html-legend-swatch");
    expect(swatch.style.background).toBe("rgb(204, 204, 204)");
  });

  it("shows SDK legend image directly when no local legend", async () => {
    getViewLegendImage.mockResolvedValue("data:image/png;base64,abc==");
    await addLegend({ id: "view-1" }, container);
    const img = container.querySelector(".layer-legend-img");
    expect(img).not.toBeNull();
    expect(img.src).toContain("data:image/png");
    expect(container.querySelector("details")).toBeNull();
  });

  it("wraps SDK image in a collapsed <details> diagnostic when local legend exists", async () => {
    getViewLegendImage.mockResolvedValue("data:image/png;base64,abc==");
    await addLegend(simpleLayer, container);
    const details = container.querySelector("details.legend-diagnostic");
    expect(details).not.toBeNull();
    expect(details.querySelector("img")).not.toBeNull();
  });

  it("prepends data URI prefix when SDK returns raw base64", async () => {
    getViewLegendImage.mockResolvedValue("rawbase64==");
    await addLegend({ id: "view-1" }, container);
    const img = container.querySelector(".layer-legend-img");
    expect(img.src).toMatch(/^data:image\/png;base64,/);
  });

  it("does not throw or render an image when SDK returns null", async () => {
    getViewLegendImage.mockResolvedValue(null);
    await addLegend({ id: "view-1" }, container);
    expect(container.querySelector(".layer-legend-img")).toBeNull();
  });

  it("does not throw when SDK call rejects", async () => {
    getViewLegendImage.mockRejectedValue(new Error("no legend"));
    await expect(addLegend({ id: "view-1" }, container)).resolves.toBeUndefined();
  });

  it("does not render an SDK image when SDK returns an empty string", async () => {
    getViewLegendImage.mockResolvedValue("");
    await addLegend({ id: "view-1" }, container);
    expect(container.querySelector(".layer-legend-img")).toBeNull();
  });
});
