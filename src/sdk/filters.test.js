import { beforeEach, describe, expect, it, vi } from "vitest";
import { getViewLayerTransparency, normalizeLayerTransparency, setViewLayerTransparency } from "./filters.js";

const mocks = vi.hoisted(() => ({
  sdk: { ask: vi.fn() },
}));

vi.mock("./client.js", async (importOriginal) => ({
  ...(await importOriginal()),
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

  it("converts transparency to opacity, including 1% transparency", () => {
    expect(normalizeLayerTransparency(0)).toBe(100);
    expect(normalizeLayerTransparency(1)).toBe(99);
    expect(normalizeLayerTransparency(30)).toBe(70);
    expect(normalizeLayerTransparency(100)).toBe(0);
  });

  it("rounds and clamps SDK values to the slider range", () => {
    expect(normalizeLayerTransparency(33.4)).toBe(67);
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
