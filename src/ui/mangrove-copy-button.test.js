import { describe, it, expect, vi } from "vitest";
import { initMangroveCopyButtons, COPY_BUTTON_MODULE_URL } from "./mangrove-copy-button.js";

describe("COPY_BUTTON_MODULE_URL", () => {
  it("points at the same Mangrove release as the stylesheet", () => {
    expect(COPY_BUTTON_MODULE_URL).toBe("https://assets.undrr.org/mangrove/2.0.0-rc.2/js/copy-button.js");
  });
});

describe("initMangroveCopyButtons", () => {
  it("applies the behaviour to the given scope", async () => {
    const scopes = [];
    const importImpl = async () => ({ mgCopyButton: (scope) => scopes.push(scope) });
    const scope = document.createElement("div");

    expect(await initMangroveCopyButtons(scope, { importImpl })).toBe(true);
    expect(scopes).toEqual([scope]);
  });

  it("reports failure when the module cannot be loaded", async () => {
    const importImpl = async () => {
      throw new Error("network");
    };
    expect(await initMangroveCopyButtons(document, { importImpl })).toBe(false);
  });

  it("reports failure when the module has no mgCopyButton export", async () => {
    const importImpl = async () => ({});
    expect(await initMangroveCopyButtons(document, { importImpl })).toBe(false);
  });

  it("does not throw when the module throws", async () => {
    const importImpl = async () => ({
      mgCopyButton: () => {
        throw new Error("bad markup");
      },
    });
    expect(await initMangroveCopyButtons(document, { importImpl })).toBe(false);
  });
});

describe("initMangroveCopyButtons with a signal", () => {
  it("does not load the module when the signal is already aborted", async () => {
    const importImpl = vi.fn(async () => ({ mgCopyButton: vi.fn() }));
    expect(await initMangroveCopyButtons(document, { importImpl, signal: AbortSignal.abort() })).toBe(false);
    expect(importImpl).not.toHaveBeenCalled();
  });

  it("never wires markup that was replaced while the module was loading", async () => {
    const mgCopyButton = vi.fn();
    let resolveImport;
    const importImpl = () => new Promise((resolve) => (resolveImport = resolve));
    const lifetime = new AbortController();

    const pending = initMangroveCopyButtons(document.createElement("div"), {
      importImpl,
      signal: lifetime.signal,
    });
    lifetime.abort();
    resolveImport({ mgCopyButton });

    expect(await pending).toBe(false);
    expect(mgCopyButton).not.toHaveBeenCalled();
  });

  /**
   * 2.0.0-rc.2 exports only `mgCopyButton`. Its single listener is a `click`
   * on the button element, so it is collected with the markup the caller
   * replaces -- there is nothing global to undo. The abort still calls a
   * destroy export if a later release adds one.
   */
  it("tolerates a module with no destroy export", async () => {
    const lifetime = new AbortController();
    const importImpl = async () => ({ mgCopyButton: vi.fn() });
    expect(await initMangroveCopyButtons(document, { importImpl, signal: lifetime.signal })).toBe(true);
    expect(() => lifetime.abort()).not.toThrow();
  });

  it("calls a destroy export for the same scope when one exists", async () => {
    const mod = { mgCopyButton: vi.fn(), mgCopyButtonDestroy: vi.fn() };
    const scope = document.createElement("div");
    const lifetime = new AbortController();

    expect(
      await initMangroveCopyButtons(scope, { importImpl: async () => mod, signal: lifetime.signal }),
    ).toBe(true);
    lifetime.abort();
    expect(mod.mgCopyButtonDestroy).toHaveBeenCalledWith(scope);
  });

  it("survives a destroy export that throws", async () => {
    const mod = {
      mgCopyButton: vi.fn(),
      mgCopyButtonDestroy: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lifetime = new AbortController();
    try {
      await initMangroveCopyButtons(document, { importImpl: async () => mod, signal: lifetime.signal });
      expect(() => lifetime.abort()).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
