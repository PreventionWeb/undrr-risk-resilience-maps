import { describe, it, expect } from "vitest";
import { getLayerPublicationState, getLayerStatus, isLayerPublished } from "./status.js";

describe("layer status helpers", () => {
  it("treats legacy disabled layers as unpublished", () => {
    const layer = { id: "MX-1", disabled: true };
    expect(getLayerStatus(layer)).toBe("Disabled");
    expect(isLayerPublished(layer)).toBe(false);
    expect(getLayerPublicationState(layer)).toBe("disabled");
  });

  it("returns Awaiting data for unpublished layers awaiting data", () => {
    const layer = { id: null, status: "disabled-awaiting-data" };
    expect(getLayerStatus(layer)).toBe("Awaiting data");
    expect(isLayerPublished(layer)).toBe(false);
  });

  it("returns Pending removal for unpublished layers under review for removal", () => {
    const layer = { id: "MX-1", status: "disabled-pending-removal" };
    expect(getLayerStatus(layer)).toBe("Pending removal");
    expect(isLayerPublished(layer)).toBe(false);
  });

  it("treats enabled layers with an id as active", () => {
    const layer = { id: "MX-1", disabled: false };
    expect(getLayerStatus(layer)).toBe("Active");
    expect(isLayerPublished(layer)).toBe(true);
  });

  it("treats enabled layers without an id as placeholders", () => {
    const layer = { id: null, disabled: false };
    expect(getLayerStatus(layer)).toBe("Placeholder");
  });

  it("uses source ids for compound layer sub-sources", () => {
    const layer = { id: null, disabled: false };
    expect(getLayerStatus(layer, { id: "MX-SRC" })).toBe("Active");
    expect(getLayerStatus(layer, { id: null })).toBe("Placeholder");
  });
});
