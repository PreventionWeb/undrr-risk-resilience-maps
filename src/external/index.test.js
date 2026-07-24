import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sdk = { ask: vi.fn() };
  return {
    sdk,
    create: vi.fn(),
    remove: vi.fn(),
  };
});

vi.mock("../sdk/client.js", () => ({
  getSDK: () => mocks.sdk,
}));

vi.mock("./edra-agriculture.js", () => ({
  createEDRAView: mocks.create,
  deleteEDRAView: mocks.remove,
  EDRA_CONTROLS: [],
  EDRA_LEGEND: [],
}));

import {
  closeExternalLayer,
  getExternalLayerRuntime,
  getExternalRuntimeByViewId,
  openExternalLayer,
  replaceExternalLayer,
  resetExternalRuntime,
} from "./index.js";

const layer = {
  key: "external-test",
  external: {
    provider: "edra-agriculture",
    defaults: { crop: "WHEAT", scenario: "20" },
  },
};

beforeEach(() => {
  resetExternalRuntime();
  vi.clearAllMocks();
});

describe("external runtime registry", () => {
  it("registers a runtime MapX ID on open and unregisters it on close", async () => {
    mocks.create.mockResolvedValue({
      idView: "MX-GJ-FIRST",
      settings: { crop: "WHEAT", scenario: "20" },
    });

    const opened = await openExternalLayer(layer);
    expect(opened.idView).toBe("MX-GJ-FIRST");
    expect(getExternalLayerRuntime(layer)).toBe(opened);
    expect(getExternalRuntimeByViewId("MX-GJ-FIRST")).toBe(opened);

    await closeExternalLayer(layer);
    expect(mocks.remove).toHaveBeenCalledWith("MX-GJ-FIRST");
    expect(getExternalLayerRuntime(layer)).toBeNull();
    expect(getExternalRuntimeByViewId("MX-GJ-FIRST")).toBeNull();
  });

  it("replaces a view, preserves the camera, and updates both indexes", async () => {
    mocks.create
      .mockResolvedValueOnce({
        idView: "MX-GJ-OLD",
        settings: { crop: "WHEAT", scenario: "20" },
      })
      .mockResolvedValueOnce({
        idView: "MX-GJ-NEW",
        settings: { crop: "MAIZE", scenario: "30" },
      });
    mocks.sdk.ask
      .mockResolvedValueOnce({ lng: 12, lat: 48 })
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(true);

    await openExternalLayer(layer);
    const result = await replaceExternalLayer(layer, { crop: "MAIZE", scenario: "30" });

    expect(result.previousIdView).toBe("MX-GJ-OLD");
    expect(result.runtime.idView).toBe("MX-GJ-NEW");
    expect(getExternalRuntimeByViewId("MX-GJ-OLD")).toBeNull();
    expect(getExternalRuntimeByViewId("MX-GJ-NEW")).toBe(result.runtime);
    expect(mocks.remove).toHaveBeenCalledWith("MX-GJ-OLD", mocks.sdk);
    expect(mocks.sdk.ask).toHaveBeenLastCalledWith("map_jump_to", {
      center: [12, 48],
      zoom: 5,
    });
  });

  it("keeps the current view registered when a replacement request fails", async () => {
    mocks.create
      .mockResolvedValueOnce({
        idView: "MX-GJ-CURRENT",
        settings: { crop: "WHEAT", scenario: "20" },
      })
      .mockRejectedValueOnce(new Error("EDRA unavailable"));
    mocks.sdk.ask.mockResolvedValueOnce({ lng: 12, lat: 48 }).mockResolvedValueOnce(5);

    const current = await openExternalLayer(layer);
    await expect(replaceExternalLayer(layer, { crop: "BARLEY", scenario: "30" })).rejects.toThrow(
      "EDRA unavailable",
    );

    expect(getExternalLayerRuntime(layer)).toBe(current);
    expect(getExternalRuntimeByViewId("MX-GJ-CURRENT")).toBe(current);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
