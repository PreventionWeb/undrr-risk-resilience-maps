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

describe("initSDK", () => {
  it("throws when window.mxsdk.Manager is unavailable", async () => {
    const { initSDK } = await freshClient();
    delete window.mxsdk;
    expect(() => initSDK(document.createElement("div"), "PRJ-1")).toThrow("MapX SDK is unavailable");
  });

  it("configures Manager with iframeTitle and the production URL by default", async () => {
    const { initSDK } = await freshClient();
    const ManagerMock = vi.fn().mockImplementation(function (opts) {
      this.opts = opts;
      const iframe = document.createElement("iframe");
      iframe.title = opts.iframeTitle;
      opts.container.appendChild(iframe);
    });
    window.mxsdk = { Manager: ManagerMock };

    const container = document.createElement("div");
    const manager = initSDK(container, "PRJ-TEST");

    expect(ManagerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        container,
        url: "https://app.mapx.org/?project=PRJ-TEST",
        iframeTitle: "Interactive map",
        params: expect.objectContaining({
          closePanels: true,
          language: "en",
          theme: "color_light",
        }),
      }),
    );
    expect(manager).toBeDefined();
    expect(container.querySelector("iframe").title).toBe("Interactive map");
  });

  it("leaves a title the SDK already set untouched", async () => {
    const { initSDK } = await freshClient();
    const ManagerMock = vi.fn().mockImplementation(function (opts) {
      this.opts = opts;
      const iframe = document.createElement("iframe");
      iframe.title = "MapX map";
      opts.container.appendChild(iframe);
    });
    window.mxsdk = { Manager: ManagerMock };

    const container = document.createElement("div");
    initSDK(container, "PRJ-1142");

    expect(container.querySelector("iframe").title).toBe("MapX map");
  });

  it("allows passing a custom baseUrl to initSDK", async () => {
    const { initSDK } = await freshClient();
    const ManagerMock = vi.fn().mockImplementation(function (opts) {
      this.opts = opts;
    });
    window.mxsdk = { Manager: ManagerMock };

    const container = document.createElement("div");
    initSDK(container, "PRJ-TEST", { baseUrl: "https://app.staging.mapx.org" });

    expect(ManagerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.staging.mapx.org/?project=PRJ-TEST",
        iframeTitle: "Interactive map",
      }),
    );
  });
});

describe("MapX version", () => {
  it("reads the version from the Manager instance, not window.mxsdk", async () => {
    const { initSDK, getMapXVersion } = await freshClient();
    expect(getMapXVersion()).toBeNull();
    window.mxsdk = {
      version: "9.9.9",
      Manager: vi.fn().mockImplementation(function () {
        Object.defineProperty(this, "version", { get: () => "1.14.2" });
      }),
    };
    initSDK(document.createElement("div"), "PRJ");
    expect(getMapXVersion()).toBe("1.14.2");
  });

  it("returns null when the Manager reports no version", async () => {
    const { initSDK, getMapXVersion } = await freshClient();
    window.mxsdk = { Manager: vi.fn() };
    initSDK(document.createElement("div"), "PRJ");
    expect(getMapXVersion()).toBeNull();
  });
});
