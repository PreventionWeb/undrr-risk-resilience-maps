import { describe, it, expect, beforeEach } from "vitest";
import * as store from "./store.js";

beforeEach(() => {
  store.openViews.clear();
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

describe("module state", () => {
  it("holds no active tab (each sidebar instance owns its own)", () => {
    expect(Object.keys(store)).toEqual(["openViews"]);
  });
});
