import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client is a module-level singleton, so each test imports a fresh copy
 * rather than trying to put the readiness flag back.
 */
async function freshClient() {
  vi.resetModules();
  return import("./client.js");
}

let warn;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("SDK readiness", () => {
  it("starts not ready and tells subscribers when that flips", async () => {
    const { isSDKReady, onSDKReadyChange, setSDKReady } = await freshClient();
    const seen = [];
    onSDKReadyChange((ready) => seen.push(ready));

    expect(isSDKReady()).toBe(false);
    setSDKReady(true);
    expect(isSDKReady()).toBe(true);
    setSDKReady(false);

    expect(seen).toEqual([true, false]);
  });

  it("notifies nothing when the value does not change", async () => {
    const { onSDKReadyChange, setSDKReady } = await freshClient();
    const listener = vi.fn();
    onSDKReadyChange(listener);

    // Already false: the short-circuit keeps a repeated report from
    // re-rendering every layer row.
    setSDKReady(false);
    expect(listener).not.toHaveBeenCalled();

    setSDKReady(true);
    setSDKReady(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes through the returned function and through an abort signal", async () => {
    const { onSDKReadyChange, setSDKReady } = await freshClient();
    const returned = vi.fn();
    const aborted = vi.fn();
    const kept = vi.fn();
    const off = onSDKReadyChange(returned);
    const controller = new AbortController();
    onSDKReadyChange(aborted, { signal: controller.signal });
    onSDKReadyChange(kept);

    off();
    controller.abort();
    setSDKReady(true);

    expect(returned).not.toHaveBeenCalled();
    expect(aborted).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledWith(true);

    // Unsubscribing twice, or after the signal already fired, is harmless.
    off();
    controller.abort();
    setSDKReady(false);
    expect(kept).toHaveBeenCalledTimes(2);
  });

  it("keeps notifying the other subscribers when one throws", async () => {
    const { onSDKReadyChange, setSDKReady } = await freshClient();
    const after = vi.fn();
    onSDKReadyChange(() => {
      throw new Error("listener blew up");
    });
    onSDKReadyChange(after);

    expect(() => setSDKReady(true)).not.toThrow();
    expect(after).toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalled();
  });

  it("lets a listener unsubscribe itself while being notified", async () => {
    const { onSDKReadyChange, setSDKReady } = await freshClient();
    const once = vi.fn(() => off());
    const off = onSDKReadyChange(once);

    setSDKReady(true);
    setSDKReady(false);

    expect(once).toHaveBeenCalledTimes(1);
  });
});
