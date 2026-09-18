import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // The warnings below are deliberate output for a host's console; silence them
  // here so a passing suite does not read like a failing one.
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("defaults to the first tab, no layers, an expanded panel and no host", () => {
    const params = parse("");

    expect(params.tab).toBe("risk-resilience");
    expect(params.layers).toEqual([]);
    expect(params.panelCollapsed).toBe(false);
    expect(params.parentOrigin).toBeNull();
    expect(params.instance).toBeNull();
    expect(params.empty).toBe(false);
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

  it("shows nothing, rather than everything, when a supplied allowlist selects nothing", () => {
    // Finding 2: `tabs.length > 0 ? tabs : allTabs` read an allowlist of typos as
    // "no allowlist", so a host that had excluded everything was handed every tab
    // and every layer — and could then turn any of them on over the bridge.
    for (const search of ["?allow=no-such-layer", "?tabs=no-such-tab", "?tabs=&allow=landslides"]) {
      const params = parse(search);
      expect(params.empty, search).toBe(true);
      expect(params.tabIds, search).toEqual([]);
      expect(params.layerKeys, search).toEqual([]);
      expect(params.layers, search).toEqual([]);
      expect(params.tab, search).toBeNull();
    }
  });

  it("narrows to the tab selection when the two allowlists do not overlap", () => {
    // `population` is a real layer, in `exposure`. A host that asks for the
    // hazard tab and for that layer has made a plausible mistake; the answer is
    // the tabs it asked for, and never the whole config.
    const params = parse("?tabs=hazard&allow=population");

    expect(params.empty).toBe(false);
    expect(params.tabIds).toEqual(["hazard"]);
    expect(params.layerKeys).not.toContain("population");
    expect(params.layerKeys).toContain("landslides");
  });

  it("names the ids it did not recognise, and stays quiet when they are all known", () => {
    parse("?tabs=hazard,not-a-tab&allow=landslides,not-a-layer");

    const said = warn.mock.calls.flat().join("\n");
    expect(said).toContain('"not-a-tab"');
    expect(said).toContain('"not-a-layer"');

    warn.mockClear();
    parse("?tabs=hazard&allow=landslides");
    expect(warn).not.toHaveBeenCalled();
  });

  it("opens no layer at all in an embed whose allowlist is a typo", () => {
    expect(parse("?allow=nope&layers=landslides").layers).toEqual([]);
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

  it("prefers the parentOrigin parameter and falls back to the referrer when it is absent", () => {
    expect(parse("?parentOrigin=https://www.undrr.org").parentOrigin).toBe("https://www.undrr.org");
    expect(parse("", { referrer: "https://www.preventionweb.net/page" }).parentOrigin).toBe(
      "https://www.preventionweb.net",
    );
  });

  it("disables the bridge, loudly, when a supplied parentOrigin does not parse", () => {
    // Finding 3: `parentOrigin` is what a careful host writes to be explicit, so
    // a typo in it must not revert to the loose referrer mode behind its back.
    for (const value of ["not-a-url", "https:///", "javascript:alert(1)", "//evil.example", ""]) {
      warn.mockClear();
      const params = parse(`?parentOrigin=${encodeURIComponent(value)}`, {
        referrer: "https://host.example/x",
      });
      expect(params.parentOrigin, value).toBeNull();
      expect(warn.mock.calls.flat().join(" "), value).toContain("parentOrigin");
    }
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
      "empty",
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
