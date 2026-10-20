import { beforeEach, describe, expect, it, vi } from "vitest";
import { getViewLayerTransparency, normalizeLayerTransparency, setViewLayerTransparency } from "./filters.js";

const mocks = vi.hoisted(() => ({
  sdk: { ask: vi.fn() },
}));

vi.mock("./client.js", () => ({
  getSDK: () => mocks.sdk,
}));

beforeEach(() => {
  mocks.sdk.ask.mockReset();
});

describe("normalizeLayerTransparency", () => {
  it("defaults to 100 for non-numeric or non-finite inputs", () => {
    expect(normalizeLayerTransparency(null)).toBe(100);
    expect(normalizeLayerTransparency(undefined)).toBe(100);
    expect(normalizeLayerTransparency("100")).toBe(100);
    expect(normalizeLayerTransparency(NaN)).toBe(100);
    expect(normalizeLayerTransparency(Infinity)).toBe(100);
  });

  it("handles fresh view defaults for both MapX 1.14.2 (0) and 1.14.1 (1)", () => {
    // MapX 1.14.2 transparency 0 = 100% opacity
    expect(normalizeLayerTransparency(0)).toBe(100);
    // MapX 1.14.1 opacity 1 = 100% opacity
    expect(normalizeLayerTransparency(1)).toBe(100);
  });

  it("normalizes MapX 1.14.1 fractional opacity (0 < value < 1)", () => {
    expect(normalizeLayerTransparency(0.75)).toBe(75);
    expect(normalizeLayerTransparency(0.5)).toBe(50);
    expect(normalizeLayerTransparency(0.6699999999999999)).toBe(67);
  });

  it("normalizes MapX 1.14.2 integer transparency (value > 1)", () => {
    expect(normalizeLayerTransparency(30)).toBe(70);
    expect(normalizeLayerTransparency(50)).toBe(50);
    expect(normalizeLayerTransparency(80)).toBe(20);
    expect(normalizeLayerTransparency(100)).toBe(0);
  });

  it("clamps out-of-range transparency values to 0-100 opacity", () => {
    expect(normalizeLayerTransparency(-15)).toBe(100);
    expect(normalizeLayerTransparency(130)).toBe(0);
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
