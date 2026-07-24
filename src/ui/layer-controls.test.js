import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("../sdk/filters.js", () => ({
  getViewLayerTransparency: vi.fn(),
  setViewLayerTransparency: vi.fn(),
}));
vi.mock("../sdk/views.js", () => ({
  getViewLegendImage: vi.fn(),
}));
vi.mock("../sdk/legends.js", () => ({
  resolveMapXLegend: vi.fn(),
}));

import { getViewLayerTransparency, setViewLayerTransparency } from "../sdk/filters.js";
import { getViewLegendImage } from "../sdk/views.js";
import { resolveMapXLegend } from "../sdk/legends.js";
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
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── addLegend ────────────────────────────────────────────────────────────────
describe("addLegend", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    vi.resetAllMocks();
    resolveMapXLegend.mockResolvedValue({ legend: null, reason: "unsupported-style" });
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
    expect(swatch.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("uses #ccc fallback for a missing color", async () => {
    getViewLegendImage.mockResolvedValue(null);
    const layer = { id: "v", legend: [{ label: "X" }] };
    await addLegend(layer, container);
    const swatch = container.querySelector(".html-legend-swatch");
    expect(swatch.style.backgroundColor).toBe("rgb(204, 204, 204)");
  });

  it("shows and labels the SDK legend image directly when no local legend", async () => {
    getViewLegendImage.mockResolvedValue("data:image/png;base64,abc==");
    await addLegend({ id: "view-1", type: "rt" }, container);
    const img = container.querySelector(".layer-legend-img");
    expect(img).not.toBeNull();
    expect(img.src).toContain("data:image/png");
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector(".legend-image-fallback-label").textContent).toBe(
      "MapX image legend (raster)",
    );
  });

  it("renders structured MapX rules as the default legend", async () => {
    resolveMapXLegend.mockResolvedValue({
      legend: {
        title: "Risk level",
        entries: [
          {
            color: "#f00",
            label: "High",
            opacity: 0.7,
            geometry: "point",
            size: 12,
          },
        ],
      },
      reason: null,
    });
    getViewLegendImage.mockResolvedValue("data:image/png;base64,abc==");

    await addLegend({ id: "view-1", type: "vt" }, container);

    expect(container.querySelector(".html-legend-title").textContent).toBe("Risk level");
    expect(container.querySelector(".html-legend-label").textContent).toBe("High");
    expect(container.querySelector(".html-legend-swatch--point")).not.toBeNull();
    expect(container.querySelector("details.legend-diagnostic").open).toBe(false);
    expect(container.querySelector("details summary").textContent).toBe(
      "Show MapX image legend (comparison)",
    );
    expect(getViewLegendImage).not.toHaveBeenCalled();
  });

  it("uses the PNG fallback when no structured MapX legend is available", async () => {
    resolveMapXLegend.mockResolvedValue({ legend: null, reason: "custom-style" });
    getViewLegendImage.mockResolvedValue("fallback");

    await addLegend({ id: "view-1", type: "vt" }, container);

    expect(container.querySelector(".html-legend")).toBeNull();
    expect(container.querySelector(".layer-legend-img")).not.toBeNull();
    expect(container.querySelector(".legend-image-fallback-label").textContent).toBe(
      "MapX image legend (custom style)",
    );
  });

  it("lazy-loads the MapX image when its structured-legend comparison is opened", async () => {
    getViewLegendImage.mockResolvedValue("data:image/png;base64,abc==");
    await addLegend(simpleLayer, container);
    const details = container.querySelector("details.legend-diagnostic");
    expect(details).not.toBeNull();
    expect(details.querySelector("summary").textContent).toBe("Show MapX image legend (comparison)");
    expect(getViewLegendImage).not.toHaveBeenCalled();

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() => expect(details.querySelector("img")).not.toBeNull());

    expect(getViewLegendImage).toHaveBeenCalledTimes(1);
    expect(getViewLegendImage).toHaveBeenCalledWith("view-1");
  });

  it("shows a non-fatal message when a comparison image is unavailable", async () => {
    getViewLegendImage.mockResolvedValue(null);
    await addLegend(simpleLayer, container);
    const details = container.querySelector("details.legend-diagnostic");

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() =>
      expect(details.querySelector(".legend-diagnostic-status").textContent).toBe(
        "MapX image legend is not available.",
      ),
    );
  });

  it("does not commit a stale async legend after its slot is cleared and reused", async () => {
    let resolveFirst;
    resolveMapXLegend
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        legend: {
          title: "Current",
          entries: [
            {
              color: "#0f0",
              label: "Current rule",
              opacity: 1,
              geometry: "polygon",
              size: null,
              borderColor: null,
            },
          ],
        },
        reason: null,
      });

    const staleRender = addLegend({ id: "old", type: "vt" }, container);
    container.replaceChildren();
    await addLegend({ id: "new", type: "vt" }, container);
    resolveFirst({
      legend: {
        title: "Stale",
        entries: [
          {
            color: "#f00",
            label: "Stale rule",
            opacity: 1,
            geometry: "polygon",
            size: null,
            borderColor: null,
          },
        ],
      },
      reason: null,
    });
    await staleRender;

    expect(container.querySelector(".html-legend-title").textContent).toBe("Current");
    expect(container.textContent).toContain("Current rule");
    expect(container.textContent).not.toContain("Stale");
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
