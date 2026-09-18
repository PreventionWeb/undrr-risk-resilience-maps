import { describe, expect, it } from "vitest";
import { getLayerRegistry } from "../config/registry.js";
import { clampLayers, MAX_LAYERS, parseEmbedParams, parseOrigin } from "./params.js";

/** Parse a query string the way `embed.html` does, against the real layer config. */
const parse = (search, context) => parseEmbedParams(search, context);

describe("parseOrigin", () => {
  it("keeps only the origin of an http(s) URL", () => {
    expect(parseOrigin("https://www.undrr.org/some/page?q=1#frag")).toBe("https://www.undrr.org");
    expect(parseOrigin("http://localhost:3040/")).toBe("http://localhost:3040");
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    for (const value of [
      "",
      null,
      undefined,
      "undrr.org",
      "/relative",
      "javascript:alert(1)",
      "data:,x",
      42,
    ]) {
      expect(parseOrigin(value)).toBeNull();
    }
  });
});

describe("parseEmbedParams", () => {
  it("defaults to the first tab, no layers, an expanded panel and no host", () => {
    const params = parse("");

    expect(params.tab).toBe("risk-resilience");
    expect(params.layers).toEqual([]);
    expect(params.panelCollapsed).toBe(false);
    expect(params.parentOrigin).toBeNull();
    expect(params.instance).toBeNull();
    expect(params.tabIds).toEqual(["risk-resilience", "resilience", "hazard", "exposure", "vulnerability"]);
  });

  it("takes a known tab and ignores an unknown or an info tab", () => {
    expect(parse("?tab=hazard").tab).toBe("hazard");
    expect(parse("?tab=about").tab).toBe("risk-resilience");
    expect(parse("?tab=../../etc/passwd").tab).toBe("risk-resilience");
  });

  it("parses layers with their sources, in the same syntax as a share link", () => {
    expect(parse("?tab=hazard&layers=river-flooding:1,landslides").layers).toEqual([
      { key: "river-flooding", sourceIdx: 1 },
      { key: "landslides", sourceIdx: 0 },
    ]);
  });

  it("falls back to the first source for an index the layer does not have", () => {
    // Exactly `clampSourceIdx`, the rule a share link's hash already follows: an
    // integer in range, or 0 — never a neighbouring source nobody asked for.
    // river-flooding has three sources.
    expect(parse("?layers=river-flooding:2").layers).toEqual([{ key: "river-flooding", sourceIdx: 2 }]);
    expect(parse("?layers=river-flooding:9").layers).toEqual([{ key: "river-flooding", sourceIdx: 0 }]);
    expect(parse("?layers=river-flooding:-1").layers).toEqual([{ key: "river-flooding", sourceIdx: 0 }]);
    expect(parse("?layers=river-flooding:banana").layers).toEqual([{ key: "river-flooding", sourceIdx: 0 }]);
  });

  it("drops unknown layer keys and keeps the first of a duplicate", () => {
    expect(parse("?layers=not-a-layer,landslides,landslides:2").layers).toEqual([
      { key: "landslides", sourceIdx: 0 },
    ]);
  });

  it("cuts an over-long layer list to MAX_LAYERS", () => {
    const keys = getLayerRegistry().urlKeyOrder();
    expect(keys.length).toBeGreaterThan(MAX_LAYERS);
    expect(parse(`?layers=${keys.join(",")}`).layers).toHaveLength(MAX_LAYERS);
  });

  it("restores provider settings from `variants`, and survives broken JSON", () => {
    const variants = encodeURIComponent(JSON.stringify({ "edra-crop-yield-reduction": { crop: "maize" } }));
    expect(parse(`?layers=edra-crop-yield-reduction&variants=${variants}`).layers).toEqual([
      { key: "edra-crop-yield-reduction", sourceIdx: 0, settings: { crop: "maize" } },
    ]);
    expect(parse("?layers=landslides&variants=%7Bbroken").layers).toEqual([
      { key: "landslides", sourceIdx: 0 },
    ]);
  });

  it("applies a tab allowlist, in config order, and ignores unknown tab ids", () => {
    const params = parse("?tabs=exposure,hazard,not-a-tab");
    expect(params.tabIds).toEqual(["hazard", "exposure"]);
    expect(params.tab).toBe("hazard");
  });

  it("applies a layer allowlist, and drops tabs it empties", () => {
    const params = parse("?allow=landslides,river-flooding");
    expect(params.tabIds).toEqual(["hazard"]);
    expect(params.layerKeys).toEqual(["river-flooding", "landslides"]);
  });

  it("refuses to render an empty embed when every allowlisted name is a typo", () => {
    const params = parse("?allow=nope,also-nope");
    expect(params.tabIds).toHaveLength(5);
  });

  it("will not open a layer the allowlist excludes", () => {
    expect(parse("?allow=landslides&layers=river-flooding,landslides").layers).toEqual([
      { key: "landslides", sourceIdx: 0 },
    ]);
  });

  it("collapses the panel only for `panel=collapsed`", () => {
    expect(parse("?panel=collapsed").panelCollapsed).toBe(true);
    expect(parse("?panel=expanded").panelCollapsed).toBe(false);
    expect(parse("?panel=yes").panelCollapsed).toBe(false);
  });

  it("prefers the parentOrigin parameter and falls back to the referrer", () => {
    expect(parse("?parentOrigin=https://www.undrr.org").parentOrigin).toBe("https://www.undrr.org");
    expect(parse("", { referrer: "https://www.preventionweb.net/page" }).parentOrigin).toBe(
      "https://www.preventionweb.net",
    );
    expect(parse("?parentOrigin=not-a-url", { referrer: "https://host.example/x" }).parentOrigin).toBe(
      "https://host.example",
    );
  });

  it("accepts only a safe, short instance id", () => {
    expect(parse("?instance=map-1").instance).toBe("map-1");
    expect(parse("?instance=a b").instance).toBeNull();
    expect(parse(`?instance=${"x".repeat(65)}`).instance).toBeNull();
  });

  it("ignores parameters it does not know", () => {
    const params = parse("?tab=hazard&pin=0403&chrome=full&__proto__=x");
    expect(params.tab).toBe("hazard");
    expect(Object.keys(params).sort()).toEqual([
      "instance",
      "layerKeys",
      "layers",
      "panelCollapsed",
      "parentOrigin",
      "tab",
      "tabIds",
    ]);
  });
});

describe("clampLayers", () => {
  const registry = getLayerRegistry();
  const allowed = new Set(["river-flooding", "landslides"]);

  it("drops everything that is not an allowed layer entry", () => {
    expect(
      clampLayers(
        [
          null,
          "landslides",
          { key: 42 },
          { key: "population" },
          { key: "river-flooding", sourceIdx: 1 },
          { key: "landslides", settings: ["not", "an", "object"] },
        ],
        { allowed, registry },
      ),
    ).toEqual([
      { key: "river-flooding", sourceIdx: 1 },
      { key: "landslides", sourceIdx: 0 },
    ]);
  });

  it("returns nothing for a non-array", () => {
    for (const value of [undefined, null, "landslides", { key: "landslides" }]) {
      expect(clampLayers(value, { allowed, registry })).toEqual([]);
    }
  });
});
