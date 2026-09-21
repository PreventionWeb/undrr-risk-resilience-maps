import { describe, expect, it, vi } from "vitest";
import { createLayersStore } from "../state/layers-store.js";
import { createLayerController } from "./layer-controller.js";
import { createRouter } from "./router.js";
import { createLayerRegistry } from "../config/registry.js";
function memoryAdapter(initial = { tab: null, layers: [] }) {
  let state = initial;
  const writes = [];
  const listeners = new Set();
  return {
    writes,
    read: () => state,
    write(next, { replace = false } = {}) {
      state = { tab: next.tab, layers: next.layers };
      writes.push({ tab: next.tab, keys: next.layers.map((l) => l.key), replace });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(next) {
      state = next;
      for (const fn of [...listeners]) fn(next);
    },
    listenerCount: () => listeners.size,
    destroy: vi.fn(() => listeners.clear()),
  };
}
import { clampLayers } from "../embed/params.js";

const TABS = [
  {
    id: "hazard",
    label: "Hazard",
    collection: "r2r",
    layers: [
      { key: "quake", id: "MX-QUAKE", label: "Earthquake", type: "rt" },
      {
        key: "flood",
        label: "River flood",
        type: "rt",
        sources: [
          { id: "MX-F10", label: "10 yr" },
          { id: "MX-F100", label: "100 yr" },
        ],
      },
      {
        key: "edra",
        label: "EDRA Agriculture",
        type: "vt",
        external: {
          provider: "edra-agriculture",
          defaults: { crop: "WHEAT" },
        },
      },
    ],
  },
  {
    id: "gar",
    label: "GAR",
    collection: "gar",
    crossTab: false,
    layers: [
      { key: "garFatalities", id: "MX-GAR-FATAL", label: "Human Fatalities", type: "vt" },
      { key: "garEcolosses", id: "MX-GAR-ECO", label: "Economic Losses", type: "vt" },
    ],
  },
];

const INFO_TABS = ["home", "sources", "about"];

function setupTestEnvironment({ viewAddDelay = 0, viewRemoveDelay = 0, shouldRemoveFail = false } = {}) {
  const store = createLayersStore();
  const registry = createLayerRegistry(TABS);
  const activeViews = new Set();

  let runtimeExternal = null;

  const viewAdd = vi.fn(async (viewId) => {
    if (viewAddDelay > 0) await new Promise((r) => setTimeout(r, viewAddDelay));
    activeViews.add(viewId);
  });

  const viewRemove = vi.fn(async (viewId) => {
    if (viewRemoveDelay > 0) await new Promise((r) => setTimeout(r, viewRemoveDelay));
    if (shouldRemoveFail) throw new Error(`Failed to remove view ${viewId}`);
    activeViews.delete(viewId);
  });

  const external = {
    isExternal: (l) => Boolean(l?.external),
    getRuntime: () => runtimeExternal,
    open: vi.fn(async (layer, settings) => {
      runtimeExternal = { idView: "MX-EDRA-RUNTIME", settings };
      activeViews.add("MX-EDRA-RUNTIME");
      return runtimeExternal;
    }),
    close: vi.fn(async () => {
      if (shouldRemoveFail) throw new Error("Failed to close external runtime");
      if (runtimeExternal) {
        activeViews.delete(runtimeExternal.idView);
        runtimeExternal = null;
      }
    }),
    replace: vi.fn(async (layer, settings) => {
      runtimeExternal = { idView: "MX-EDRA-RUNTIME-2", settings };
      return { runtime: runtimeExternal };
    }),
  };

  const controller = createLayerController({
    store,
    getLayer: (key) => registry.byKey(key),
    getCollection: (key) => registry.collectionOf(key),
    views: { add: viewAdd, remove: viewRemove },
    external,
  });

  const adapter = memoryAdapter({ tab: "hazard", layers: [] });

  const router = createRouter({
    controller,
    registry,
    adapter,
    dataTabs: ["hazard", "gar"],
    infoTabs: INFO_TABS,
    initialTab: "hazard",
    isReady: () => true,
    isExternal: (l) => Boolean(l?.external),
    layerKeys: () => registry.urlKeyOrder(),
  });
  router.attachTo(store);

  return {
    store,
    registry,
    activeViews,
    viewAdd,
    viewRemove,
    external,
    controller,
    adapter,
    router,
  };
}

describe("Redteam: Collection Isolation & Edge Cases", () => {
  it("PREVENTED: If view removal fails during collection switch, new layer aborts and both are never applied", async () => {
    const env = setupTestEnvironment({ shouldRemoveFail: false });
    // First, successfully apply quake (R2R)
    await env.controller.setOn("quake", true);
    expect(env.store.get("quake").applied).toBe(true);
    expect(env.activeViews.has("MX-QUAKE")).toBe(true);

    // Now configure viewRemove to fail
    env.viewRemove.mockImplementationOnce(async () => {
      throw new Error("MapX RPC network failure on view_remove");
    });

    // Attempt to turn on garFatalities (GAR)
    await env.controller.setOn("garFatalities", true);

    const quakeRecord = env.store.get("quake");
    const garRecord = env.store.get("garFatalities");

    // Quake failed to remove, so it remains applied with error
    expect(quakeRecord.applied).toBe(true);
    expect(quakeRecord.viewId).toBe("MX-QUAKE");

    // GAR layer must abort enabling: NOT applied, desired: false
    expect(garRecord.applied).toBe(false);
    expect(garRecord.desired).toBe(false);
    expect(garRecord.status).toBe("error");

    // Only MX-QUAKE is in MapX active views
    expect(env.activeViews.has("MX-QUAKE")).toBe(true);
    expect(env.activeViews.has("MX-GAR-FATAL")).toBe(false);

    // Invariant holds: collections size is exactly 1
    const activeLayers = env.store.all().filter((r) => r.applied);
    const collections = new Set(activeLayers.map((r) => env.registry.collectionOf(r.key)));
    expect(collections.size).toBe(1);
    expect(collections.has("r2r")).toBe(true);
  });

  it("PREVENTED: No asynchronous race window where both collections are applied when remove is slower than add", async () => {
    // viewRemove takes 40ms, viewAdd takes 5ms
    const env = setupTestEnvironment({ viewRemoveDelay: 40, viewAddDelay: 5 });

    await env.controller.setOn("quake", true);
    expect(env.store.get("quake").applied).toBe(true);

    // Turn on garFatalities (GAR) - this awaits quake removal before adding garFatalities
    const switchPromise = env.controller.setOn("garFatalities", true);

    // Wait 20ms: quake is in the middle of removal, garFatalities must NOT be added yet
    await new Promise((r) => setTimeout(r, 20));

    expect(env.store.get("garFatalities").applied).toBe(false);
    expect(env.activeViews.has("MX-GAR-FATAL")).toBe(false);

    // At the moment switch resolves:
    await switchPromise;
    expect(env.store.get("garFatalities").applied).toBe(true);
    expect(env.store.get("quake").applied).toBe(false);
    expect(env.activeViews.has("MX-GAR-FATAL")).toBe(true);
    expect(env.activeViews.has("MX-QUAKE")).toBe(false);

    // URL writes never had both layers at once
    for (const write of env.adapter.writes) {
      const hasQuake = write.keys.includes("quake");
      const hasGar = write.keys.includes("garFatalities");
      expect(hasQuake && hasGar).toBe(false);
    }
  });

  it("PREVENTED: router.setActiveTab failure reverts to previous tab and never writes cross-collection state to URL", async () => {
    const env = setupTestEnvironment();
    env.router.start();

    // Turn on quake (R2R)
    await env.controller.setOn("quake", true);
    expect(env.store.get("quake").applied).toBe(true);

    // Make viewRemove fail when switching tabs
    env.viewRemove.mockImplementationOnce(async () => {
      throw new Error("MapX view_remove failed");
    });

    // Switch to GAR tab
    env.router.setActiveTab("gar");

    // Wait for the tab change batch to settle
    await new Promise((r) => setTimeout(r, 50));

    // Because removal failed, the router reverted to 'hazard'
    expect(env.router.activeTab).toBe("hazard");
    expect(env.store.get("quake").applied).toBe(true);

    // The URL state is NOT corrupted: it has tab: "hazard", keys: ["quake"]
    const lastWrite = env.adapter.writes[env.adapter.writes.length - 1];
    expect(lastWrite.tab).toBe("hazard");
    expect(lastWrite.keys).toContain("quake");
  });

  it("PREVENTED: Embed host set-layers command with collection context correctly filters layers", () => {
    const registry = createLayerRegistry(TABS);
    const allowed = new Set(["quake", "flood", "edra", "garFatalities", "garEcolosses"]);

    // When tab is 'gar', collection is 'gar': flood (r2r) is dropped, garFatalities is kept!
    const clamped = clampLayers([{ key: "flood" }, { key: "garFatalities" }], {
      allowed,
      registry,
      collection: "gar",
    });
    expect(clamped).toEqual([{ key: "garFatalities", sourceIdx: 0 }]);
  });

  it("PREVENTED: Embed host set-layers with no tab infers collection matching first layer", () => {
    const registry = createLayerRegistry(TABS);
    const allowed = new Set(["quake", "flood", "edra", "garFatalities", "garEcolosses"]);

    // When no collection is specified, the first layer sets activeCollection to 'gar'
    const clamped = clampLayers([{ key: "garFatalities" }, { key: "flood" }], { allowed, registry });
    expect(clamped).toEqual([{ key: "garFatalities", sourceIdx: 0 }]);
  });

  it("EDGE CASE: External layer (EDRA) open when turning on GAR layer", async () => {
    const env = setupTestEnvironment();
    await env.controller.setOn("edra", true);

    expect(env.store.get("edra").applied).toBe(true);
    expect(env.external.getRuntime()).not.toBeNull();
    expect(env.activeViews.has("MX-EDRA-RUNTIME")).toBe(true);

    // Turn on GAR layer
    await env.controller.setOn("garFatalities", true);

    expect(env.store.get("edra").applied).toBe(false);
    expect(env.external.getRuntime()).toBeNull();
    expect(env.activeViews.has("MX-EDRA-RUNTIME")).toBe(false);
    expect(env.store.get("garFatalities").applied).toBe(true);
    expect(env.activeViews.has("MX-GAR-FATAL")).toBe(true);
  });

  it("EDGE CASE: Compound layer in mid-switch when turning on GAR layer", async () => {
    const env = setupTestEnvironment({ viewRemoveDelay: 20, viewAddDelay: 20 });

    // Turn on compound layer flood (10 yr)
    await env.controller.setOn("flood", true);
    expect(env.store.get("flood").applied).toBe(true);
    expect(env.store.get("flood").viewId).toBe("MX-F10");

    // Start a source switch to 100 yr
    const switchSourcePromise = env.controller.setSource("flood", 1);

    // While mid-switch, turn on GAR layer!
    await new Promise((r) => setTimeout(r, 10)); // let switch reach removing state
    const garPromise = env.controller.setOn("garFatalities", true);

    await Promise.all([switchSourcePromise, garPromise]);

    // flood should be completely off
    expect(env.store.get("flood").applied).toBe(false);
    expect(env.store.get("flood").desired).toBe(false);
    expect(env.store.get("garFatalities").applied).toBe(true);
  });

  it("EDGE CASE: Rapid toggling between R2R and GAR layers does not leak views in MapX", async () => {
    const env = setupTestEnvironment({ viewAddDelay: 10, viewRemoveDelay: 10 });

    // Rapid toggle: quake -> garFatalities -> quake
    const p1 = env.controller.setOn("quake", true);
    await new Promise((r) => setTimeout(r, 2));
    const p2 = env.controller.setOn("garFatalities", true);
    await new Promise((r) => setTimeout(r, 2));
    const p3 = env.controller.setOn("quake", true);

    await Promise.all([p1, p2, p3]);

    expect(env.store.get("quake").applied).toBe(true);
    expect(env.store.get("garFatalities").applied).toBe(false);

    // Only MX-QUAKE should be in activeViews
    expect(env.activeViews).toEqual(new Set(["MX-QUAKE"]));
  });
});
