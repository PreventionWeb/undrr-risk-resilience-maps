import { describe, expect, it, vi } from "vitest";
import { changesUrlState, createLayersStore, mirrorOpenViews, toUrlLayers } from "./layers-store.js";

const OFF = {
  desired: false,
  sourceIdx: 0,
  settings: null,
  applied: false,
  appliedSourceIdx: 0,
  appliedSettings: null,
  viewId: null,
  status: "idle",
  error: null,
};

describe("createLayersStore", () => {
  it("returns an off record for unknown keys without storing it", () => {
    const layers = createLayersStore();
    expect(layers.get("pop")).toEqual({ key: "pop", ...OFF });
    expect(layers.all()).toEqual([]);
  });

  it("returns the same frozen off record for an unknown key every time", () => {
    const layers = createLayersStore();
    const off = layers.get("pop");
    expect(Object.isFrozen(off)).toBe(true);
    expect(layers.get("pop")).toBe(off);
    expect(layers.get("flood")).not.toBe(off);

    const fn = vi.fn();
    layers.subscribe(fn);
    layers.set("pop", { applied: true });
    // The first write's `prev` is that same default.
    expect(fn.mock.calls[0][2]).toBe(off);
  });

  it("does not store or notify a first write equal to the defaults", () => {
    const layers = createLayersStore();
    const fn = vi.fn();
    layers.subscribe(fn);

    const record = layers.set("pop", { desired: false, status: "idle", settings: null });

    expect(record).toBe(layers.get("pop"));
    expect(layers.all()).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("ignores unknown patch fields with a warning", () => {
    const layers = createLayersStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    layers.set("pop", { applied: true, visible: true });
    const unchanged = layers.set("pop", { visible: false });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/unknown field "visible"/);
    warn.mockRestore();
    expect(layers.get("pop")).toEqual({ key: "pop", ...OFF, applied: true });
    expect(unchanged).toBe(layers.get("pop"));
  });

  it("stores settings as a frozen copy and keeps it for equal contents", () => {
    const layers = createLayersStore();
    const settings = { crop: "WHEAT", scenario: "20", extra: { years: [2030] } };
    const fn = vi.fn();
    layers.subscribe(fn);

    const stored = layers.set("crops", { settings }).settings;
    settings.crop = "MAIZE";
    settings.extra.years.push(2050);

    expect(stored).not.toBe(settings);
    expect(stored).toEqual({ crop: "WHEAT", scenario: "20", extra: { years: [2030] } });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.extra.years)).toBe(true);

    // Equal contents in a new object: not a change.
    layers.set("crops", { settings: { crop: "WHEAT", scenario: "20", extra: { years: [2030] } } });
    expect(layers.get("crops").settings).toBe(stored);
    expect(fn).toHaveBeenCalledTimes(1);

    layers.set("crops", { settings: { crop: "MAIZE", scenario: "20" } });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(layers.get("crops").settings).toEqual({ crop: "MAIZE", scenario: "20" });
  });

  it("stores appliedSettings as a frozen copy too", () => {
    const layers = createLayersStore();
    const appliedSettings = { crop: "WHEAT", extra: { years: [2030] } };

    const stored = layers.set("crops", { appliedSettings }).appliedSettings;
    appliedSettings.crop = "MAIZE";

    expect(stored).toEqual({ crop: "WHEAT", extra: { years: [2030] } });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.extra)).toBe(true);
    layers.set("crops", { appliedSettings: { crop: "WHEAT", extra: { years: [2030] } } });
    expect(layers.get("crops").appliedSettings).toBe(stored);
  });

  it("merges patches into the stored record", () => {
    const layers = createLayersStore();
    layers.set("flood", { desired: true, status: "loading" });
    layers.set("flood", { applied: true, viewId: "MX-F100", sourceIdx: 1, status: "idle" });

    expect(layers.get("flood")).toEqual({
      ...OFF,
      key: "flood",
      desired: true,
      applied: true,
      viewId: "MX-F100",
      sourceIdx: 1,
    });
    expect(layers.all()).toEqual([layers.get("flood")]);
  });

  it("stores immutable snapshots", () => {
    const layers = createLayersStore();
    const record = layers.set("pop", { applied: true });
    expect(Object.isFrozen(record)).toBe(true);
    layers.set("pop", { applied: false });
    expect(record.applied).toBe(true);
  });

  it("keeps the key even if a patch tries to change it", () => {
    const layers = createLayersStore();
    layers.set("pop", { key: "other", applied: true });
    expect(layers.get("pop").key).toBe("pop");
    expect(layers.get("other").applied).toBe(false);
  });

  it("notifies subscribers with the key, next and previous record", () => {
    const layers = createLayersStore();
    const fn = vi.fn();
    layers.subscribe(fn);

    layers.set("pop", { applied: true, viewId: "MX-POP" });
    layers.set("pop", { applied: false, viewId: null });

    expect(fn).toHaveBeenCalledTimes(2);
    const [key, next, prev] = fn.mock.calls[0];
    expect(key).toBe("pop");
    expect(prev).toEqual({ key: "pop", ...OFF });
    expect(next).toMatchObject({ applied: true, viewId: "MX-POP" });
    expect(fn.mock.calls[1][2]).toBe(next);
  });

  it("does not notify for a patch that changes nothing", () => {
    const layers = createLayersStore();
    layers.set("pop", { status: "idle" });
    const fn = vi.fn();
    layers.subscribe(fn);

    layers.set("pop", { status: "idle", applied: false });

    expect(fn).not.toHaveBeenCalled();
  });

  it("isolates a throwing subscriber from the others and the caller", () => {
    const layers = createLayersStore();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("SecurityError");
    const before = vi.fn();
    const after = vi.fn();
    layers.subscribe(before);
    layers.subscribe(() => {
      throw failure;
    });
    layers.subscribe(after);

    const record = layers.set("pop", { applied: true });

    expect(record.applied).toBe(true);
    expect(layers.get("pop").applied).toBe(true);
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.any(String), failure);
    error.mockRestore();
  });

  it("stops notifying after unsubscribe", () => {
    const layers = createLayersStore();
    const kept = vi.fn();
    const dropped = vi.fn();
    layers.subscribe(kept);
    const unsubscribe = layers.subscribe(dropped);

    unsubscribe();
    layers.set("pop", { applied: true });

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("lists view ids of layers that are on and carry a view", () => {
    const layers = createLayersStore();
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    layers.set("recovery", { desired: true, status: "loading" });
    layers.set("flood", { applied: true, viewId: null, status: "switching" });
    layers.set("ews", { applied: false, viewId: "MX-EWS" });

    expect(layers.openViewIds()).toEqual(["MX-POP"]);
  });

  it("keeps first-write order when a record is updated", () => {
    const layers = createLayersStore();
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    layers.set("recovery", { applied: true, viewId: "MX-REC" });
    layers.set("pop", { applied: false, viewId: null });
    layers.set("pop", { applied: true, viewId: "MX-POP" });

    expect(layers.all().map((record) => record.key)).toEqual(["pop", "recovery"]);
    expect(layers.openViewIds()).toEqual(["MX-POP", "MX-REC"]);
  });

  it("creates independent instances", () => {
    const a = createLayersStore();
    const b = createLayersStore();
    a.set("pop", { applied: true });
    expect(b.get("pop").applied).toBe(false);
  });
});

describe("mirrorOpenViews", () => {
  it("adds and removes views in the order they change", () => {
    const layers = createLayersStore();
    const openViews = new Set();
    mirrorOpenViews(layers, openViews);

    layers.set("flood", { applied: true, viewId: "MX-F10" });
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    // Source switch: the old view leaves first, the new one joins at the end.
    layers.set("flood", { viewId: null });
    expect([...openViews]).toEqual(["MX-POP"]);
    layers.set("flood", { viewId: "MX-F100", sourceIdx: 1 });
    expect([...openViews]).toEqual(["MX-POP", "MX-F100"]);

    layers.set("pop", { applied: false, viewId: null });
    expect([...openViews]).toEqual(["MX-F100"]);
  });

  it("ignores status-only changes and stops after unsubscribe", () => {
    const layers = createLayersStore();
    const openViews = new Set(["MX-OTHER"]);
    const unsubscribe = mirrorOpenViews(layers, openViews);

    layers.set("pop", { desired: true, status: "loading" });
    expect([...openViews]).toEqual(["MX-OTHER"]);

    unsubscribe();
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    expect([...openViews]).toEqual(["MX-OTHER"]);
  });
});

describe("changesUrlState", () => {
  const on = { key: "flood", ...OFF, applied: true, viewId: "MX-F10" };

  it("is true when on/off or the applied source or settings change", () => {
    expect(changesUrlState(on, { ...on, applied: false })).toBe(true);
    expect(changesUrlState({ ...on, appliedSourceIdx: 1 }, on)).toBe(true);
    expect(changesUrlState({ ...on, appliedSettings: { crop: "MAIZE" } }, on)).toBe(true);
  });

  it("is false for status, intent and the transient view gap of a source switch", () => {
    expect(changesUrlState({ ...on, status: "switching" }, on)).toBe(false);
    expect(changesUrlState({ ...on, desired: false }, on)).toBe(false);
    expect(changesUrlState({ ...on, sourceIdx: 1 }, on)).toBe(false);
    expect(changesUrlState({ ...on, settings: { crop: "MAIZE" } }, on)).toBe(false);
    expect(changesUrlState({ ...on, viewId: null }, on)).toBe(false);
  });

  it("is true when a layer that stayed on gets a view back", () => {
    // During a source switch the layer is on with no view, so a hash written
    // then (by another layer) leaves it out; it must come back once a view
    // carries it again, even if the applied source did not change (a rollback).
    const viewless = { ...on, viewId: null };
    expect(changesUrlState(on, viewless)).toBe(true);
    // Not for a layer that is off.
    expect(changesUrlState({ ...OFF, key: "flood", viewId: "MX-F10" }, { ...OFF, key: "flood" })).toBe(false);
  });
});

describe("toUrlLayers", () => {
  it("lists layers that are on, in config order, with settings only when set", () => {
    const layers = createLayersStore();
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    layers.set("crops", { applied: true, viewId: "MX-GJ-1", appliedSettings: { crop: "WHEAT" } });
    // The URL follows what MapX shows, not a source switch still in flight.
    layers.set("flood", { applied: true, viewId: "MX-F100", appliedSourceIdx: 1, sourceIdx: 2 });
    layers.set("recovery", { desired: true, status: "loading" });
    layers.set("unknown", { applied: true, viewId: "MX-X" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toUrlLayers(layers.all(), ["recovery", "flood", "crops", "pop"])).toEqual([
      { key: "flood", sourceIdx: 1 },
      { key: "crops", sourceIdx: 0, settings: { crop: "WHEAT" } },
      { key: "pop", sourceIdx: 0 },
    ]);
    warn.mockRestore();
  });

  it("requires a key order", () => {
    expect(() => toUrlLayers([], undefined)).toThrow(TypeError);
  });

  it("leaves out a layer missing from the key order and warns once per key", () => {
    const layers = createLayersStore();
    layers.set("pop", { applied: true, viewId: "MX-POP" });
    layers.set("stray-layer", { applied: true, viewId: "MX-STRAY" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toUrlLayers(layers.all(), ["pop"])).toEqual([{ key: "pop", sourceIdx: 0 }]);
    expect(toUrlLayers(layers.all(), ["pop"])).toEqual([{ key: "pop", sourceIdx: 0 }]);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/"stray-layer"/);
    warn.mockRestore();
  });

  it("leaves out a layer mid source-switch, as the openViews walk did", () => {
    const layers = createLayersStore();
    layers.set("flood", { applied: true, viewId: null, appliedSourceIdx: 1 });
    expect(toUrlLayers(layers.all(), ["flood"])).toEqual([]);
  });
});
