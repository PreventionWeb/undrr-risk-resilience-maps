import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMapLoading, MAP_LOADING_DELAY_MS } from "./map-loading.js";

describe("initial map feedback", () => {
  let loading;
  let map;
  let frame;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="app-map"><div data-ui="mapx"></div></div>';
    map = document.querySelector(".app-map");
    frame = map.firstElementChild;
  });
  afterEach(() => {
    loading?.destroy();
    vi.useRealTimers();
  });

  it("delays feedback, marks only the map frame busy and reports completion", async () => {
    loading = createMapLoading(map, frame);
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(map.hasAttribute("aria-busy")).toBe(false);
    expect(map.querySelector(".map-loading").hidden).toBe(true);
    const live = map.querySelector('[role="status"]');
    expect(live.textContent).toBe("");
    await vi.advanceTimersByTimeAsync(MAP_LOADING_DELAY_MS);
    expect(map.querySelector(".map-loading").hidden).toBe(false);
    expect(map.querySelector(".mg-loader").getAttribute("aria-hidden")).toBe("true");
    expect(live.textContent).toBe("Loading map…");
    loading.finish();
    expect(map.querySelector(".map-loading")).toBeNull();
    expect(frame.hasAttribute("aria-busy")).toBe(false);
    expect(live.textContent).toBe("Map ready.");
  });

  it("never flashes feedback for a fast map or after destroy", async () => {
    loading = createMapLoading(map, frame);
    loading.finish();
    loading.destroy();
    await vi.advanceTimersByTimeAsync(MAP_LOADING_DELAY_MS);
    expect(map.children).toHaveLength(1);
  });

  it("leaves failure announcements to the service notice", async () => {
    loading = createMapLoading(map, frame);
    await vi.advanceTimersByTimeAsync(MAP_LOADING_DELAY_MS);
    loading.finish({ failed: true });
    expect(map.querySelector('[role="status"]').textContent).toBe("");
    expect(map.querySelector(".map-loading")).toBeNull();
    expect(frame.hasAttribute("aria-busy")).toBe(false);
  });

  it("does not announce completion of an invisible warm-up", async () => {
    map.setAttribute("aria-hidden", "true");
    loading = createMapLoading(map, frame);
    await vi.advanceTimersByTimeAsync(MAP_LOADING_DELAY_MS);
    loading.finish();
    expect(map.querySelector('[role="status"]').textContent).toBe("");
  });

  it("restores the frame's existing busy state on teardown", () => {
    frame.setAttribute("aria-busy", "false");
    loading = createMapLoading(map, frame);
    loading.destroy();
    expect(frame.getAttribute("aria-busy")).toBe("false");
  });

  it("provides an in-panel mobile status only when a panel header exists", async () => {
    const panel = document.createElement("div");
    panel.dataset.ui = "layer-panel";
    panel.innerHTML = '<div class="layer-panel-header"></div><div class="layer-panel-body"></div>';
    map.append(panel);
    loading = createMapLoading(map, frame);
    expect(map.querySelector(".map-loading--floating").classList.contains("map-loading--with-panel")).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(MAP_LOADING_DELAY_MS);
    const pending = panel.querySelector(".map-loading--panel");
    expect(pending.previousElementSibling.className).toBe("layer-panel-header");
    expect(pending.hidden).toBe(false);
    expect(pending.textContent).toBe("Loading map…");
    loading.finish();
    expect(panel.querySelector(".map-loading--panel")).toBeNull();
  });

  it("keeps the floating fallback for a root without a panel header", () => {
    loading = createMapLoading(map, frame);
    expect(map.querySelector(".map-loading--floating").classList.contains("map-loading--with-panel")).toBe(
      false,
    );
    expect(map.querySelector(".map-loading--panel")).toBeNull();
  });
});
