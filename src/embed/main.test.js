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
import { MAX_QUEUED_COMMANDS, mountEmbed } from "./main.js";
import { FEATURES } from "./messaging.js";

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

/** What the fake map's camera reports. */
const VIEW = { center: { lng: 10, lat: 45 }, zoom: 4, bounds: [0, 40, 20, 50] };

/** A `createRiskMap()` stand-in: recorded setters, hand-fired events. */
function fakeMap(state = { tab: "hazard", layers: [] }) {
  const handlers = new Map();
  return {
    handlers,
    getState: vi.fn(() => state),
    setState: vi.fn(),
    setTab: vi.fn(),
    setLayers: vi.fn(),
    getView: vi.fn(async () => VIEW),
    setView: vi.fn(async () => {}),
    fitBounds: vi.fn(async () => {}),
    fitArea: vi.fn(async () => {}),
    fitLayer: vi.fn(async () => {}),
    tabs: ["hazard"],
    layerKeys: ["landslides"],
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

  /** Mount, and have the map report ready. */
  function mountReady(search, options) {
    mount(search, options);
    map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
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

    it("never reports `locked: false` while the gate is shut, even if the map becomes ready", () => {
      mount();
      // Real MapX cannot get here — it makes no progress behind the gate's
      // `visibility: hidden` (#24) — but `locked` is a claim about the gate, so
      // it has to be read from the gate rather than assumed by whoever posts it.
      // With a stubbed or a future map that does fire `ready`, the host would
      // otherwise be told the prototype had been unlocked.
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });

      const readies = named(windowRef, "ready").map((entry) => entry.data.payload);
      expect(readies).toHaveLength(2);
      for (const payload of readies) expect(payload.locked).toBe(true);
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
        features: FEATURES,
      });
    });

    it("obeys set-tab, set-layers and get-state", async () => {
      mountReady();

      windowRef.deliver(command("set-tab", { tab: "hazard" }));
      await waitFor(() => expect(map.setTab).toHaveBeenCalledWith("hazard"));

      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }] }));
      await waitFor(() =>
        expect(map.setState).toHaveBeenCalledWith({
          tab: undefined,
          layers: [{ key: "landslides", sourceIdx: 0 }],
        }),
      );

      windowRef.deliver(command("get-state", {}, { id: "q1" }));
      await waitFor(() => expect(named(windowRef, "state")[0].data).toMatchObject({ id: "q1" }));
    });

    it("refuses a set-layers whose payload is not a list, instead of clearing the map", async () => {
      // Finding 6: `{layers: null}`, `{layers: "nope"}` and a missing key all
      // used to reconcile to nothing, i.e. turn every layer off.
      mountReady();

      for (const payload of [{ layers: null }, { layers: "nope" }, {}, { layers: { key: "landslides" } }]) {
        windowRef.deliver(command("set-layers", payload));
      }

      await waitFor(() =>
        expect(named(windowRef, "error").map((entry) => entry.data.payload.code)).toEqual([
          "malformed",
          "malformed",
          "malformed",
          "malformed",
        ]),
      );
      expect(map.setState).not.toHaveBeenCalled();
      expect(map.setLayers).not.toHaveBeenCalled();
    });

    it("still accepts an empty list, which is how a host clears the map on purpose", () => {
      mountReady();
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

  describe("the command queue", () => {
    beforeEach(() => {
      document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    });

    it("keeps commands sent before ready and runs them in order once the map is up", async () => {
      mount();
      const calls = [];
      map.setTab.mockImplementation(() => calls.push("set-tab"));
      map.setState.mockImplementation(() => calls.push("set-layers"));
      map.fitLayer.mockImplementation(async () => calls.push("fit-layer"));

      windowRef.deliver(command("set-tab", { tab: "hazard" }, { id: "s1" }));
      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }] }, { id: "s2" }));
      windowRef.deliver(command("fit-layer", { key: "landslides" }, { id: "s3" }));
      windowRef.deliver(command("get-state", {}, { id: "s4" }));

      // Nothing reaches the map before it is ready, and nothing is refused.
      await Promise.resolve();
      expect(calls).toEqual([]);
      expect(named(windowRef, "error")).toEqual([]);

      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      await waitFor(() => expect(named(windowRef, "state")).toHaveLength(1));

      expect(calls).toEqual(["set-tab", "set-layers", "fit-layer"]);
      // `ready` first, then the answers, in the order they were asked for.
      const order = windowRef.posted.map((entry) => `${entry.data.name}:${entry.data.id ?? ""}`);
      expect(order).toEqual(["ready:", "view:s3", "state:s4"]);
    });

    it("finishes a camera command before it starts the next one", async () => {
      mountReady();
      let land;
      map.setView.mockImplementation(() => new Promise((resolve) => (land = resolve)));

      windowRef.deliver(command("set-view", { zoom: 5 }, { id: "v" }));
      windowRef.deliver(command("set-tab", { tab: "hazard" }));
      await waitFor(() => expect(map.setView).toHaveBeenCalled());
      expect(map.setTab).not.toHaveBeenCalled();

      land();
      await waitFor(() => expect(map.setTab).toHaveBeenCalledWith("hazard"));
      expect(named(windowRef, "view")[0].data).toMatchObject({ id: "v", payload: VIEW });
    });

    it("refuses one command past the limit with queue-full, and keeps the rest", async () => {
      mount();
      for (let i = 0; i <= MAX_QUEUED_COMMANDS; i += 1) {
        windowRef.deliver(command("get-state", {}, { id: `q${i}` }));
      }
      expect(named(windowRef, "error").map((entry) => entry.data)).toEqual([
        expect.objectContaining({
          id: `q${MAX_QUEUED_COMMANDS}`,
          payload: expect.objectContaining({ code: "queue-full" }),
        }),
      ]);

      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      await waitFor(() => expect(named(windowRef, "state")).toHaveLength(MAX_QUEUED_COMMANDS));
    });

    it("keeps going after a command fails", async () => {
      mountReady();
      map.setView.mockRejectedValueOnce(new Error("boom"));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      windowRef.deliver(command("set-view", { zoom: 3 }, { id: "bad" }));
      windowRef.deliver(command("get-state", {}, { id: "after" }));

      await waitFor(() => expect(named(windowRef, "state")).toHaveLength(1));
      expect(named(windowRef, "error")[0].data).toMatchObject({
        id: "bad",
        payload: { code: "command-failed" },
      });
      error.mockRestore();
    });

    it("drops what is queued when the embed is destroyed", async () => {
      mount();
      windowRef.deliver(command("set-tab", { tab: "hazard" }));
      embed.destroy();
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      await Promise.resolve();
      expect(map.setTab).not.toHaveBeenCalled();
      embed = null;
    });
  });

  describe("the preview gate and the queue", () => {
    it("queues nothing while locked: every command is refused straight away", async () => {
      mount();
      windowRef.deliver(command("set-view", { zoom: 4 }, { id: "early" }));
      expect(named(windowRef, "error")[0].data).toMatchObject({ id: "early", payload: { code: "locked" } });

      unlockGate();
      await waitFor(() => expect(embed.gate.locked).toBe(false));
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      await Promise.resolve();
      // The refused command does not come back to life after the unlock.
      expect(map.setView).not.toHaveBeenCalled();
    });

    it("advertises its features even while locked", () => {
      mount();
      expect(named(windowRef, "ready")[0].data.payload.features).toEqual(FEATURES);
    });

    it("posts an unlocked ready when the gate opens on a map that is already up", async () => {
      mount();
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      expect(named(windowRef, "ready").map((entry) => entry.data.payload.locked)).toEqual([true, true]);

      unlockGate();
      await waitFor(() => expect(named(windowRef, "ready")).toHaveLength(3));
      expect(named(windowRef, "ready")[2].data.payload).toMatchObject({ locked: false, features: FEATURES });

      windowRef.deliver(command("set-tab", { tab: "hazard" }));
      await waitFor(() => expect(map.setTab).toHaveBeenCalledWith("hazard"));
    });

    it("holds the URL's camera until the gate is open and the map is ready", async () => {
      mount("?tab=hazard&area=KEN");
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });
      await Promise.resolve();
      expect(map.fitArea).not.toHaveBeenCalled();

      unlockGate();
      await waitFor(() => expect(map.fitArea).toHaveBeenCalledWith("KEN", { animate: false }));
    });
  });

  describe("camera commands", () => {
    beforeEach(() => {
      document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    });

    /** Deliver a command and wait for the reply carrying its id. */
    async function ask(name, payload, id = name) {
      windowRef.deliver(command(name, payload, { id }));
      await waitFor(() => expect(windowRef.posted.some((entry) => entry.data.id === id)).toBe(true));
      return windowRef.posted.find((entry) => entry.data.id === id).data;
    }

    it("answers get-view with a view carrying the same id", async () => {
      mountReady();
      expect(await ask("get-view", {}, "g1")).toMatchObject({ name: "view", payload: VIEW });
    });

    it("validates and clamps set-view before it reaches the map", async () => {
      mountReady();
      await ask("set-view", { center: { lng: 36.8, lat: 89 }, zoom: 99, animate: true });
      expect(map.setView).toHaveBeenCalledWith({
        center: { lng: 36.8, lat: 85.051129 },
        zoom: 22,
        animate: true,
      });

      for (const payload of [{}, { center: { lng: 200, lat: 0 } }, { zoom: "far" }, { center: [1] }]) {
        const reply = await ask("set-view", payload, JSON.stringify(payload));
        expect(reply.payload.code, JSON.stringify(payload)).toBe("malformed");
      }
      expect(map.setView).toHaveBeenCalledTimes(1);
    });

    it("runs fit-bounds and fit-area, and answers each with the view", async () => {
      mountReady();
      expect(await ask("fit-bounds", { bounds: [-20, -35, 52, 38] }, "b")).toMatchObject({ name: "view" });
      expect(map.fitBounds).toHaveBeenCalledWith([-20, -35, 52, 38]);

      expect(await ask("fit-area", { code: "ken" }, "a")).toMatchObject({ name: "view" });
      expect(map.fitArea).toHaveBeenCalledWith("KEN", { animate: false });
    });

    it("refuses malformed bounds and area codes", async () => {
      mountReady();
      for (const bounds of [undefined, "0,0,10,10", [10, 0, -10, 5], [0, 0, 1]]) {
        expect((await ask("fit-bounds", { bounds }, `b-${bounds}`)).payload.code).toBe("malformed");
      }
      for (const code of [undefined, "Kenya", 404]) {
        expect((await ask("fit-area", { code }, `a-${code}`)).payload.code).toBe("malformed");
      }
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.fitArea).not.toHaveBeenCalled();
    });

    it("refuses fit-layer for a layer outside the allowlist, as if it did not exist", async () => {
      mountReady("?tab=hazard&allow=landslides");
      for (const key of ["population", "no-such-layer", 7]) {
        const reply = await ask("fit-layer", { key }, `l-${key}`);
        expect(reply.payload.code).toBe("unknown-layer");
      }
      expect(map.fitLayer).not.toHaveBeenCalled();
    });

    it("passes on the map's own refusal, code and all", async () => {
      mountReady();
      map.fitLayer.mockRejectedValueOnce(
        Object.assign(new Error('Layer "landslides" is off'), { code: "layer-off" }),
      );
      expect(await ask("fit-layer", { key: "landslides" }, "off")).toMatchObject({
        name: "error",
        payload: { code: "layer-off", message: 'Layer "landslides" is off' },
      });
    });

    it("frames the map from its URL first, and answers nobody for it", async () => {
      mount("?tab=hazard&bbox=-20,-35,52,38");
      windowRef.deliver(command("get-view", {}, { id: "after-url" }));
      map.emit("ready", { tabs: ["hazard"], layers: ["landslides"] });

      await waitFor(() => expect(named(windowRef, "view")).toHaveLength(1));
      expect(map.fitBounds).toHaveBeenCalledWith([-20, -35, 52, 38]);
      expect(map.fitBounds.mock.invocationCallOrder[0]).toBeLessThan(map.getView.mock.invocationCallOrder[0]);
      expect(named(windowRef, "view")[0].data.id).toBe("after-url");
    });

    it("tells the host, without an id, when the URL's camera cannot be applied", async () => {
      map.fitArea.mockRejectedValueOnce(Object.assign(new Error("no such area"), { code: "unknown-area" }));
      mountReady("?tab=hazard&area=XYZ");
      await waitFor(() => expect(named(windowRef, "error")).toHaveLength(1));
      expect(named(windowRef, "error")[0].data.id).toBeUndefined();
      expect(named(windowRef, "error")[0].data.payload.code).toBe("unknown-area");
    });
  });

  describe("set-layers with variants", () => {
    beforeEach(() => {
      document.querySelector("[data-mg-preview-access]").classList.add(UNLOCKED_CLASS);
    });

    const EDRA = "edra-crop-yield-reduction";

    it("applies variants to the layers it names, over any settings the entry carries", async () => {
      mountReady("?tab=hazard");
      windowRef.deliver(
        command("set-layers", {
          layers: [{ key: EDRA, settings: { crop: "WHEAT", scenario: "20" } }, { key: "landslides" }],
          variants: { [EDRA]: { crop: "MAIZE", scenario: "30" }, landslides: "junk", other: {} },
        }),
      );
      await waitFor(() => expect(map.setState).toHaveBeenCalled());
      expect(map.setState.mock.calls[0][0].layers).toEqual([
        { key: EDRA, sourceIdx: 0, settings: { crop: "MAIZE", scenario: "30" } },
        { key: "landslides", sourceIdx: 0 },
      ]);
    });

    it("ignores variants that are not an object, as the URL parameter does", async () => {
      mountReady("?tab=hazard");
      windowRef.deliver(command("set-layers", { layers: [{ key: "landslides" }], variants: ["MAIZE"] }));
      await waitFor(() => expect(map.setState).toHaveBeenCalled());
      expect(map.setState.mock.calls[0][0].layers).toEqual([{ key: "landslides", sourceIdx: 0 }]);
      expect(warn.mock.calls.flat().join(" ")).toContain("variants");
      expect(named(windowRef, "error")).toEqual([]);
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
