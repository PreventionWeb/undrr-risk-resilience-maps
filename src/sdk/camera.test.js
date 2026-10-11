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

  /** An SDK that fits like MapX: max bounds, cameraForBounds, then a move. */
  const fittingSdk = (extra = {}) =>
    fakeSdk({
      map_get_max_bounds_array: null,
      map: ({ method, parameters: [bounds] }) =>
        method === "cameraForBounds"
          ? {
              center: { lng: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 },
              zoom: 5,
              bearing: 0,
            }
          : true,
      common_loc_get_bbox: ({ code }) => ({ KEN: [33.9, -4.7, 41.9, 5.0] })[code] ?? null,
      ...extra,
    });

  it("fits a box by computing the camera and jumping, or flying when asked", async () => {
    const sdk = fittingSdk();
    const camera = createCamera(() => sdk);
    await camera.fitBounds([0, 0, 10, 10]);
    await camera.fitBounds([0, 0, 10, 10], { animate: true });
    expect(sdk.ask.mock.calls.map(([method]) => method)).toEqual([
      "map_get_max_bounds_array",
      "map",
      "map_jump_to",
      "map_get_max_bounds_array",
      "map",
      "map_fly_to",
    ]);
    expect(sdk.ask).toHaveBeenCalledWith("map", { method: "cameraForBounds", parameters: [[0, 0, 10, 10]] });
    expect(sdk.ask).toHaveBeenCalledWith("map_jump_to", { center: { lng: 5, lat: 5 }, zoom: 5 });
    expect(sdk.ask).toHaveBeenCalledWith("map_fly_to", {
      center: { lng: 5, lat: 5 },
      zoom: 5,
      duration: FLY_DURATION_MS,
    });
    // Never MapX's own fitting resolvers: one answers before the camera lands,
    // the other never answers without animation.
    const used = sdk.ask.mock.calls.map(([method]) => method);
    expect(used).not.toContain("map_set_bounds_array");
    expect(used).not.toContain("common_loc_fit_bbox");
  });

  it("refuses a box outside the map's max bounds, without moving", async () => {
    const sdk = fittingSdk({ map_get_max_bounds_array: [-30, -40, 60, 40] });
    const camera = createCamera(() => sdk);
    await expect(camera.fitBounds([50, 0, 70, 10])).rejects.toMatchObject({ code: "out-of-bounds" });
    expect(sdk.ask.mock.calls.map(([method]) => method)).toEqual(["map_get_max_bounds_array"]);
    await camera.fitBounds([0, 0, 10, 10]);
    expect(sdk.ask).toHaveBeenCalledWith("map_jump_to", expect.anything());
  });

  it("is camera-failed when MapX cannot compute a camera for the box", async () => {
    const sdk = fittingSdk({ map: undefined });
    await expect(createCamera(() => sdk).fitBounds([0, 0, 10, 10])).rejects.toMatchObject({
      code: "camera-failed",
    });
  });

  it("fits an area from its MapX box, by the same path as a box", async () => {
    const sdk = fittingSdk();
    await createCamera(() => sdk).fitArea("KEN", { animate: true });
    expect(sdk.ask).toHaveBeenCalledWith("common_loc_get_bbox", { code: "KEN" });
    expect(sdk.ask).toHaveBeenCalledWith("map", {
      method: "cameraForBounds",
      parameters: [[33.9, -4.7, 41.9, 5.0]],
    });
    expect(sdk.ask.mock.calls.at(-1)[0]).toBe("map_fly_to");
  });

  it("reports a code MapX answers null for as unknown-area, at once and without moving", async () => {
    const sdk = fittingSdk();
    await expect(createCamera(() => sdk).fitArea("XYZ")).rejects.toMatchObject({ code: "unknown-area" });
    expect(sdk.ask.mock.calls.map(([method]) => method)).toEqual(["common_loc_get_bbox"]);
  });

  it("keeps a timeout a timeout, not an unknown area", async () => {
    vi.useFakeTimers();
    const hanging = createCamera(() => ({ ask: never }), { timeoutMs: 100 }).fitArea("KEN");
    const assertion = expect(hanging).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("names no MapX method in a message a host will read, but keeps it for the console", async () => {
    const sdk = { ask: vi.fn().mockRejectedValue(new Error("resolver failed")) };
    const error = await createCamera(() => sdk)
      .setView({ zoom: 2 })
      .catch((caught) => caught);
    expect(error.message).not.toMatch(/map_|MX-/);
    expect(error.method).toBe("map_jump_to");
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

  it("remembers a summary that timed out, rather than taking another request slot", async () => {
    vi.useFakeTimers();
    const ask = vi.fn(never);
    const camera = createCamera(() => ({ ask }), { extentTimeoutMs: 200 });
    const first = camera.viewExtent("MX-RT");
    const assertion = expect(first).rejects.toMatchObject({ code: "no-extent" });
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    await expect(camera.viewExtent("MX-RT")).rejects.toMatchObject({ code: "no-extent" });
    expect(ask).toHaveBeenCalledTimes(1);
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
