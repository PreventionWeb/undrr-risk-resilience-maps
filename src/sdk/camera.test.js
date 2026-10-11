import { afterEach, describe, expect, it, vi } from "vitest";
import { askWithTimeout, CameraError, createCamera, FLY_DURATION_MS } from "./camera.js";

/** An SDK whose `ask` answers from a table; a function value is called with the params. */
function fakeSdk(table = {}) {
  return {
    ask: vi.fn(async (method, params) => {
      if (!(method in table)) return true;
      const value = table[method];
      return typeof value === "function" ? value(params) : value;
    }),
  };
}

/** A promise that never settles, as `Manager.ask()` does when a resolver fails (MapX ≤ 1.14.0). */
const never = () => new Promise(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("askWithTimeout", () => {
  it("resolves with the SDK's answer", async () => {
    await expect(askWithTimeout(fakeSdk({ map_get_zoom: 3 }), "map_get_zoom")).resolves.toBe(3);
  });

  it("rejects with a timeout CameraError when the SDK never answers", async () => {
    vi.useFakeTimers();
    const pending = askWithTimeout({ ask: never }, "map_fly_to", {}, 500);
    const assertion = expect(pending).rejects.toMatchObject({ name: "CameraError", code: "timeout" });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("clears its timer once the call settles", async () => {
    vi.useFakeTimers();
    await askWithTimeout(fakeSdk(), "map_get_zoom", {}, 500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns a synchronous throw into a rejection", async () => {
    const sdk = {
      ask: () => {
        throw new Error("boom");
      },
    };
    await expect(askWithTimeout(sdk, "map_get_zoom")).rejects.toThrow("boom");
  });
});

describe("createCamera", () => {
  it("is not-ready without an SDK", async () => {
    await expect(createCamera(() => null).getView()).rejects.toMatchObject({ code: "not-ready" });
  });

  it("wraps an SDK failure as camera-failed", async () => {
    const sdk = { ask: vi.fn().mockRejectedValue(new Error("resolver failed")) };
    await expect(createCamera(() => sdk).setView({ zoom: 2 })).rejects.toMatchObject({
      code: "camera-failed",
    });
  });

  it("reads center, zoom and bounds, accepting an [lng, lat] centre", async () => {
    const sdk = fakeSdk({ map_get_center: [10, 45], map_get_zoom: 4, map_get_bounds_array: [0, 40, 20, 50] });
    await expect(createCamera(() => sdk).getView()).resolves.toEqual({
      center: { lng: 10, lat: 45 },
      zoom: 4,
      bounds: [0, 40, 20, 50],
    });
  });

  it("keeps an animated move inside MapX's 10 s resolver limit", async () => {
    const sdk = fakeSdk();
    await createCamera(() => sdk).setView({ center: { lng: 1, lat: 2 }, animate: true });
    expect(sdk.ask).toHaveBeenCalledWith("map_fly_to", {
      center: { lng: 1, lat: 2 },
      duration: FLY_DURATION_MS,
    });
    expect(FLY_DURATION_MS).toBeLessThan(10_000);
  });

  it("fits an area with no animation unless asked", async () => {
    const sdk = fakeSdk();
    const camera = createCamera(() => sdk);
    await camera.fitArea("KEN");
    await camera.fitArea("m49_014", { animate: true });
    expect(sdk.ask.mock.calls).toEqual([
      ["common_loc_fit_bbox", { code: "KEN", param: { duration: 0 } }],
      ["common_loc_fit_bbox", { code: "m49_014", param: { duration: FLY_DURATION_MS } }],
    ]);
  });

  it("reports an area MapX rejects, or never answers for, as unknown-area", async () => {
    vi.useFakeTimers();
    const rejecting = { ask: vi.fn().mockRejectedValue(new Error("unknown code")) };
    await expect(createCamera(() => rejecting).fitArea("XYZ")).rejects.toMatchObject({
      code: "unknown-area",
    });

    const hanging = createCamera(() => ({ ask: never }), { timeoutMs: 100 }).fitArea("XYZ");
    const assertion = expect(hanging).rejects.toMatchObject({ code: "unknown-area" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("caches a view's extent, and forgets a failure so the next fit can retry", async () => {
    let calls = 0;
    const sdk = fakeSdk({
      get_view_source_summary: () => {
        calls += 1;
        if (calls === 1) throw new Error("WMS failed");
        return { extent_sp: { lng1: -10, lat1: -5, lng2: 30, lat2: 25 } };
      },
    });
    const camera = createCamera(() => sdk);

    await expect(camera.viewExtent("MX-1")).rejects.toMatchObject({ code: "no-extent" });
    await expect(camera.viewExtent("MX-1")).resolves.toEqual([-10, -5, 30, 25]);
    await expect(camera.viewExtent("MX-1")).resolves.toEqual([-10, -5, 30, 25]);
    expect(calls).toBe(2);
  });

  it("gives up on a raster view whose summary hangs, as no-extent", async () => {
    vi.useFakeTimers();
    const camera = createCamera(() => ({ ask: never }), { extentTimeoutMs: 200 });
    const pending = camera.viewExtent("MX-RT");
    const assertion = expect(pending).rejects.toBeInstanceOf(CameraError);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    await expect(pending).rejects.toMatchObject({ code: "no-extent" });
  });
});
