import { describe, expect, it, vi } from "vitest";
import { waitFor } from "../../tests/support/async.js";
import { createRouter, hashChangeAction } from "./router.js";
import { createLayersStore } from "../state/layers-store.js";
import { createLayerController } from "./layer-controller.js";
import { createLayerRegistry } from "../config/registry.js";

// Pure router tests: no DOM, no `location`, no `history`. URL state is a memory
// adapter recording every write, so the push/replace rule is read off the log.

const TABS = [
  {
    id: "hazard",
    label: "Hazard",
    layers: [
      { key: "quake", id: "MX-QUAKE", label: "Earthquake", type: "rt" },
      {
        key: "flood",
        id: null,
        label: "Flood",
        type: "rt",
        sources: [
          { id: "MX-F50", label: "50 yr" },
          { id: "MX-F100", label: "100 yr" },
        ],
        widget: { type: "sub-tabs" },
      },
    ],
  },
  {
    id: "exposure",
    label: "Exposure",
    layers: [{ key: "pop", id: "MX-POP", label: "Population", type: "vt" }],
  },
];

const INFO_TABS = ["home", "sources", "about"];
const DATA_TABS = TABS.map((tab) => tab.id);

/** A URL state adapter kept in memory, logging every write with its mode. */
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
    /** Simulate an external change (back/forward, a link, a typed URL). */
    emit(next) {
      state = next;
      for (const fn of [...listeners]) fn(next);
    },
    listenerCount: () => listeners.size,
    destroy: vi.fn(() => listeners.clear()),
  };
}

/** A deferred promise, for holding a MapX call open. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup({ adapter = memoryAdapter(), views, initialTab = "home", isReady = () => true } = {}) {
  const store = createLayersStore();
  const registry = createLayerRegistry(TABS);
  const viewAdd = views?.add ?? vi.fn(async () => {});
  const viewRemove = views?.remove ?? vi.fn(async () => {});
  const controller = createLayerController({
    store,
    getLayer: (key) => registry.byKey(key),
    views: { add: viewAdd, remove: viewRemove },
    external: {
      isExternal: () => false,
      getRuntime: () => null,
      open: vi.fn(),
      close: vi.fn(),
      replace: vi.fn(),
    },
  });
  const tabs = [];
  const router = createRouter({
    controller,
    registry,
    adapter,
    dataTabs: DATA_TABS,
    infoTabs: INFO_TABS,
    initialTab,
    isReady,
    layerKeys: () => ["quake", "flood", "pop"],
  });
  // The store subscription, and so the URL write, starts here. The sidebar
  // calls this between its own two subscriptions; see sidebar.order.test.js.
  router.attachTo(store);
  router.onTabChange((tab) => tabs.push(tab));
  return { adapter, store, controller, router, tabs, viewAdd, viewRemove };
}

// ---------------------------------------------------------------------------
// hashChangeAction
// ---------------------------------------------------------------------------

describe("hashChangeAction", () => {
  const tabs = { dataTabs: ["hazard", "exposure"], infoTabs: ["home", "sources", "about"] };
  const layers = [{ key: "population", sourceIdx: 0 }];

  it("ignores empty, unknown and in-page anchor hashes", () => {
    expect(hashChangeAction({ tab: null, layers: [] }, tabs)).toBe("ignore");
    expect(hashChangeAction({ tab: "mg-tabs__section-sources-1", layers: [] }, tabs)).toBe("ignore");
    expect(hashChangeAction({ tab: "unknown", layers }, tabs)).toBe("ignore");
  });

  it("keeps layers for an info tab without layers", () => {
    expect(hashChangeAction({ tab: "sources", layers: [] }, tabs)).toBe("keep-layers");
    expect(hashChangeAction({ tab: "home", layers: [] }, tabs)).toBe("keep-layers");
  });

  it("reconciles an info tab that carries layers", () => {
    expect(hashChangeAction({ tab: "about", layers }, tabs)).toBe("reconcile");
  });

  it("reconciles data tabs, with or without layers", () => {
    expect(hashChangeAction({ tab: "hazard", layers }, tabs)).toBe("reconcile");
    expect(hashChangeAction({ tab: "exposure", layers: [] }, tabs)).toBe("reconcile");
  });
});

// ---------------------------------------------------------------------------
// The active tab
// ---------------------------------------------------------------------------

describe("start()", () => {
  it("shows the tab in URL state and leaves that state alone", () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [{ key: "quake", sourceIdx: 0 }] });
    const { router, tabs } = setup({ adapter });

    router.start();

    expect(router.activeTab).toBe("hazard");
    expect(tabs).toEqual(["hazard"]);
    // A valid incoming URL is preserved until the SDK can restore its layers.
    expect(adapter.writes).toEqual([]);
  });

  it("falls back to initialTab and replaces the entry when URL state names no tab", () => {
    const { adapter, router } = setup({ initialTab: "exposure" });

    router.start();

    expect(router.activeTab).toBe("exposure");
    expect(adapter.writes).toEqual([{ tab: "exposure", keys: [], replace: true }]);
  });

  it("falls back to initialTab for an unknown tab, and to home for an unknown initialTab", () => {
    const unknown = setup({ adapter: memoryAdapter({ tab: "nope", layers: [] }), initialTab: "hazard" });
    unknown.router.start();
    expect(unknown.router.activeTab).toBe("hazard");

    const noSuchInitial = setup({ initialTab: "not-a-tab" });
    noSuchInitial.router.start();
    expect(noSuchInitial.router.activeTab).toBe("home");
  });

  it("pushes one entry per tab switch and reports it once", () => {
    const { adapter, router, tabs } = setup();
    router.start();

    router.setActiveTab("hazard");
    router.setActiveTab("sources");

    expect(tabs).toEqual(["home", "hazard", "sources"]);
    expect(adapter.writes.slice(1)).toEqual([
      { tab: "hazard", keys: [], replace: false },
      { tab: "sources", keys: [], replace: false },
    ]);
  });

  it("stops reporting tab changes after unsubscribing", () => {
    const { router } = setup();
    const seen = [];
    const off = router.onTabChange((tab) => seen.push(tab));
    router.start();
    off();
    router.setActiveTab("hazard");
    expect(seen).toEqual(["home"]);
  });
});

// ---------------------------------------------------------------------------
// One history entry per user action
// ---------------------------------------------------------------------------

describe("one history entry per action", () => {
  it("pushes one entry for a layer turned on", async () => {
    const { adapter, router, controller } = setup();
    router.start();

    await controller.setOn("quake", true);

    expect(adapter.writes.slice(1)).toEqual([{ tab: "home", keys: ["quake"], replace: false }]);
  });

  it("replaces the pushed entry for the rest of an action still pending", async () => {
    const slow = deferred();
    const add = vi.fn(() => slow.promise);
    const { adapter, router, controller } = setup({ views: { add } });
    router.start();

    // Click on, then off again while the first MapX call is still in flight:
    // latest intent wins, and both writes belong to one action.
    const onPromise = controller.setOn("quake", true);
    controller.setOn("quake", false);
    slow.resolve();
    await onPromise;

    const writes = adapter.writes.slice(1);
    expect(writes[0]).toEqual({ tab: "home", keys: ["quake"], replace: false });
    expect(writes.slice(1).every((write) => write.replace)).toBe(true);
    expect(writes.at(-1).keys).toEqual([]);
  });

  it("pushes again for the next action once the previous one settled", async () => {
    const { adapter, router, controller } = setup();
    router.start();
    await controller.setOn("quake", true);
    await controller.setOn("quake", false);

    const pushes = adapter.writes.slice(1).filter((write) => !write.replace);
    expect(pushes).toEqual([
      { tab: "home", keys: ["quake"], replace: false },
      { tab: "home", keys: [], replace: false },
    ]);
  });

  it("writes the URL once for clear-all, as a push", async () => {
    const { adapter, router, controller, store } = setup();
    router.start();
    await controller.setOn("quake", true);
    await controller.setOn("pop", true);
    const before = adapter.writes.length;

    router.asOneEntry(() => controller.clearAll());
    await waitFor(() => expect(store.get("pop").applied).toBe(false));

    expect(adapter.writes.slice(before)).toEqual([{ tab: "home", keys: [], replace: false }]);
  });

  it("writes layers in the config's URL key order, not the order they were asked for", async () => {
    const { adapter, router, controller } = setup();
    router.start();

    await controller.setOn("pop", true);
    await controller.setOn("quake", true);

    expect(adapter.writes.at(-1).keys).toEqual(["quake", "pop"]);
  });

  it("logs a failed write and keeps going", async () => {
    const adapter = memoryAdapter();
    adapter.write = () => {
      throw new Error("rate limited");
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { router, controller, store } = setup({ adapter });
    router.start();

    await controller.setOn("quake", true);

    expect(error).toHaveBeenCalled();
    expect(store.get("quake").applied).toBe(true);
    error.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Restore and external changes
// ---------------------------------------------------------------------------

describe("restoreFromUrl()", () => {
  it("asks for the layers in URL order and rewrites the entry in place, once", async () => {
    const adapter = memoryAdapter({
      tab: "hazard",
      layers: [
        { key: "pop", sourceIdx: 0 },
        { key: "flood", sourceIdx: 1 },
      ],
    });
    const { router, viewAdd } = setup({ adapter });
    router.start();

    await router.restoreFromUrl();

    expect(viewAdd.mock.calls.map(([id]) => id)).toEqual(["MX-POP", "MX-F100"]);
    expect(adapter.writes).toEqual([{ tab: "hazard", keys: ["flood", "pop"], replace: true }]);
  });

  it("clamps an out-of-range source index and ignores unknown keys", async () => {
    const adapter = memoryAdapter({
      tab: "hazard",
      layers: [
        { key: "flood", sourceIdx: 99 },
        { key: "not-a-layer", sourceIdx: 0 },
      ],
    });
    const { router, viewAdd } = setup({ adapter });
    router.start();

    await router.restoreFromUrl();

    expect(viewAdd.mock.calls.map(([id]) => id)).toEqual(["MX-F50"]);
  });

  it("writes nothing when URL state carries no layers", async () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [] });
    const { router } = setup({ adapter });
    router.start();

    await router.restoreFromUrl();

    expect(adapter.writes).toEqual([]);
  });

  it("warns and restores nothing after destroy", async () => {
    const adapter = memoryAdapter({ tab: "hazard", layers: [{ key: "quake", sourceIdx: 0 }] });
    const { router, viewAdd } = setup({ adapter });
    router.start();
    router.destroy();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await router.restoreFromUrl();

    expect(warn).toHaveBeenCalledOnce();
    expect(viewAdd).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("an external change to URL state", () => {
  it("ignores a state the app does not own", async () => {
    const { adapter, router, tabs, viewAdd } = setup();
    router.start();
    await Promise.resolve();
    const before = adapter.writes.length;

    adapter.emit({ tab: "mg-tabs__section-sources-1", layers: [] });

    expect(tabs).toEqual(["home"]);
    expect(adapter.writes).toHaveLength(before);
    expect(viewAdd).not.toHaveBeenCalled();
  });

  it("keeps the open layers for a bare info-tab state, rewriting the entry in place", async () => {
    const { adapter, router, controller, tabs } = setup();
    router.start();
    await controller.setOn("quake", true);
    const before = adapter.writes.length;

    adapter.emit({ tab: "sources", layers: [] });

    expect(tabs).toEqual(["home", "sources"]);
    expect(adapter.writes.slice(before)).toEqual([{ tab: "sources", keys: ["quake"], replace: true }]);
  });

  it("reconciles layers to the new state, adding no history entry", async () => {
    const { adapter, router, controller, store, viewAdd, viewRemove } = setup();
    router.start();
    await controller.setOn("quake", true);
    const before = adapter.writes.length;
    viewAdd.mockClear();

    adapter.emit({ tab: "hazard", layers: [{ key: "pop", sourceIdx: 0 }] });
    await waitFor(() => expect(store.get("pop").applied).toBe(true));
    await waitFor(() => expect(store.get("quake").applied).toBe(false));

    expect(viewRemove).toHaveBeenCalledWith("MX-QUAKE");
    expect(viewAdd).toHaveBeenCalledWith("MX-POP");
    expect(adapter.writes.slice(before).every((write) => write.replace)).toBe(true);
  });

  it("does not reconcile before the map is ready", async () => {
    let ready = false;
    const { adapter, router, viewAdd } = setup({ isReady: () => ready });
    router.start();

    adapter.emit({ tab: "hazard", layers: [{ key: "quake", sourceIdx: 0 }] });
    await Promise.resolve();
    expect(viewAdd).not.toHaveBeenCalled();

    ready = true;
    adapter.emit({ tab: "hazard", layers: [{ key: "quake", sourceIdx: 0 }] });
    await waitFor(() => expect(viewAdd).toHaveBeenCalledWith("MX-QUAKE"));
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe("destroy()", () => {
  it("drops its subscriptions and destroys only an adapter it created", () => {
    const { adapter, router, store } = setup();
    router.start();
    expect(adapter.listenerCount()).toBe(1);

    router.destroy();

    expect(adapter.listenerCount()).toBe(0);
    expect(adapter.destroy).not.toHaveBeenCalled();
    // The store subscription is gone too: a later record change writes nothing.
    store.set("quake", { desired: true });
    expect(adapter.writes.filter((write) => write.keys.length > 0)).toEqual([]);
  });

  it("makes every method inert and keeps the last tab readable", () => {
    const { adapter, router, tabs } = setup();
    router.start();
    router.destroy();
    const before = adapter.writes.length;
    const batched = vi.fn();

    router.setActiveTab("hazard");
    router.asOneEntry(batched);
    router.start();

    // A batched change does not even run: the router drives nothing after destroy.
    expect(batched).not.toHaveBeenCalled();

    expect(router.activeTab).toBe("home");
    expect(tabs).toEqual(["home"]);
    expect(adapter.writes).toHaveLength(before);
  });

  it("drops a layer change that settles after destroy", async () => {
    const slow = deferred();
    const { adapter, router, controller } = setup({ views: { add: vi.fn(() => slow.promise) } });
    router.start();
    const pending = controller.setOn("quake", true);
    const before = adapter.writes.length;

    router.destroy();
    slow.resolve();
    await pending;

    expect(adapter.writes).toHaveLength(before);
  });
});
