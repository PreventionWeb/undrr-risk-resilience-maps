import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import {
  initInspection,
  enableInspection,
  disableInspection,
  isInspectionActive,
  onInspectionResult,
  handleFeaturesEvent,
} from "./inspect.js";

const mockMapx = { ask: vi.fn().mockResolvedValue(undefined) };

/**
 * Subscribing returns a disposer, so each test's subscribers are removed after
 * it instead of being replaced by the next registration.
 */
let unsubscribers = [];
function subscribe(cb, options) {
  const off = onInspectionResult(cb, options);
  unsubscribers.push(off);
  return off;
}

beforeEach(() => {
  initInspection(mockMapx);
  disableInspection();
  mockMapx.ask.mockClear();
});

afterEach(() => {
  for (const off of unsubscribers.splice(0)) off();
});

describe("initial state", () => {
  it("is inactive after reset", () => {
    expect(isInspectionActive()).toBe(false);
  });
});

describe("enableInspection / disableInspection", () => {
  it("becomes active on enable", () => {
    enableInspection();
    expect(isInspectionActive()).toBe(true);
  });

  it("becomes inactive on disable", () => {
    enableInspection();
    disableInspection();
    expect(isInspectionActive()).toBe(false);
  });

  it("does not call set_features_click_sdk_only in dev mode (DEV=true in test env)", () => {
    enableInspection();
    expect(mockMapx.ask).not.toHaveBeenCalledWith("set_features_click_sdk_only", expect.anything());
  });

  it("does not call set_features_click_sdk_only on disable in dev mode", () => {
    enableInspection();
    mockMapx.ask.mockClear();
    disableInspection();
    expect(mockMapx.ask).not.toHaveBeenCalledWith("set_features_click_sdk_only", expect.anything());
  });
});

describe("onInspectionResult subscribers", () => {
  const click = () =>
    handleFeaturesEvent(
      { attributes: { "view-1": [{ a: 1 }] }, lngLat: { lat: 1, lng: 2 } },
      new Set(["view-1"]),
    );

  it("calls every subscriber in registration order, instead of replacing the first", () => {
    const calls = [];
    const first = vi.fn(() => calls.push("first"));
    const second = vi.fn(() => calls.push("second"));
    subscribe(first);
    subscribe(second);
    enableInspection();

    click();

    expect(calls).toEqual(["first", "second"]);
    expect(first).toHaveBeenCalledOnce();
    expect(second.mock.calls[0][0]).toMatchObject({ views: { "view-1": [{ a: 1 }] } });
  });

  it("registers a callback once, however often it is passed", () => {
    const cb = vi.fn();
    subscribe(cb);
    subscribe(cb);
    enableInspection();

    click();

    expect(cb).toHaveBeenCalledOnce();
  });

  it("stops calling a subscriber that used its disposer, and leaves the others", () => {
    const stays = vi.fn();
    const goes = vi.fn();
    subscribe(stays);
    const off = subscribe(goes);
    enableInspection();

    off();
    off(); // idempotent
    click();

    expect(goes).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledOnce();
  });

  it("unsubscribes when the caller's signal aborts, and never subscribes an aborted one", () => {
    const aborting = vi.fn();
    const alreadyAborted = vi.fn();
    const listeners = new AbortController();
    subscribe(aborting, { signal: listeners.signal });
    const done = new AbortController();
    done.abort();
    subscribe(alreadyAborted, { signal: done.signal });
    enableInspection();

    listeners.abort();
    click();

    expect(aborting).not.toHaveBeenCalled();
    expect(alreadyAborted).not.toHaveBeenCalled();
  });

  it("ignores anything that is not a function", () => {
    expect(() => subscribe(null)).not.toThrow();
    expect(() => subscribe(undefined)).not.toThrow();
    enableInspection();
    expect(() => click()).not.toThrow();
  });

  it("drops the previous run's subscribers when initInspection runs again", () => {
    const old = vi.fn();
    subscribe(old);
    enableInspection();

    // A second run: HMR, a second embed, or a UI that was torn down. Its
    // subscribers would otherwise keep delivering into a detached panel.
    initInspection(mockMapx);
    enableInspection();
    click();

    expect(old).not.toHaveBeenCalled();
  });

  it("keeps calling the other subscribers when one of them throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = vi.fn(() => {
      throw new Error("panel gone");
    });
    const second = vi.fn();
    subscribe(first);
    subscribe(second);
    enableInspection();

    expect(() => click()).not.toThrow();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("delivers a click to the subscribers registered when it arrived", () => {
    const late = vi.fn();
    const early = vi.fn(() => subscribe(late));
    subscribe(early);
    enableInspection();

    click();

    expect(early).toHaveBeenCalledOnce();
    // The snapshot is taken before delivery, so `late` only hears the next click.
    expect(late).not.toHaveBeenCalled();
    click();
    expect(late).toHaveBeenCalledOnce();
  });
});

describe("handleFeaturesEvent (MapX 1.14.2+ click_features #1139)", () => {
  it("drops events while inspection is inactive", () => {
    const cb = vi.fn();
    subscribe(cb);
    handleFeaturesEvent({ attributes: { "MX-TEST": [{ name: "Feature" }] } }, new Set(["MX-TEST"]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("delivers multi-view results to subscribers in a single tick", () => {
    const cb = vi.fn();
    subscribe(cb);
    enableInspection();

    const lngLat = { lng: 12.34, lat: 56.78 };
    handleFeaturesEvent(
      {
        lngLat,
        attributes: {
          "MX-VIEW-1": [{ id: 1, hazard: "flood" }],
          "MX-VIEW-2": [{ id: 2, vulnerability: "high" }],
        },
      },
      new Set(["MX-VIEW-1", "MX-VIEW-2"]),
    );

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      lngLat,
      views: {
        "MX-VIEW-1": [{ id: 1, hazard: "flood" }],
        "MX-VIEW-2": [{ id: 2, vulnerability: "high" }],
      },
      openViewsSnapshot: new Set(["MX-VIEW-1", "MX-VIEW-2"]),
    });
  });

  it("reports every open view on an empty click, as click_attributes did", () => {
    const cb = vi.fn();
    subscribe(cb);
    enableInspection();

    handleFeaturesEvent({ lngLat: { lng: 0, lat: 0 }, attributes: {} }, new Set(["MX-VIEW-1"]));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith({
      lngLat: { lng: 0, lat: 0 },
      views: { "MX-VIEW-1": [] },
      openViewsSnapshot: new Set(["MX-VIEW-1"]),
    });
  });

  it("reports an open view that missed as queried with no features", () => {
    // MapX leaves views with no hit out of `attributes`. The site inspector
    // reads a view absent from the result as not queried (a raster then shows
    // as "not queryable"), so a miss has to come through as [].
    const cb = vi.fn();
    subscribe(cb);
    enableInspection();

    handleFeaturesEvent(
      { lngLat: { lng: 1, lat: 1 }, attributes: { "MX-HIT": [{ name: "A" }] } },
      new Set(["MX-HIT", "MX-RASTER-MISS"]),
    );

    expect(cb.mock.calls[0][0].views).toEqual({ "MX-HIT": [{ name: "A" }], "MX-RASTER-MISS": [] });
  });

  it("isolates throwing subscribers", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const faulty = vi.fn(() => {
      throw new Error("subscriber crash");
    });
    const good = vi.fn();
    subscribe(faulty);
    subscribe(good);
    enableInspection();

    expect(() => handleFeaturesEvent({ attributes: {} }, new Set())).not.toThrow();
    expect(faulty).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
