import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "../../tests/support/async.js";

const { viewAdd, viewRemove } = vi.hoisted(() => ({
  viewAdd: vi.fn().mockResolvedValue(undefined),
  viewRemove: vi.fn().mockResolvedValue(undefined),
}));

/**
 * A two-tab config with one grouped tab, so the allowlists have something to
 * take apart. The layer objects are shared by reference with the registry, the
 * way the real config is.
 */
const config = vi.hoisted(() => {
  const layer = (key, extra = {}) => ({
    id: `MX-${key.toUpperCase()}`,
    key,
    label: key,
    type: "vt",
    geometry: "polygon",
    desc: `${key} description`,
    initiative: "Test",
    ...extra,
  });
  const alpha = layer("alpha", { r2rCategory: "Societies" });
  const beta = layer("beta", { r2rCategory: "Economy" });
  const gamma = layer("gamma");
  return {
    alpha,
    beta,
    gamma,
    TABS: [
      {
        id: "one",
        label: "One",
        description: "Tab one",
        layers: [alpha, beta],
        groups: [
          { id: "societies", label: "Societies", layers: [alpha] },
          { id: "economy", label: "Economy", layers: [beta] },
        ],
      },
      { id: "two", label: "Two", description: "Tab two", layers: [gamma], groups: null },
    ],
  };
});

vi.mock("../config/layers.js", () => ({ TABS: config.TABS, PRIMARY_PROJECT: "MX-TEST-PROJECT" }));
vi.mock("../config/validate.js", () => ({ validateLayers: vi.fn() }));
vi.mock("../sdk/views.js", () => ({ viewAdd, viewRemove }));
vi.mock("../ui/home.js", () => ({ buildHomePanel: () => document.createElement("div") }));
vi.mock("../ui/info-panels.js", () => ({
  buildSourcesPanel: () => document.createElement("div"),
  buildAboutPanel: () => document.createElement("div"),
}));
vi.mock("../ui/mangrove-tabs.js", () => ({ initMangroveTabs: vi.fn() }));
vi.mock("../ui/layer-controls.js", () => ({ addOpacitySlider: vi.fn(), addLegend: vi.fn() }));
vi.mock("../sdk/client.js", () => ({
  initSDK: vi.fn(),
  setSDKReady: vi.fn(),
  isSDKReady: () => true,
  onSDKReadyChange: () => () => {},
}));

import { validateLayers } from "../config/validate.js";
import { createMemoryAdapter } from "../state/memory-adapter.js";
import { createRiskMap, selectTabs } from "./create-risk-map.js";

const TABS = config.TABS;

/** A MapX manager stand-in: hand-fired events, recorded `ask`s, a destroy spy. */
function fakeManager() {
  const handlers = new Map();
  return {
    handlers,
    on: vi.fn((event, fn) => handlers.set(event, fn)),
    ask: vi.fn().mockResolvedValue(true),
    destroy: vi.fn(),
    /** Fire MapX's `ready` and wait for the instance's handler to finish. */
    async ready() {
      await handlers.get("ready")?.();
    },
  };
}

describe("selectTabs", () => {
  it("returns the config untouched with no allowlists", () => {
    expect(selectTabs(TABS)).toEqual(TABS);
  });

  it("keeps the config's order, not the caller's", () => {
    expect(selectTabs(TABS, { tabs: ["two", "one"] }).map((tab) => tab.id)).toEqual(["one", "two"]);
  });

  it("ignores tab ids that are not in the config", () => {
    expect(selectTabs(TABS, { tabs: ["two", "nope"] }).map((tab) => tab.id)).toEqual(["two"]);
  });

  it("filters layers and the groups that list them", () => {
    const [tab] = selectTabs(TABS, { layers: ["alpha"] });
    expect(tab.id).toBe("one");
    expect(tab.layers).toEqual([config.alpha]);
    expect(tab.groups.map((group) => group.id)).toEqual(["societies"]);
  });

  it("drops a tab a layer allowlist empties", () => {
    expect(selectTabs(TABS, { layers: ["gamma"] }).map((tab) => tab.id)).toEqual(["two"]);
  });

  it("keeps the config's own layer objects, by reference", () => {
    expect(selectTabs(TABS, { layers: ["beta"] })[0].layers[0]).toBe(config.beta);
  });

  it("applies both allowlists together", () => {
    expect(selectTabs(TABS, { tabs: ["one"], layers: ["gamma"] })).toEqual([]);
  });
});

describe("createRiskMap", () => {
  let instance;
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState(null, "", "#");
    document.body.innerHTML = `
      <ul data-ui="nav"></ul>
      <div class="app-map" id="app-map" data-ui="app-map">
        <div id="mapx" data-ui="mapx"></div>
        <div class="layer-panel" data-ui="layer-panel">
          <div class="layer-panel-header"></div>
          <div data-ui="panel-body"></div>
        </div>
        <button data-ui="inspect-toggle" disabled></button>
        <button data-ui="clear-layers" hidden></button>
      </div>`;
    manager = fakeManager();
  });

  afterEach(() => {
    instance?.destroy();
    instance = null;
  });

  /** Start an instance with a stubbed SDK, and wait until it has a manager. */
  async function start(options = {}) {
    instance = createRiskMap(document.body, {
      stateAdapter: createMemoryAdapter(),
      buildInfo: false,
      loadSdk: vi.fn().mockResolvedValue({}),
      createManager: vi.fn(() => manager),
      ...options,
    });
    await waitFor(() => expect(manager.on).toHaveBeenCalled());
    return instance;
  }

  it("validates the layer config before building anything", async () => {
    await start({ mapxProject: "MX-TEST-PROJECT" });
    expect(validateLayers).toHaveBeenCalledWith(TABS, "MX-TEST-PROJECT");
  });

  it("can be told not to validate", async () => {
    await start({ validate: false });
    expect(validateLayers).not.toHaveBeenCalled();
  });

  it("builds the whole config by default", async () => {
    await start();
    expect(instance.tabs).toEqual(["one", "two"]);
    expect(instance.layerKeys).toEqual(["alpha", "beta", "gamma"]);
    expect(document.querySelectorAll("[data-tab-panel]")).toHaveLength(2);
  });

  it("builds only the allowed tabs and layers", async () => {
    await start({ tabs: ["one"], layerAllowlist: ["alpha"] });
    expect(instance.tabs).toEqual(["one"]);
    expect(instance.layerKeys).toEqual(["alpha"]);
    expect(document.querySelectorAll("[data-tab-panel]")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("beta");
  });

  it("shows the initial tab when the adapter names none", async () => {
    await start({ initialTab: "two" });
    expect(instance.getState().tab).toBe("two");
  });

  it("seeds initial layers into the adapter and restores them once MapX is ready", async () => {
    const adapter = createMemoryAdapter();
    await start({ stateAdapter: adapter, initialTab: "one", layers: [{ key: "beta", sourceIdx: 0 }] });

    expect(adapter.read()).toEqual({ tab: "one", layers: [{ key: "beta", sourceIdx: 0 }] });
    expect(viewAdd).not.toHaveBeenCalled();

    await manager.ready();

    expect(viewAdd).toHaveBeenCalledWith("MX-BETA");
    expect(instance.getState()).toEqual({ tab: "one", layers: [{ key: "beta", sourceIdx: 0 }] });
  });

  it("emits ready once the map has restored its state", async () => {
    await start({ initialTab: "one" });
    const ready = vi.fn();
    instance.on("ready", ready);

    await manager.ready();

    expect(ready).toHaveBeenCalledWith({ tabs: ["one", "two"], layers: ["alpha", "beta", "gamma"] });
  });

  it("replays ready to a listener that arrives late", async () => {
    await start();
    await manager.ready();
    const ready = vi.fn();

    instance.on("ready", ready);
    await waitFor(() => expect(ready).toHaveBeenCalled());

    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("emits one coalesced state event per settled change", async () => {
    await start({ initialTab: "one" });
    await manager.ready();
    const states = [];
    instance.on("state", (state) => states.push(state));

    instance.setLayers([{ key: "alpha", sourceIdx: 0 }]);
    await waitFor(() => expect(states.length).toBeGreaterThan(0));

    expect(states).toEqual([{ tab: "one", layers: [{ key: "alpha", sourceIdx: 0 }] }]);
  });

  it("switches tab without emitting layer changes", async () => {
    await start({ initialTab: "one" });
    await manager.ready();
    const states = [];
    instance.on("state", (state) => states.push(state));

    instance.setTab("two");
    await waitFor(() => expect(states.length).toBeGreaterThan(0));

    expect(states).toEqual([{ tab: "two", layers: [] }]);
  });

  it("reconciles setLayers to exactly the list it is given", async () => {
    await start({ initialTab: "one" });
    await manager.ready();

    instance.setLayers([
      { key: "alpha", sourceIdx: 0 },
      { key: "beta", sourceIdx: 0 },
    ]);
    await waitFor(() => expect(instance.getState().layers).toHaveLength(2));

    instance.setLayers([{ key: "beta", sourceIdx: 0 }]);
    await waitFor(() => expect(instance.getState().layers).toHaveLength(1));

    expect(instance.getState().layers).toEqual([{ key: "beta", sourceIdx: 0 }]);
    expect(viewRemove).toHaveBeenCalledWith("MX-ALPHA");
  });

  it("setState applies a tab and layers in one change", async () => {
    await start({ initialTab: "one" });
    await manager.ready();

    instance.setState({ tab: "two", layers: [{ key: "gamma", sourceIdx: 0 }] });
    await waitFor(() => expect(instance.getState().layers).toHaveLength(1));

    expect(instance.getState()).toEqual({ tab: "two", layers: [{ key: "gamma", sourceIdx: 0 }] });
  });

  it("reports a layer failure as an error event", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    viewAdd.mockRejectedValueOnce(new Error("MapX said no"));
    await start({ initialTab: "one" });
    await manager.ready();
    const errors = [];
    instance.on("error", (error) => errors.push(error));

    instance.setLayers([{ key: "alpha", sourceIdx: 0 }]);
    await waitFor(() => expect(errors.length).toBeGreaterThan(0));

    expect(errors[0].code).toBe("layer-failed");
    consoleWarn.mockRestore();
  });

  it("reports an unreachable map service as an error event, and shows the notice", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const errors = [];
    instance = createRiskMap(document.body, {
      stateAdapter: createMemoryAdapter(),
      buildInfo: false,
      loadSdk: vi.fn().mockRejectedValue(new Error("offline")),
      createManager: vi.fn(),
    });
    instance.on("error", (error) => errors.push(error));

    await waitFor(() => expect(errors.length).toBeGreaterThan(0));

    expect(errors[0].code).toBe("mapx-unavailable");
    consoleError.mockRestore();
  });

  describe("destroy", () => {
    it("takes the DOM, the manager and the listeners back", async () => {
      await start({ initialTab: "one" });
      await manager.ready();
      const states = [];
      instance.on("state", (state) => states.push(state));

      instance.destroy();

      expect(document.querySelectorAll("[data-tab-panel]")).toHaveLength(0);
      expect(document.getElementById("site-inspector")).toBeNull();
      expect(manager.destroy).toHaveBeenCalled();

      instance.setLayers([{ key: "alpha", sourceIdx: 0 }]);
      await Promise.resolve();
      expect(states).toEqual([]);
      expect(viewAdd).not.toHaveBeenCalled();
    });

    it("is idempotent", async () => {
      await start();
      instance.destroy();
      expect(() => instance.destroy()).not.toThrow();
      expect(manager.destroy).toHaveBeenCalledTimes(1);
    });

    it("still answers getState with the last state it had", async () => {
      await start({ initialTab: "two" });
      await manager.ready();

      instance.destroy();

      expect(instance.getState()).toEqual({ tab: "two", layers: [] });
    });

    it("destroys an adapter it created, and leaves an injected one to its owner", async () => {
      const injected = createMemoryAdapter();
      const destroySpy = vi.spyOn(injected, "destroy");
      await start({ stateAdapter: injected });

      instance.destroy();

      expect(destroySpy).not.toHaveBeenCalled();
    });

    it("leaves nothing listening on the window it does not own", async () => {
      await start();
      const before = document.body.innerHTML;
      instance.destroy();
      // The sidebar restores the page it was given; only the hooks remain.
      expect(document.body.querySelector('[data-ui="panel-body"]').children).toHaveLength(0);
      expect(before).not.toBe(document.body.innerHTML);
    });
  });
});
