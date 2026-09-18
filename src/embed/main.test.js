import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "../../tests/support/async.js";
import { UNLOCKED_CLASS } from "./preview-gate.js";

// `createRiskMap` is the only thing mounted here that needs MapX, so it is the
// only thing replaced. The rest of the module — the parameters, the bridge, the
// gate and how they are wired — is what these tests are about. `selectTabs` must
// stay real: `params.js` imports it from this same module.
vi.mock("../app/create-risk-map.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createRiskMap: vi.fn() };
});

import { createRiskMap } from "../app/create-risk-map.js";
import { mountEmbed } from "./main.js";

/** The embed markup `embed.html` carries, reduced to the hooks this exercises. */
const MARKUP = `
  <div data-mg-preview-access data-mg-preview-id="grar-map-viewer"></div>
  <div class="embed-root" data-ui-embed>
    <section data-ui-embed-empty hidden></section>
    <nav class="embed-nav"><ul data-ui="nav"></ul></nav>
    <div class="app-map" data-ui="app-map">
      <div data-ui="mapx"></div>
      <div class="layer-panel" data-ui="layer-panel"><div data-ui="panel-body"></div></div>
    </div>
    <footer class="embed-attribution"><a data-ui-full-viewer href="./"></a></footer>
  </div>`;

/** A `createRiskMap()` stand-in: recorded setters, hand-fired events. */
function fakeMap(state = { tab: "hazard", layers: [] }) {
  const handlers = new Map();
  return {
    handlers,
    getState: vi.fn(() => state),
    setState: vi.fn(),
    setTab: vi.fn(),
    setLayers: vi.fn(),
    on: vi.fn((event, fn) => {
      handlers.set(event, fn);
      return () => handlers.delete(event);
    }),
    destroy: vi.fn(),
    emit: (event, payload) => handlers.get(event)?.(payload),
  };
}

const HOST = "https://www.undrr.org";

/**
 * A stand-in embed window: a parent that records what was posted to it, a
 * `location` the full-viewer link can be built from, and the listener list the
 * bridge attaches to.
 */
function fakeEmbedWindow() {
  const target = new EventTarget();
  const posted = [];
  const parent = { postMessage: (data, origin) => posted.push({ data, origin }) };
  Object.assign(target, {
    parent,
    posted,
    location: { href: "http://localhost:3040/embed.html", search: "", reload: vi.fn() },
    /** Deliver a host message as the browser would. */
    deliver(data, { origin = HOST } = {}) {
      const event = new Event("message");
      Object.assign(event, { data, origin, source: parent });
      target.dispatchEvent(event);
    },
  });
  return target;
}

const command = (name, payload = {}, extra = {}) => ({
  type: "undrr-risk-map",
  v: 1,
  name,
  payload,
  ...extra,
});

/** Messages posted to the host, by name. */
const named = (windowRef, name) => windowRef.posted.filter((entry) => entry.data.name === name);

describe("mountEmbed", () => {
  let embed;
  let map;
  let windowRef;
  let warn;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = MARKUP;
    map = fakeMap();
    createRiskMap.mockImplementation(() => map);
    windowRef = fakeEmbedWindow();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    embed?.destroy();
    embed = null;
    warn.mockRestore();
    document.body.innerHTML = "";
  });

  /** Mount the embed in the fixture markup. */
  function mount(search = "?tab=hazard", options = {}) {
    const root = document.querySelector("[data-ui-embed]");
    embed = mountEmbed(root, {
      windowRef,
      search,
      referrer: `${HOST}/page`,
      analytics: { sink: () => {} },
      ...options,
    });
    return embed;
  }

  /** Answer the gate the way Mangrove's script does. */
  function unlockGate() {
    document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
  }

  describe("behind the preview gate", () => {
    it("announces itself as locked so a host can say why the frame is quiet", () => {
      mount();

      const [ready] = named(windowRef, "ready");
      expect(ready.origin).toBe(HOST);
      expect(ready.data.payload).toMatchObject({ version: 1, locked: true });
      // The tabs and layers it *would* show, so a host can build its own UI
      // before anybody has answered the PIN.
      expect(ready.data.payload.tabs).toContain("hazard");
      expect(ready.data.payload.layers).toContain("landslides");
    });

    it("refuses every command, and lets none of them reach the map", () => {
      mount();

      windowRef.deliver(command("set-tab", { tab: "hazard" }, { id: "a" }));
      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }] }, { id: "b" }));
      windowRef.deliver(command("get-state", {}, { id: "c" }));

      expect(map.setTab).not.toHaveBeenCalled();
      expect(map.setState).not.toHaveBeenCalled();
      expect(named(windowRef, "state")).toEqual([]);
      expect(named(windowRef, "error").map((entry) => entry.data.payload.code)).toEqual([
        "locked",
        "locked",
        "locked",
      ]);
      expect(named(windowRef, "error").map((entry) => entry.data.id)).toEqual(["a", "b", "c"]);
    });

    it("reports no state while locked", () => {
      mount();
      map.emit("state", { tab: "hazard", layers: [{ key: "landslides", sourceIdx: 0 }] });
      expect(named(windowRef, "state")).toEqual([]);
    });

    it("answers normally once the PIN has been entered inside the frame", async () => {
      mount();
      unlockGate();
      await waitFor(() => expect(embed.gate.locked).toBe(false));

      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      windowRef.deliver(command("set-tab", { tab: "hazard" }));

      expect(map.setTab).toHaveBeenCalledWith("hazard");
      expect(named(windowRef, "ready").at(-1).data.payload).toMatchObject({ locked: false });
    });

    it("records in the analytics event that it loaded behind the gate", () => {
      const events = [];
      mount("?tab=hazard", { analytics: { sink: (event) => events.push(event) } });
      expect(events[0]).toMatchObject({ name: "embed_loaded", props: { locked: true } });
    });
  });

  describe("unlocked", () => {
    beforeEach(() => {
      document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    });

    it("says nothing about a gate it is not behind, and posts ready from the map", () => {
      mount();
      expect(named(windowRef, "ready")).toEqual([]);

      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      expect(named(windowRef, "ready")[0].data.payload).toEqual({
        version: 1,
        locked: false,
        tabs: ["hazard"],
        layers: ["landslides"],
      });
    });

    it("obeys set-tab, set-layers and get-state", () => {
      mount();

      windowRef.deliver(command("set-tab", { tab: "hazard" }));
      expect(map.setTab).toHaveBeenCalledWith("hazard");

      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }] }));
      expect(map.setState).toHaveBeenCalledWith({
        tab: undefined,
        layers: [{ key: "landslides", sourceIdx: 0 }],
      });

      windowRef.deliver(command("get-state", {}, { id: "q1" }));
      expect(named(windowRef, "state")[0].data).toMatchObject({ id: "q1" });
    });

    it("refuses a set-layers whose payload is not a list, instead of clearing the map", () => {
      // Finding 6: `{layers: null}`, `{layers: "nope"}` and a missing key all
      // used to reconcile to nothing, i.e. turn every layer off.
      mount();

      for (const payload of [{ layers: null }, { layers: "nope" }, {}, { layers: { key: "landslides" } }]) {
        windowRef.deliver(command("set-layers", payload));
      }

      expect(map.setState).not.toHaveBeenCalled();
      expect(map.setLayers).not.toHaveBeenCalled();
      expect(named(windowRef, "error").map((entry) => entry.data.payload.code)).toEqual([
        "malformed",
        "malformed",
        "malformed",
        "malformed",
      ]);
    });

    it("still accepts an empty list, which is how a host clears the map on purpose", () => {
      mount();
      windowRef.deliver(command("set-layers", { layers: [] }));
      expect(map.setState).toHaveBeenCalledWith({ tab: undefined, layers: [] });
    });

    it("never posts a resize hint", () => {
      mount();
      map.emit("state", { tab: "hazard", layers: [] });
      expect(named(windowRef, "resize")).toEqual([]);
    });

    it("keeps the full-viewer link on the state on screen", () => {
      mount();
      map.emit("state", { tab: "hazard", layers: [{ key: "landslides", sourceIdx: 0 }] });
      expect(document.querySelector("[data-ui-full-viewer]").href).toContain("#hazard?layers=landslides");
    });
  });

  describe("a configuration that selects nothing", () => {
    beforeEach(() => {
      document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    });

    it("renders an explicit empty state and builds no map", () => {
      mount("?allow=no-such-layer");

      expect(createRiskMap).not.toHaveBeenCalled();
      expect(embed.map).toBeNull();
      expect(document.querySelector("[data-ui-embed-empty]").hidden).toBe(false);
      expect(document.querySelector('[data-ui="app-map"]')).toBeNull();
    });

    it("tells the host it has nothing, and refuses commands", () => {
      mount("?tabs=no-such-tab");

      expect(named(windowRef, "ready")[0].data.payload).toMatchObject({ tabs: [], layers: [] });
      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }] }, { id: "z" }));
      expect(named(windowRef, "error")[0].data).toMatchObject({
        id: "z",
        payload: { code: "empty-configuration" },
      });
    });
  });

  it("stays silent in both directions when parentOrigin does not parse", () => {
    document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    mount("?tab=hazard&parentOrigin=not-a-url");

    map.emit("ready", { tabs: ["hazard"], layers: [] });
    windowRef.deliver(command("set-tab", { tab: "hazard" }));

    expect(embed.bridge.enabled).toBe(false);
    expect(windowRef.posted).toEqual([]);
    expect(map.setTab).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("parentOrigin");
  });

  it("takes back the gate watch, the bridge and the map on destroy", () => {
    mount();
    embed.destroy();

    windowRef.deliver(command("set-tab", { tab: "hazard" }));
    expect(map.destroy).toHaveBeenCalled();
    expect(map.setTab).not.toHaveBeenCalled();
    embed = null;
  });
});
