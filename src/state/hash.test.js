import { describe, it, expect, beforeEach } from "vitest";
import { parseHash, writeHash, getLayerByKey, getTabForLayerKey } from "./hash.js";

beforeEach(() => {
  window.location.hash = "";
});

// ---------------------------------------------------------------------------
// parseHash
// ---------------------------------------------------------------------------

describe("parseHash", () => {
  it("returns null tab and empty layers for empty hash", () => {
    expect(parseHash()).toEqual({ tab: null, layers: [] });
  });

  it("parses a tab-only hash", () => {
    window.location.hash = "#hazard";
    expect(parseHash()).toEqual({ tab: "hazard", layers: [] });
  });

  it("parses a hash with a single simple layer (no source index)", () => {
    window.location.hash = "#exposure?layers=population";
    expect(parseHash()).toEqual({
      tab: "exposure",
      layers: [{ key: "population", sourceIdx: 0 }],
    });
  });

  it("parses a compound layer with an explicit source index", () => {
    window.location.hash = "#hazard?layers=earthquake-pga:2";
    expect(parseHash()).toEqual({
      tab: "hazard",
      layers: [{ key: "earthquake-pga", sourceIdx: 2 }],
    });
  });

  it("parses multiple layers in a single hash", () => {
    window.location.hash = "#hazard?layers=river-flooding:1,earthquake-pga:0";
    expect(parseHash()).toEqual({
      tab: "hazard",
      layers: [
        { key: "river-flooding", sourceIdx: 1 },
        { key: "earthquake-pga", sourceIdx: 0 },
      ],
    });
  });

  it("defaults sourceIdx to 0 when colon part is absent", () => {
    window.location.hash = "#hazard?layers=river-flooding";
    const { layers } = parseHash();
    expect(layers[0].sourceIdx).toBe(0);
  });

  it("ignores empty layer segments", () => {
    // Trailing comma produces an empty segment
    window.location.hash = "#hazard?layers=river-flooding,";
    const { layers } = parseHash();
    expect(layers).toEqual([{ key: "river-flooding", sourceIdx: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// writeHash
// ---------------------------------------------------------------------------

describe("writeHash", () => {
  it("writes a tab-only hash when no layers are active", () => {
    writeHash("hazard", []);
    expect(window.location.hash).toBe("#hazard");
  });

  it("includes a simple layer (sourceIdx 0 omitted)", () => {
    writeHash("exposure", [{ key: "population", sourceIdx: 0 }]);
    expect(window.location.hash).toBe("#exposure?layers=population");
  });

  it("omits sourceIdx 0 for compound layers", () => {
    writeHash("hazard", [{ key: "earthquake-pga", sourceIdx: 0 }]);
    expect(window.location.hash).toBe("#hazard?layers=earthquake-pga");
  });

  it("includes non-zero sourceIdx", () => {
    writeHash("hazard", [{ key: "earthquake-pga", sourceIdx: 2 }]);
    expect(window.location.hash).toBe("#hazard?layers=earthquake-pga:2");
  });

  it("round-trips tab + multiple layers through write then parse", () => {
    const layers = [
      { key: "river-flooding", sourceIdx: 1 },
      { key: "population", sourceIdx: 0 },
    ];
    writeHash("hazard", layers);
    const parsed = parseHash();
    expect(parsed.tab).toBe("hazard");
    expect(parsed.layers).toEqual(layers);
  });

  it("does not push duplicate history state when hash is unchanged", () => {
    writeHash("hazard", []);
    const lengthBefore = window.history.length;
    writeHash("hazard", []);
    expect(window.history.length).toBe(lengthBefore);
  });
});

// ---------------------------------------------------------------------------
// getLayerByKey — uses real TABS data
// ---------------------------------------------------------------------------

describe("getLayerByKey", () => {
  it("returns layer config for a known key", () => {
    const layer = getLayerByKey("river-flooding");
    expect(layer).toBeDefined();
    expect(layer.key).toBe("river-flooding");
  });

  it("returns undefined for an unknown key", () => {
    expect(getLayerByKey("does-not-exist")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTabForLayerKey — uses real TABS data
// ---------------------------------------------------------------------------

describe("getTabForLayerKey", () => {
  it("returns 'hazard' for a hazard layer key", () => {
    expect(getTabForLayerKey("river-flooding")).toBe("hazard");
  });

  it("returns 'exposure' for an exposure layer key", () => {
    expect(getTabForLayerKey("population")).toBe("exposure");
  });

  it("returns 'vulnerability' for a vulnerability layer key", () => {
    expect(getTabForLayerKey("intact-forests")).toBe("vulnerability");
  });

  it("returns 'resilience' for a resilience layer key", () => {
    expect(getTabForLayerKey("recovery-rates")).toBe("resilience");
  });

  it("returns undefined for an unknown key", () => {
    expect(getTabForLayerKey("does-not-exist")).toBeUndefined();
  });
});
