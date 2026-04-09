import { describe, it, expect } from "vitest";
import { validateLayers } from "./validate.js";

const PRIMARY = "MX-PRIMARY";
const OTHER = "MX-OTHER";

function makeTab(id, layers) {
  return { id, label: id, layers };
}

function makeSimpleLayer(overrides = {}) {
  return {
    id: "MX-VIEW-1",
    key: "layer-1",
    label: "Layer 1",
    type: "rt",
    project: PRIMARY,
    ...overrides,
  };
}

function makeCompoundLayer(overrides = {}) {
  return {
    id: null,
    key: "compound-1",
    label: "Compound",
    type: "rt",
    project: PRIMARY,
    sources: [
      { id: "MX-SRC-1", label: "Source A" },
      { id: "MX-SRC-2", label: "Source B" },
    ],
    widget: { type: "sub-tabs" },
    ...overrides,
  };
}

describe("validateLayers", () => {
  // --- valid configs ---

  it("passes for a minimal valid simple layer", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer()])], PRIMARY),
    ).not.toThrow();
  });

  it("passes for a valid compound layer", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeCompoundLayer()])], PRIMARY),
    ).not.toThrow();
  });

  it("passes when a layer is disabled with null id", () => {
    const layer = makeSimpleLayer({ id: null, disabled: true });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).not.toThrow();
  });

  it("passes when a disabled layer belongs to a non-primary project", () => {
    const layer = makeSimpleLayer({ project: OTHER, disabled: true });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).not.toThrow();
  });

  it("passes for a layer with a valid legend", () => {
    const layer = makeSimpleLayer({ legend: [{ color: "#f00", label: "High" }] });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).not.toThrow();
  });

  // --- tab-level errors ---

  it("throws when a tab is missing id", () => {
    expect(() =>
      validateLayers([{ label: "x", layers: [] }], PRIMARY),
    ).toThrow();
  });

  it("throws when a tab is missing label", () => {
    expect(() =>
      validateLayers([{ id: "x", layers: [] }], PRIMARY),
    ).toThrow();
  });

  it("throws when a tab layers field is not an array", () => {
    expect(() =>
      validateLayers([{ id: "x", label: "X", layers: null }], PRIMARY),
    ).toThrow();
  });

  // --- simple layer errors ---

  it("throws when layer is missing label", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer({ label: "" })])], PRIMARY),
    ).toThrow();
  });

  it("throws for an invalid layer type", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer({ type: "xyz" })])], PRIMARY),
    ).toThrow();
  });

  it("throws when an enabled layer belongs to a non-primary project", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer({ project: OTHER })])], PRIMARY),
    ).toThrow();
  });

  it("throws when an enabled simple layer has a null id", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer({ id: null })])], PRIMARY),
    ).toThrow();
  });

  it("throws when an enabled simple layer has an empty string id", () => {
    expect(() =>
      validateLayers([makeTab("hazard", [makeSimpleLayer({ id: "" })])], PRIMARY),
    ).toThrow();
  });

  it("throws on duplicate view IDs across layers", () => {
    const layers = [
      makeSimpleLayer({ id: "MX-SAME" }),
      makeSimpleLayer({ id: "MX-SAME", key: "layer-2", label: "Layer 2" }),
    ];
    expect(() =>
      validateLayers([makeTab("hazard", layers)], PRIMARY),
    ).toThrow();
  });

  it("throws on duplicate view IDs across different tabs", () => {
    const layer1 = makeSimpleLayer({ id: "MX-SAME", key: "k1", label: "L1" });
    const layer2 = makeSimpleLayer({ id: "MX-SAME", key: "k2", label: "L2" });
    expect(() =>
      validateLayers(
        [makeTab("hazard", [layer1]), makeTab("exposure", [layer2])],
        PRIMARY,
      ),
    ).toThrow();
  });

  // --- compound layer errors ---

  it("throws when a compound layer is missing widget", () => {
    const layer = makeCompoundLayer({ widget: undefined });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  it("throws when a compound layer widget has no type", () => {
    const layer = makeCompoundLayer({ widget: { label: "X" } });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  it("throws when a compound source is missing id", () => {
    const layer = makeCompoundLayer({
      sources: [{ label: "A" }], // no id
    });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  it("throws when a compound source is missing label", () => {
    const layer = makeCompoundLayer({
      sources: [{ id: "MX-SRC-1" }], // no label
    });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  it("throws on duplicate view IDs across compound sources", () => {
    const layer = makeCompoundLayer({
      sources: [
        { id: "MX-DUP", label: "A" },
        { id: "MX-DUP", label: "B" },
      ],
    });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  // --- legend errors ---

  it("throws when a legend item is missing color", () => {
    const layer = makeSimpleLayer({
      legend: [{ label: "No color here" }],
    });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });

  it("throws when a legend item is missing label", () => {
    const layer = makeSimpleLayer({
      legend: [{ color: "#f00" }], // no label
    });
    expect(() =>
      validateLayers([makeTab("hazard", [layer])], PRIMARY),
    ).toThrow();
  });



  it("includes the error count in the thrown message", () => {
    const layers = [
      makeSimpleLayer({ label: "", type: "xyz" }), // two errors: missing label + bad type
    ];
    expect(() =>
      validateLayers([makeTab("hazard", layers)], PRIMARY),
    ).toThrow(/2 layer config error/);
  });

  it("accumulates errors across multiple layers before throwing", () => {
    const layers = [
      makeSimpleLayer({ label: "" }), // error 1
      makeSimpleLayer({ label: "", key: "l2" }), // error 2 (also reuses MX-VIEW-1 id → error 3)
    ];
    // Three errors: two missing labels + one duplicate id
    expect(() =>
      validateLayers([makeTab("hazard", layers)], PRIMARY),
    ).toThrow(/3 layer config error/);
  });
});
