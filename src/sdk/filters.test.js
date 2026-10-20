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

  it("handles fresh view defaults for both MapX 1.14.2 (0) and 1.14.1 (1) in unconfigured fallback", () => {
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

  it("accurately handles MapX 1.14.1 legacy opacity without regressions (0 remains 0, 1 remains 100)", () => {
    // Crucial edge case: user set 0% opacity on MapX 1.14.1; must NOT turn 100% opaque!
    expect(normalizeLayerTransparency(0, { env: "prod" })).toBe(0);
    expect(normalizeLayerTransparency(0, { version: "1.14.1" })).toBe(0);

    // Fresh view on 1.14.1
    expect(normalizeLayerTransparency(1, { env: "prod" })).toBe(100);
    expect(normalizeLayerTransparency(1, { version: "1.14.1" })).toBe(100);

    // Fractional values
    expect(normalizeLayerTransparency(0.4, { env: "prod" })).toBe(40);
    expect(normalizeLayerTransparency(0.75, { version: "1.14.1" })).toBe(75);
  });

  it("accurately handles MapX 1.14.2 transparency without precision loss (0 is 100, 1 is 99)", () => {
    // Fresh view on 1.14.2: 0 transparency = 100% opacity
    expect(normalizeLayerTransparency(0, { env: "staging" })).toBe(100);
    expect(normalizeLayerTransparency(0, { version: "1.14.2-alpha" })).toBe(100);

    // Crucial edge case: 1 transparency = 99% opacity (must not round up to 100%)
    expect(normalizeLayerTransparency(1, { env: "staging" })).toBe(99);
    expect(normalizeLayerTransparency(1, { version: "1.14.2-alpha" })).toBe(99);

    // Other values
    expect(normalizeLayerTransparency(30, { env: "staging" })).toBe(70);
    expect(normalizeLayerTransparency(100, { env: "staging" })).toBe(0);
  });

  it("detects SDK version from window.mxsdk.version", () => {
    const originalMxsdk = window.mxsdk;
    try {
      window.mxsdk = { version: "1.14.1" };
      expect(normalizeLayerTransparency(0)).toBe(0);
      expect(normalizeLayerTransparency(1)).toBe(100);

      window.mxsdk = { version: "1.14.2-alpha" };
      expect(normalizeLayerTransparency(0)).toBe(100);
      expect(normalizeLayerTransparency(1)).toBe(99);
    } finally {
      window.mxsdk = originalMxsdk;
    }
  });

  it("detects environment from window.location.search", () => {
    const originalLocation = window.location;
    try {
      delete window.location;
      window.location = { search: "?mapxEnv=prod" };
      expect(normalizeLayerTransparency(0)).toBe(0);
      expect(normalizeLayerTransparency(1)).toBe(100);

      window.location = { search: "?mapxEnv=staging" };
      expect(normalizeLayerTransparency(0)).toBe(100);
      expect(normalizeLayerTransparency(1)).toBe(99);
    } finally {
      window.location = originalLocation;
    }
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
