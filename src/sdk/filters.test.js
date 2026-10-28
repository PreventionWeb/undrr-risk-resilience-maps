import { beforeEach, describe, expect, it, vi } from "vitest";
import { getViewLayerTransparency, normalizeLayerTransparency, setViewLayerTransparency } from "./filters.js";

const mocks = vi.hoisted(() => ({
  sdk: { ask: vi.fn() },
  version: null,
}));

vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getSDK: () => mocks.sdk,
  getMapXVersion: () => mocks.version,
}));

beforeEach(() => {
  mocks.sdk.ask.mockReset();
  mocks.version = null;
});

describe("normalizeLayerTransparency", () => {
  it("defaults to 100 for non-numeric or non-finite inputs", () => {
    expect(normalizeLayerTransparency(null)).toBe(100);
    expect(normalizeLayerTransparency(undefined)).toBe(100);
    expect(normalizeLayerTransparency("100")).toBe(100);
    expect(normalizeLayerTransparency(NaN)).toBe(100);
    expect(normalizeLayerTransparency(Infinity)).toBe(100);
  });

  it("reads MapX 1.14.2+ as transparency 0-100", () => {
    for (const version of ["1.14.2-alpha.3", "1.14.2-beta.0", "1.14.2", "1.15.0"]) {
      expect(normalizeLayerTransparency(0, version)).toBe(100);
      // Not rounded up to 100: 1 is a real 1% transparency on this scale.
      expect(normalizeLayerTransparency(1, version)).toBe(99);
      expect(normalizeLayerTransparency(30, version)).toBe(70);
      expect(normalizeLayerTransparency(100, version)).toBe(0);
    }
  });

  it("reads MapX 1.14.1 and earlier as opacity 0-1", () => {
    // A layer the user faded out must stay faded out, not snap back to opaque.
    expect(normalizeLayerTransparency(0, "1.14.1")).toBe(0);
    expect(normalizeLayerTransparency(1, "1.14.1")).toBe(100);
    expect(normalizeLayerTransparency(0.75, "1.14.1")).toBe(75);
    expect(normalizeLayerTransparency(0.6699999999999999, "1.13.0")).toBe(67);
  });

  it("clamps out-of-range values", () => {
    expect(normalizeLayerTransparency(-15, "1.14.2")).toBe(100);
    expect(normalizeLayerTransparency(130, "1.14.2")).toBe(0);
    expect(normalizeLayerTransparency(1.5, "1.14.1")).toBe(100);
  });

  it("uses the Manager's version by default", () => {
    mocks.version = "1.14.1";
    expect(normalizeLayerTransparency(0)).toBe(0);
    mocks.version = "1.14.2-alpha.3";
    expect(normalizeLayerTransparency(0)).toBe(100);
    expect(normalizeLayerTransparency(1)).toBe(99);
  });

  it("guesses from the value when no version is known", () => {
    expect(normalizeLayerTransparency(0.75)).toBe(75);
    expect(normalizeLayerTransparency(30)).toBe(70);
    // 0 and 1 are the fresh-view default on one scale each, so read as opaque.
    expect(normalizeLayerTransparency(0)).toBe(100);
    expect(normalizeLayerTransparency(1)).toBe(100);
  });
});

describe("setViewLayerTransparency", () => {
  it("delegates to MapX SDK set_view_layer_transparency", async () => {
    mocks.sdk.ask.mockResolvedValue(true);
    await setViewLayerTransparency("view-1", 40);
    expect(mocks.sdk.ask).toHaveBeenCalledWith("set_view_layer_transparency", {
      idView: "view-1",
      value: 40,
    });
  });
});

describe("getViewLayerTransparency", () => {
  it("delegates to MapX SDK get_view_layer_transparency", async () => {
    mocks.sdk.ask.mockResolvedValue(25);
    const result = await getViewLayerTransparency("view-1");
    expect(result).toBe(25);
    expect(mocks.sdk.ask).toHaveBeenCalledWith("get_view_layer_transparency", {
      idView: "view-1",
    });
  });
});
