import { describe, expect, it, vi } from "vitest";
import { createLayersStore } from "../state/layers-store.js";
import { createLayerController, settingsMatch } from "./layer-controller.js";

const LAYERS = {
  pop: { key: "pop", id: "MX-POP" },
  recovery: { key: "recovery", id: "MX-REC" },
  flood: {
    key: "flood",
    sources: [{ id: "MX-F10" }, { id: "MX-F100" }, { id: "MX-F500" }],
  },
  crops: { key: "crops", external: { provider: "fake", defaults: { crop: "MAIZE" } } },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * Fake MapX views: records every call in `log`. Calls resolve immediately
 * unless a test holds one back with `hold(op, id)` or fails it with `failNext(op, id)`.
 */
function fakeViews() {
  const log = [];
  const shown = new Set();
  const held = new Map();
  const failures = new Map();
  const call = (op) => (id) => {
    log.push(`${op} ${id}`);
    const name = `${op} ${id}`;
    const settle = () => {
      if (failures.get(name) > 0) {
        failures.set(name, failures.get(name) - 1);
        throw new Error(`${name} failed`);
      }
      if (op === "add") shown.add(id);
      else shown.delete(id);
    };
    const gate = held.get(name)?.shift();
    return gate ? gate.promise.then(settle) : Promise.resolve().then(settle);
  };
  return {
    add: vi.fn(call("add")),
    remove: vi.fn(call("remove")),
    log,
    shown,
    /** Hold the next `op id` call until the returned deferred resolves. */
    hold(op, id) {
      const gate = deferred();
      const name = `${op} ${id}`;
      held.set(name, [...(held.get(name) ?? []), gate]);
      return gate;
    },
    failNext(op, id, times = 1) {
      failures.set(`${op} ${id}`, times);
    },
  };
}

/** Fake external registry with the same contract as src/external/index.js. */
function fakeExternal() {
  const runtimes = new Map();
  let nextId = 1;
  const gates = [];
  const failures = { open: 0, close: 0, replace: 0 };
  const log = [];
  const wait = async () => {
    const gate = gates.shift();
    if (gate) await gate.promise;
  };
  const maybeFail = (op) => {
    if (failures[op] > 0) {
      failures[op]--;
      throw new Error(`${op} failed`);
    }
  };
  return {
    log,
    runtimes,
    failures,
    /** Hold the next open/close/replace call until the deferred resolves. */
    hold() {
      const gate = deferred();
      gates.push(gate);
      return gate;
    },
    isExternal: (layer) => Boolean(layer.external),
    getRuntime: (layer) => runtimes.get(layer.key) ?? null,
    open: vi.fn(async (layer, settings) => {
      log.push(`open ${JSON.stringify(settings)}`);
      await wait();
      maybeFail("open");
      if (runtimes.has(layer.key)) return runtimes.get(layer.key);
      const runtime = { idView: `GJ-${nextId++}`, settings: { ...settings } };
      runtimes.set(layer.key, runtime);
      return runtime;
    }),
    close: vi.fn(async (layer) => {
      log.push("close");
      await wait();
      maybeFail("close");
      runtimes.delete(layer.key);
    }),
    replace: vi.fn(async (layer, settings) => {
      log.push(`replace ${JSON.stringify(settings)}`);
      await wait();
      maybeFail("replace");
      const runtime = { idView: `GJ-${nextId++}`, settings: { ...settings } };
      runtimes.set(layer.key, runtime);
      return { runtime };
    }),
  };
}

function setup() {
  const store = createLayersStore();
  const views = fakeViews();
  const external = fakeExternal();
  const onError = vi.fn();
  const controller = createLayerController({
    store,
    getLayer: (key) => LAYERS[key],
    views,
    external,
    onError,
  });
  return { store, views, external, onError, controller };
}

/** A settled record never claims a layer is on without a view, and says what MapX shows. */
function expectSettled(store, views, key) {
  const record = store.get(key);
  expect(record.status === "idle" || record.status === "error").toBe(true);
  expect(record.applied).toBe(Boolean(record.viewId));
  if (record.viewId) expect(views.shown.has(record.viewId)).toBe(true);
  return record;
}

describe("createLayerController", () => {
  describe("simple layers", () => {
    it("turns a layer on and off", async () => {
      const { store, views, controller } = setup();

      const on = controller.setOn("pop", true);
      expect(store.get("pop")).toMatchObject({ desired: true, status: "loading" });
      await expect(on).resolves.toMatchObject({ applied: true, viewId: "MX-POP", status: "idle" });

      await controller.setOn("pop", false);
      expect(store.get("pop")).toMatchObject({
        desired: false,
        applied: false,
        viewId: null,
        status: "idle",
      });
      expect(views.log).toEqual(["add MX-POP", "remove MX-POP"]);
    });

    it("ends off after a rapid on/off, without dropping the second click", async () => {
      const { store, views, controller } = setup();
      const add = views.hold("add", "MX-POP");

      const first = controller.setOn("pop", true);
      const second = controller.setOn("pop", false);
      add.resolve();
      await Promise.all([first, second]);

      expect(views.log).toEqual(["add MX-POP", "remove MX-POP"]);
      expect(expectSettled(store, views, "pop")).toMatchObject({ desired: false, applied: false });
    });

    it("ends on after on/off/on while the first add is in flight, adding once", async () => {
      const { store, views, controller } = setup();
      const add = views.hold("add", "MX-POP");

      controller.setOn("pop", true);
      controller.setOn("pop", false);
      const last = controller.setOn("pop", true);
      add.resolve();
      await last;

      expect(views.log).toEqual(["add MX-POP"]);
      expect(expectSettled(store, views, "pop")).toMatchObject({
        desired: true,
        applied: true,
        status: "idle",
      });
    });

    it("resolves every caller only once the latest intent has settled", async () => {
      const { views, controller } = setup();
      const add = views.hold("add", "MX-POP");

      const first = controller.setOn("pop", true);
      const second = controller.setOn("pop", false);
      let firstSettled = false;
      first.then(() => (firstSettled = true));
      add.resolve();
      await flush();
      await second;

      expect(firstSettled).toBe(true);
      await expect(first).resolves.toMatchObject({ applied: false });
    });

    it("keeps a failed add off, with the error, and intent reset", async () => {
      const { views, onError, controller } = setup();
      views.failNext("add", "MX-POP");

      const record = await controller.setOn("pop", true);

      expect(record).toMatchObject({ desired: false, applied: false, viewId: null, status: "error" });
      expect(record.error).toBeInstanceOf(Error);
      expect(onError).toHaveBeenCalledWith("pop", record.error, "add");

      // The next successful change clears the error.
      await expect(controller.setOn("pop", true)).resolves.toMatchObject({ status: "idle", error: null });
    });

    it("keeps a layer on when its removal fails", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("pop", true);
      views.failNext("remove", "MX-POP");

      const record = await controller.setOn("pop", false);

      expect(record).toMatchObject({ desired: true, applied: true, viewId: "MX-POP", status: "error" });
      expect(store.openViewIds()).toEqual(["MX-POP"]);
    });

    it("tries newer intent instead of resetting it when a call fails", async () => {
      const { store, views, controller } = setup();
      const add = views.hold("add", "MX-POP");
      views.failNext("add", "MX-POP");

      controller.setOn("pop", true);
      controller.setOn("pop", false);
      const last = controller.setOn("pop", true);
      add.resolve();
      await last;

      // The failed add was superseded by a newer "on", which is tried again.
      expect(views.log).toEqual(["add MX-POP", "add MX-POP"]);
      expect(expectSettled(store, views, "pop")).toMatchObject({
        applied: true,
        status: "idle",
        error: null,
      });
    });
  });

  describe("clearAll", () => {
    it("turns off a layer that is still loading", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("flood", true);
      const add = views.hold("add", "MX-REC");
      controller.setOn("recovery", true);

      const cleared = controller.clearAll();
      add.resolve();
      await cleared;

      expect(store.openViewIds()).toEqual([]);
      expect(views.shown.size).toBe(0);
      expect(expectSettled(store, views, "recovery")).toMatchObject({ desired: false, applied: false });
      expect(expectSettled(store, views, "flood")).toMatchObject({ desired: false, applied: false });
    });

    it("waits for a layer already turning off", async () => {
      const { views, controller } = setup();
      await controller.setOn("pop", true);
      const remove = views.hold("remove", "MX-POP");
      controller.setOn("pop", false);

      let settled = false;
      controller.clearAll().then(() => (settled = true));
      await flush();
      expect(settled).toBe(false);

      remove.resolve();
      await flush();
      expect(settled).toBe(true);
    });
  });

  describe("compound layers", () => {
    it("adds the intended source when turned on", async () => {
      const { store, views, controller } = setup();
      await controller.intend("flood", { desired: true, sourceIdx: 2 });

      expect(views.log).toEqual(["add MX-F500"]);
      expect(store.get("flood")).toMatchObject({ applied: true, viewId: "MX-F500", appliedSourceIdx: 2 });
    });

    it("only records a source picked while the layer is off", async () => {
      const { store, views, controller } = setup();
      await controller.setSource("flood", 1);

      expect(views.log).toEqual([]);
      expect(store.get("flood")).toMatchObject({ sourceIdx: 1, applied: false, status: "idle" });
    });

    it("clamps an out-of-range source to the first", async () => {
      const { store, controller } = setup();
      await controller.intend("flood", { desired: true, sourceIdx: 9 });
      expect(store.get("flood")).toMatchObject({ viewId: "MX-F10", appliedSourceIdx: 0 });
    });

    it("switches source, keeping the layer on with no view in between", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("flood", true);
      const remove = views.hold("remove", "MX-F10");
      const add = views.hold("add", "MX-F100");

      const switched = controller.setSource("flood", 1);
      expect(store.get("flood")).toMatchObject({
        status: "switching",
        viewId: "MX-F10",
        appliedSourceIdx: 0,
      });
      remove.resolve();
      await flush();
      // Gap between views: on, no view, URL state unchanged.
      expect(store.get("flood")).toMatchObject({ applied: true, viewId: null, appliedSourceIdx: 0 });
      add.resolve();
      await switched;

      expect(store.get("flood")).toMatchObject({
        applied: true,
        viewId: "MX-F100",
        sourceIdx: 1,
        appliedSourceIdx: 1,
        status: "idle",
      });
    });

    it("ends on the last source picked when A→B→C arrive during a switch, never adding B", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("flood", true);
      views.log.length = 0;
      const remove = views.hold("remove", "MX-F10");

      controller.setSource("flood", 1);
      controller.setSource("flood", 2);
      const last = controller.setSource("flood", 0);
      controller.setSource("flood", 2);
      remove.resolve();
      await last;

      expect(views.log).toEqual(["remove MX-F10", "add MX-F500"]);
      expect(expectSettled(store, views, "flood")).toMatchObject({ sourceIdx: 2, appliedSourceIdx: 2 });
      expect(views.shown).toEqual(new Set(["MX-F500"]));
    });

    it("moves on from a source added while a newer one was picked", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("flood", true);
      const add = views.hold("add", "MX-F100");

      controller.setSource("flood", 1);
      await flush();
      expect(views.add).toHaveBeenLastCalledWith("MX-F100");
      const last = controller.setSource("flood", 2);
      add.resolve();
      await last;

      expect(views.shown).toEqual(new Set(["MX-F500"]));
      expect(expectSettled(store, views, "flood")).toMatchObject({ viewId: "MX-F500", appliedSourceIdx: 2 });
    });

    it("turns off when switched off mid-switch", async () => {
      const { store, views, controller } = setup();
      await controller.setOn("flood", true);
      const add = views.hold("add", "MX-F100");

      controller.setSource("flood", 1);
      await flush();
      const off = controller.setOn("flood", false);
      add.resolve();
      await off;

      expect(views.shown.size).toBe(0);
      expect(expectSettled(store, views, "flood")).toMatchObject({ desired: false, applied: false });
    });

    it("rolls back to the previous source when the new one fails", async () => {
      const { views, controller } = setup();
      await controller.setOn("flood", true);
      views.failNext("add", "MX-F100");

      const record = await controller.setSource("flood", 1);

      expect(views.log).toEqual(["add MX-F10", "remove MX-F10", "add MX-F100", "add MX-F10"]);
      expect(record).toMatchObject({
        desired: true,
        applied: true,
        viewId: "MX-F10",
        sourceIdx: 0,
        appliedSourceIdx: 0,
        status: "error",
      });
    });

    it("records the layer as off when both the new and the previous source fail", async () => {
      const { store, views, onError, controller } = setup();
      await controller.setOn("flood", true);
      views.failNext("add", "MX-F100");
      views.failNext("add", "MX-F10");

      const record = await controller.setSource("flood", 1);

      expect(record).toMatchObject({
        desired: false,
        applied: false,
        viewId: null,
        sourceIdx: 0,
        status: "error",
      });
      expect(onError.mock.calls.map(([, , action]) => action)).toEqual(["add", "rollback"]);
      expect(store.openViewIds()).toEqual([]);
      expect(views.shown.size).toBe(0);
    });

    it("keeps the old source when its removal fails during a switch", async () => {
      const { views, controller } = setup();
      await controller.setOn("flood", true);
      views.failNext("remove", "MX-F10");

      const record = await controller.setSource("flood", 1);

      expect(views.add).not.toHaveBeenCalledWith("MX-F100");
      expect(record).toMatchObject({ applied: true, viewId: "MX-F10", sourceIdx: 0, status: "error" });
    });
  });

  describe("external layers", () => {
    it("opens with the provider defaults and records the runtime view", async () => {
      const { external, controller } = setup();

      const record = await controller.setOn("crops", true);

      expect(external.open).toHaveBeenCalledWith(LAYERS.crops, { crop: "MAIZE" });
      expect(record).toMatchObject({
        applied: true,
        viewId: "GJ-1",
        settings: { crop: "MAIZE" },
        appliedSettings: { crop: "MAIZE" },
      });
    });

    it("ends off when turned off while it is still loading", async () => {
      const { store, external, controller } = setup();
      const open = external.hold();

      controller.setOn("crops", true);
      const off = controller.setOn("crops", false);
      open.resolve();
      await off;

      expect(external.log).toEqual(['open {"crop":"MAIZE"}', "close"]);
      expect(external.runtimes.size).toBe(0);
      expect(store.get("crops")).toMatchObject({
        desired: false,
        applied: false,
        viewId: null,
        status: "idle",
      });
    });

    it("applies a settings change made while it is still loading", async () => {
      const { store, external, controller } = setup();
      const open = external.hold();

      controller.setOn("crops", true);
      const changed = controller.setSettings("crops", { crop: "WHEAT" });
      open.resolve();
      await changed;

      expect(external.log).toEqual(['open {"crop":"MAIZE"}', 'replace {"crop":"WHEAT"}']);
      expect(store.get("crops")).toMatchObject({
        applied: true,
        viewId: "GJ-2",
        settings: { crop: "WHEAT" },
        appliedSettings: { crop: "WHEAT" },
        status: "idle",
      });
    });

    it("keeps the current view and settings when a replacement fails", async () => {
      const { external, controller } = setup();
      await controller.setOn("crops", true);
      external.failures.replace = 1;

      const record = await controller.setSettings("crops", { crop: "RICE" });

      expect(record).toMatchObject({
        applied: true,
        viewId: "GJ-1",
        settings: { crop: "MAIZE" },
        appliedSettings: { crop: "MAIZE" },
        status: "error",
      });
    });

    it("keeps an external layer on when closing it fails", async () => {
      const { external, controller } = setup();
      await controller.setOn("crops", true);
      external.failures.close = 1;

      await expect(controller.setOn("crops", false)).resolves.toMatchObject({
        desired: true,
        applied: true,
        viewId: "GJ-1",
        status: "error",
      });
    });

    it("records a failed open as off", async () => {
      const { external, controller } = setup();
      external.failures.open = 1;

      await expect(controller.setOn("crops", true)).resolves.toMatchObject({
        desired: false,
        applied: false,
        status: "error",
      });
    });

    it("does not replace a view whose settings already match", async () => {
      const { external, controller } = setup();
      await controller.setOn("crops", true);

      await controller.setSettings("crops", { crop: "MAIZE" });

      expect(external.replace).not.toHaveBeenCalled();
    });
  });

  describe("across keys", () => {
    it("issues view_add calls in the order layers were requested", async () => {
      const { views, controller } = setup();
      const slow = views.hold("add", "MX-POP");

      const all = Promise.all([
        controller.setOn("pop", true),
        controller.intend("flood", { desired: true, sourceIdx: 1 }),
        controller.setOn("recovery", true),
      ]);
      expect(views.log).toEqual(["add MX-POP", "add MX-F100", "add MX-REC"]);
      slow.resolve();
      await all;
    });

    it("does not hold one layer back while another is in flight", async () => {
      const { store, views, controller } = setup();
      views.hold("add", "MX-POP");

      controller.setOn("pop", true);
      await controller.setOn("recovery", true);

      expect(store.get("recovery").applied).toBe(true);
      expect(store.get("pop").status).toBe("loading");
      expect(controller.isBusy("pop")).toBe(true);
    });

    it("ignores keys with no layer config", async () => {
      const { views, controller } = setup();
      await controller.setOn("missing", true);
      expect(views.log).toEqual([]);
    });

    it("joins a reconciliation started by a store subscriber during the first call", async () => {
      const { store, views, controller } = setup();
      let reentered = false;
      store.subscribe((key, next) => {
        if (key === "pop" && next.status === "loading" && !reentered) {
          reentered = true;
          controller.setOn("pop", false);
        }
      });

      await controller.setOn("pop", true);

      expect(views.log).toEqual(["add MX-POP", "remove MX-POP"]);
      expect(store.get("pop")).toMatchObject({ desired: false, applied: false });
    });
  });

  describe("unexpected errors", () => {
    /** Collect unhandled rejections for the duration of a test. */
    function watchUnhandled() {
      const reasons = [];
      const listener = (reason) => reasons.push(reason);
      process.on("unhandledRejection", listener);
      return { reasons, stop: () => process.off("unhandledRejection", listener) };
    }

    it("settles and frees the key when onError throws", async () => {
      const unhandled = watchUnhandled();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const store = createLayersStore();
        const views = fakeViews();
        const onError = vi.fn(() => {
          throw new Error("handler broke");
        });
        const controller = createLayerController({
          store,
          getLayer: (key) => LAYERS[key],
          views,
          external: fakeExternal(),
          onError,
        });
        views.failNext("add", "MX-POP");

        const record = await controller.setOn("pop", true);

        expect(record).toMatchObject({ desired: false, applied: false, status: "error" });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalled();
        // The key is free: a later intent runs and succeeds.
        await expect(controller.setOn("pop", true)).resolves.toMatchObject({
          applied: true,
          viewId: "MX-POP",
          status: "idle",
        });
        expect(views.log).toEqual(["add MX-POP", "add MX-POP"]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled.reasons).toEqual([]);
      } finally {
        unhandled.stop();
        consoleError.mockRestore();
      }
    });

    it("settles every caller and leaves no busy status when a reconciliation throws", async () => {
      const unhandled = watchUnhandled();
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const inner = createLayersStore();
        let failStatusWrite = true;
        // A store whose "idle" status write throws once: a bug outside MapX.
        const store = {
          ...inner,
          set(key, patch) {
            if (failStatusWrite && patch.status === "idle") {
              failStatusWrite = false;
              throw new Error("store broke");
            }
            return inner.set(key, patch);
          },
        };
        const views = fakeViews();
        const controller = createLayerController({
          store,
          getLayer: (key) => LAYERS[key],
          views,
          external: fakeExternal(),
        });

        const first = controller.setOn("pop", true);
        const joined = controller.setOn("pop", true);
        const [a, b] = await Promise.all([first, joined]);

        expect(a).toBe(b);
        expect(a).toMatchObject({ applied: true, status: "error" });
        expect(controller.isBusy("pop")).toBe(false);
        await expect(controller.setOn("pop", false)).resolves.toMatchObject({
          applied: false,
          status: "idle",
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled.reasons).toEqual([]);
      } finally {
        unhandled.stop();
        consoleError.mockRestore();
      }
    });
  });

  describe("destroy", () => {
    it("drops a MapX result that settles after destroy and makes no more calls", async () => {
      const { store, views, onError, controller } = setup();
      const add = views.hold("add", "MX-POP");
      const on = controller.setOn("pop", true);
      // Pending intent that would otherwise remove the view once the add settles.
      controller.setOn("pop", false);
      const before = store.get("pop");

      controller.destroy();
      add.resolve();
      await on;
      await flush();

      expect(store.get("pop")).toBe(before);
      expect(views.log).toEqual(["add MX-POP"]);
      expect(onError).not.toHaveBeenCalled();
      expect(controller.isBusy("pop")).toBe(false);
    });

    it("drops a failure that settles after destroy without rolling back", async () => {
      const { store, views, onError, controller } = setup();
      await controller.setOn("flood", true);
      const add = views.hold("add", "MX-F100");
      views.failNext("add", "MX-F100");
      const switched = controller.setSource("flood", 1);
      await flush();
      const before = store.get("flood");

      controller.destroy();
      add.resolve();
      await switched;

      expect(store.get("flood")).toBe(before);
      expect(views.log).toEqual(["add MX-F10", "remove MX-F10", "add MX-F100"]);
      expect(onError).not.toHaveBeenCalled();
    });

    it("ignores intent after destroy", async () => {
      const { store, views, external, controller } = setup();
      controller.destroy();

      await controller.setOn("pop", true);
      await controller.setOn("crops", true);
      await controller.clearAll();

      expect(store.all()).toEqual([]);
      expect(views.log).toEqual([]);
      expect(external.log).toEqual([]);
    });
  });
});

describe("frozen settings", () => {
  it("hands providers the record's frozen settings without mutating them", async () => {
    const { store, external, controller } = setup();
    await controller.intend("crops", { desired: true, settings: { crop: "WHEAT" } });
    await controller.setSettings("crops", { crop: "MAIZE" });

    const [, openSettings] = external.open.mock.calls[0];
    const [, replaceSettings] = external.replace.mock.calls[0];
    expect(Object.isFrozen(openSettings)).toBe(true);
    expect(Object.isFrozen(replaceSettings)).toBe(true);
    expect(Object.isFrozen(store.get("crops").appliedSettings)).toBe(true);
    expect(store.get("crops")).toMatchObject({
      settings: { crop: "MAIZE" },
      appliedSettings: { crop: "MAIZE" },
      status: "idle",
    });
  });
});

describe("settingsMatch", () => {
  it("compares only the wanted fields", () => {
    expect(settingsMatch({ crop: "MAIZE", scenario: "30" }, { crop: "MAIZE" })).toBe(true);
    expect(settingsMatch({ crop: "MAIZE" }, { crop: "RICE" })).toBe(false);
    expect(settingsMatch(null, { crop: "RICE" })).toBe(false);
  });
});
