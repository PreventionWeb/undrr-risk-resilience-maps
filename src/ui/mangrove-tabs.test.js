import { describe, it, expect, vi } from "vitest";
import { initMangroveTabs, TABS_MODULE_URL } from "./mangrove-tabs.js";

describe("TABS_MODULE_URL", () => {
  it("points at the same Mangrove release as the stylesheet", () => {
    expect(TABS_MODULE_URL).toBe("https://assets.undrr.org/mangrove/2.0.0-rc.2/js/tabs.js");
  });
});

describe("initMangroveTabs", () => {
  it("applies the behaviour to the given scope", async () => {
    const scopes = [];
    const importImpl = async () => ({ mgTabs: (scope) => scopes.push(scope) });
    const scope = document.createElement("div");

    expect(await initMangroveTabs(scope, { importImpl })).toBe(true);
    expect(scopes).toEqual([scope]);
  });

  it("reports failure when the module cannot be loaded", async () => {
    const importImpl = async () => {
      throw new Error("network");
    };
    expect(await initMangroveTabs(document, { importImpl })).toBe(false);
  });

  it("reports failure when the module has no mgTabs export", async () => {
    const importImpl = async () => ({});
    expect(await initMangroveTabs(document, { importImpl })).toBe(false);
  });
});

describe("initMangroveTabs with a signal", () => {
  /**
   * A tabs module like Mangrove's: mgTabs adds a window listener per scope
   * and only mgTabsDestroy removes it. Window listeners are counted through
   * spies so the test sees what is really left on `window`.
   */
  function fakeModule() {
    const handlers = new Map();
    return {
      mgTabs: vi.fn((scope) => {
        const handler = () => {};
        handlers.set(scope, handler);
        window.addEventListener("resize", handler);
      }),
      mgTabsDestroy: vi.fn((scope) => {
        const handler = handlers.get(scope);
        if (!handler) return;
        window.removeEventListener("resize", handler);
        handlers.delete(scope);
      }),
    };
  }

  function trackWindowListeners() {
    const live = new Set();
    const add = vi.spyOn(window, "addEventListener").mockImplementation((_type, fn) => live.add(fn));
    const remove = vi.spyOn(window, "removeEventListener").mockImplementation((_type, fn) => live.delete(fn));
    return {
      count: () => live.size,
      restore() {
        add.mockRestore();
        remove.mockRestore();
      },
    };
  }

  it("destroys the tabs when the signal aborts: 5 create/destroy cycles leave no listeners", async () => {
    const mod = fakeModule();
    const listeners = trackWindowListeners();
    try {
      for (let i = 0; i < 5; i++) {
        const scope = document.createElement("div");
        const lifetime = new AbortController();
        expect(await initMangroveTabs(scope, { importImpl: async () => mod, signal: lifetime.signal })).toBe(
          true,
        );
        expect(listeners.count()).toBe(1);
        lifetime.abort();
        expect(mod.mgTabsDestroy).toHaveBeenLastCalledWith(scope);
      }
      expect(mod.mgTabs).toHaveBeenCalledTimes(5);
      expect(listeners.count()).toBe(0);
    } finally {
      listeners.restore();
    }
  });

  it("never calls mgTabs when the signal aborts before the module loads", async () => {
    const mod = fakeModule();
    let resolveImport;
    const importImpl = () => new Promise((resolve) => (resolveImport = resolve));
    const lifetime = new AbortController();

    const pending = initMangroveTabs(document.createElement("div"), { importImpl, signal: lifetime.signal });
    lifetime.abort();
    resolveImport(mod);

    expect(await pending).toBe(false);
    expect(mod.mgTabs).not.toHaveBeenCalled();
  });

  it("does not load the module when the signal is already aborted", async () => {
    const importImpl = vi.fn(async () => fakeModule());
    expect(await initMangroveTabs(document, { importImpl, signal: AbortSignal.abort() })).toBe(false);
    expect(importImpl).not.toHaveBeenCalled();
  });

  it("tolerates a module without mgTabsDestroy", async () => {
    const lifetime = new AbortController();
    const importImpl = async () => ({ mgTabs: vi.fn() });
    expect(await initMangroveTabs(document, { importImpl, signal: lifetime.signal })).toBe(true);
    expect(() => lifetime.abort()).not.toThrow();
  });
});

/**
 * Same gap as mangrove-copy-button.js: every test above injects `importImpl`
 * and never reaches the memoised CDN import. Node refuses an `https:`
 * specifier, so the import rejects without a network call, and the loader has
 * to absorb it — false, memo dropped, next call free to retry.
 */
describe("the real CDN import", () => {
  it("absorbs a failed load and stays retryable", async () => {
    await expect(initMangroveTabs(document.createElement("div"))).resolves.toBe(false);
    await expect(initMangroveTabs(document.createElement("div"))).resolves.toBe(false);
  });
});
