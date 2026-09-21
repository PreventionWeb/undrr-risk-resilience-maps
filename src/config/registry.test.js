import { describe, expect, it } from "vitest";
import { TABS } from "./layers.js";
import { createLayerRegistry, getLayerRegistry, urlKeyOrder } from "./registry.js";

const econ = { key: "econ", id: "MX-ECON", label: "Economy", r2rCategory: "Economy" };
const soc = { key: "soc", id: "MX-SOC", label: "Societies", r2rCategory: "Societies" };
const flood = {
  key: "flood",
  id: null,
  label: "Flood",
  sources: [
    { id: "MX-F10", label: "10y" },
    { id: "MX-F100", label: "100y" },
  ],
};
const draft = { key: "draft", id: "MX-D", status: "disabled" };
const noKey = { id: "MX-NOKEY" };
const crops = { key: "crops", id: null, external: { provider: "edra-agriculture" } };

const tabs = [
  { id: "risk", layers: [econ, soc], groups: [{ layers: [soc] }, { layers: [econ] }] },
  { id: "hazard", layers: [flood, draft, noKey, crops] },
];

describe("createLayerRegistry", () => {
  const registry = createLayerRegistry(tabs);

  it("looks layers up by key, published or not", () => {
    expect(registry.byKey("flood")).toBe(flood);
    expect(registry.byKey("draft")).toBe(draft);
    expect(registry.byKey("missing")).toBeUndefined();
  });

  it("looks up permanent view ids, including compound sources", () => {
    expect(registry.byViewId("MX-ECON")).toEqual({ tab: tabs[0], layer: econ, source: null });
    expect(registry.byViewId("MX-F100")).toEqual({ tab: tabs[1], layer: flood, source: flood.sources[1] });
    expect(registry.byViewId("MX-NOKEY")).toEqual({ tab: tabs[1], layer: noKey, source: null });
    expect(registry.byViewId("MX-GJ-1")).toBeUndefined();
  });

  it("gives the URL key order: published, keyed layers in config order", () => {
    expect(registry.urlKeyOrder()).toEqual(["econ", "soc", "flood", "crops"]);
    expect(registry.urlKeyOrder()).toBe(registry.urlKeyOrder());
  });

  it("keeps the first layer for a duplicate key or view id", () => {
    const again = { key: "econ", id: "MX-ECON", label: "Duplicate" };
    const duplicated = createLayerRegistry([
      { id: "a", layers: [econ] },
      { id: "b", layers: [again] },
    ]);
    expect(duplicated.byKey("econ")).toBe(econ);
    expect(duplicated.byViewId("MX-ECON").layer).toBe(econ);
    expect(duplicated.byViewId("MX-ECON").tab.id).toBe("a");
  });

  it("does not change the config and returns frozen indexes", () => {
    const before = JSON.stringify(tabs);
    const built = createLayerRegistry(tabs);
    expect(JSON.stringify(tabs)).toBe(before);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.urlKeyOrder())).toBe(true);
    // Shallow: layer config objects are the config's own, not frozen copies.
    expect(built.byKey("flood")).toBe(flood);
    expect(Object.isFrozen(built.byKey("flood"))).toBe(false);
  });

  it("indexes tab and layer collections, defaulting to r2r", () => {
    const garLayer = { key: "gar-metric", id: "MX-GAR" };
    const customTabs = [
      { id: "hazard", layers: [flood] },
      { id: "gar", collection: "gar", layers: [garLayer] },
    ];
    const reg = createLayerRegistry(customTabs);

    expect(reg.collectionOfTab("hazard")).toBe("r2r");
    expect(reg.collectionOfTab("gar")).toBe("gar");
    expect(reg.collectionOfTab("nonexistent")).toBeUndefined();

    expect(reg.collectionOf("flood")).toBe("r2r");
    expect(reg.collectionOf("gar-metric")).toBe("gar");
    expect(reg.collectionOf("missing")).toBeUndefined();

    expect(reg.areCompatible("flood", "missing")).toBe(false);
    expect(reg.areCompatible("flood", "flood")).toBe(true);
    expect(reg.areCompatible("flood", "gar-metric")).toBe(false);
  });
});

describe("urlKeyOrder", () => {
  it("lists published, keyed layers tab by tab in config order, ignoring groups", () => {
    const pop = { key: "pop", id: "MX-POP" };
    expect(urlKeyOrder([tabs[0], { layers: [draft, noKey, pop] }])).toEqual(["econ", "soc", "pop"]);
  });
});

describe("getLayerRegistry", () => {
  it("indexes the app's TABS once", () => {
    const registry = getLayerRegistry();
    expect(getLayerRegistry()).toBe(registry);
    expect(registry.urlKeyOrder()).toEqual(urlKeyOrder(TABS));
    expect(registry.byKey("river-flooding")?.key).toBe("river-flooding");
  });
});
