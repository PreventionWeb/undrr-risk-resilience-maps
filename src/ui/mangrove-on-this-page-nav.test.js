import { afterEach, describe, expect, it, vi } from "vitest";
import { initMangroveOnThisPageNav } from "./mangrove-on-this-page-nav.js";

const scopeWithNav = () => {
  const scope = document.createElement("div");
  scope.innerHTML = "<nav data-mg-on-this-page-nav data-mg-on-this-page-nav-skip-auto-init></nav>";
  return scope;
};
const fakeModule = () => ({ mgOnThisPageNav: vi.fn(), mgOnThisPageNavDestroy: vi.fn() });
afterEach(() => vi.restoreAllMocks());

describe("Sources navigation lifecycle", () => {
  it("does not import when the scope has no nav or the signal already aborted", async () => {
    const importImpl = vi.fn();
    expect(await initMangroveOnThisPageNav(document.createElement("div"), { importImpl })).toBe(false);
    expect(await initMangroveOnThisPageNav(scopeWithNav(), { importImpl, signal: AbortSignal.abort() })).toBe(
      false,
    );
    expect(importImpl).not.toHaveBeenCalled();
  });

  it("only enhances its scope and destroys each container on abort", async () => {
    const scope = scopeWithNav();
    const nav = scope.firstElementChild;
    const mod = fakeModule();
    const lifetime = new AbortController();
    expect(
      await initMangroveOnThisPageNav(scope, { importImpl: async () => mod, signal: lifetime.signal }),
    ).toBe(true);
    expect(mod.mgOnThisPageNav).toHaveBeenCalledWith([nav]);
    lifetime.abort();
    expect(mod.mgOnThisPageNavDestroy).toHaveBeenCalledExactlyOnceWith(nav);
  });

  it("accepts a nav itself and detached document fragments", async () => {
    const mod = fakeModule();
    const nav = scopeWithNav().firstElementChild;
    await initMangroveOnThisPageNav(nav, { importImpl: async () => mod });
    expect(mod.mgOnThisPageNav).toHaveBeenLastCalledWith([nav]);
    const fragment = document.createDocumentFragment();
    fragment.append(nav);
    await initMangroveOnThisPageNav(fragment, { importImpl: async () => mod });
    expect(mod.mgOnThisPageNav).toHaveBeenLastCalledWith([nav]);
  });

  it("does not enhance after an abort during import", async () => {
    const mod = fakeModule();
    const lifetime = new AbortController();
    let resolve;
    const pending = initMangroveOnThisPageNav(scopeWithNav(), {
      importImpl: () =>
        new Promise((done) => {
          resolve = done;
        }),
      signal: lifetime.signal,
    });
    lifetime.abort();
    resolve(mod);
    expect(await pending).toBe(false);
    expect(mod.mgOnThisPageNav).not.toHaveBeenCalled();
  });

  it("cleans up a partial initialization and continues teardown after a failure", async () => {
    const scope = scopeWithNav();
    scope.append(scope.firstElementChild.cloneNode());
    const mod = fakeModule();
    mod.mgOnThisPageNav.mockImplementation(() => {
      throw new Error("partial init");
    });
    mod.mgOnThisPageNavDestroy.mockImplementationOnce(() => {
      throw new Error("destroy");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await initMangroveOnThisPageNav(scope, { importImpl: async () => mod })).toBe(false);
    expect(mod.mgOnThisPageNavDestroy).toHaveBeenCalledTimes(2);
  });

  it("degrades safely for failed loads and missing exports", async () => {
    expect(
      await initMangroveOnThisPageNav(scopeWithNav(), {
        importImpl: async () => {
          throw new Error("offline");
        },
      }),
    ).toBe(false);
    expect(await initMangroveOnThisPageNav(scopeWithNav(), { importImpl: async () => ({}) })).toBe(false);
  });
});
