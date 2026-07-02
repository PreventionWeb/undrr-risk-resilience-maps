import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store.js";

beforeEach(() => {
  store.openViews.clear();
  store.setActiveTab("home");
});

// ---------------------------------------------------------------------------
// openViews
// ---------------------------------------------------------------------------

describe("openViews", () => {
  it("starts empty", () => {
    expect(store.openViews.size).toBe(0);
  });

  it("tracks added and removed view IDs", () => {
    store.openViews.add("view-a");
    store.openViews.add("view-b");
    expect(store.openViews.has("view-a")).toBe(true);
    expect(store.openViews.size).toBe(2);

    store.openViews.delete("view-a");
    expect(store.openViews.has("view-a")).toBe(false);
    expect(store.openViews.size).toBe(1);
  });

  it("deduplicates view IDs", () => {
    store.openViews.add("view-a");
    store.openViews.add("view-a");
    expect(store.openViews.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// activeTab
// ---------------------------------------------------------------------------

describe("activeTab", () => {
  it("defaults to home", () => {
    expect(store.activeTab).toBe("home");
  });

  it("updates via setActiveTab", () => {
    store.setActiveTab("hazard");
    expect(store.activeTab).toBe("hazard");
  });
});

// ---------------------------------------------------------------------------
// active source index (compound layers)
// ---------------------------------------------------------------------------

describe("getActiveSource / setActiveSource", () => {
  it("defaults to 0 for unknown keys", () => {
    expect(store.getActiveSource("never-set")).toBe(0);
  });

  it("returns the index set for a key", () => {
    store.setActiveSource("flood", 2);
    expect(store.getActiveSource("flood")).toBe(2);
  });

  it("tracks indices independently per key", () => {
    store.setActiveSource("flood", 1);
    store.setActiveSource("cyclone", 3);
    expect(store.getActiveSource("flood")).toBe(1);
    expect(store.getActiveSource("cyclone")).toBe(3);
  });

  it("overwrites a previously set index", () => {
    store.setActiveSource("flood", 1);
    store.setActiveSource("flood", 0);
    expect(store.getActiveSource("flood")).toBe(0);
  });
});
