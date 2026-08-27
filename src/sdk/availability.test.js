import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideMapServiceNotice,
  initMapServiceRetry,
  loadMapXSdk,
  showMapServiceNotice,
  startMapServiceRetryCountdown,
  watchForMapReady,
} from "./availability.js";

describe("MapX availability", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("reuses an SDK that is already available", async () => {
    const sdk = { Manager: vi.fn() };
    await expect(loadMapXSdk({ windowRef: { mxsdk: sdk } })).resolves.toBe(sdk);
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("rejects when the downloaded script does not initialise the SDK", async () => {
    const promise = loadMapXSdk({ windowRef: {}, timeoutMs: 100 });
    document.head.querySelector("script").onload();
    await expect(promise).rejects.toThrow("did not initialise");
  });

  it("resolves after the dynamically loaded SDK initialises", async () => {
    const windowRef = {};
    const promise = loadMapXSdk({ windowRef, timeoutMs: 100 });
    const script = document.head.querySelector("script");
    windowRef.mxsdk = { Manager: vi.fn() };
    script.onload();

    await expect(promise).resolves.toBe(windowRef.mxsdk);
    expect(script.isConnected).toBe(true);
  });

  it("rejects and removes the script when its request fails", async () => {
    const promise = loadMapXSdk({ windowRef: {}, timeoutMs: 100 });
    const script = document.head.querySelector("script");
    script.onerror();

    await expect(promise).rejects.toThrow("could not be loaded");
    expect(script.isConnected).toBe(false);
  });

  it("times out when the SDK request stalls", async () => {
    vi.useFakeTimers();
    const promise = loadMapXSdk({ windowRef: {}, timeoutMs: 100 });
    const rejection = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(document.head.querySelector("script")).toBeNull();
  });

  it("can cancel the ready-event timeout", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const cancel = watchForMapReady(onTimeout, 100);
    cancel();
    vi.advanceTimersByTime(100);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("shows, hides, and retries from the service notice", () => {
    document.body.innerHTML = `
      <section id="map-service-notice" hidden></section>
      <button id="map-service-retry"></button>
    `;
    const locationRef = { reload: vi.fn() };

    showMapServiceNotice();
    expect(document.getElementById("map-service-notice").hidden).toBe(false);
    hideMapServiceNotice();
    expect(document.getElementById("map-service-notice").hidden).toBe(true);

    initMapServiceRetry(document, locationRef);
    document.getElementById("map-service-retry").click();
    expect(locationRef.reload).toHaveBeenCalledOnce();
  });

  it("counts down and automatically retries MapX", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="map-service-countdown"></p>`;
    const locationRef = { reload: vi.fn() };

    startMapServiceRetryCountdown({ documentRef: document, locationRef, seconds: 3 });
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 3 seconds");

    vi.advanceTimersByTime(2_000);
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 1 second");
    expect(locationRef.reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(locationRef.reload).toHaveBeenCalledOnce();
  });

  it("pauses automatic retry while the map is not active", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="map-service-countdown"></p>`;
    const locationRef = { reload: vi.fn() };
    let mapIsActive = false;

    startMapServiceRetryCountdown({
      documentRef: document,
      locationRef,
      seconds: 2,
      shouldCountDown: () => mapIsActive,
    });
    vi.advanceTimersByTime(2_000);
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 2 seconds");

    mapIsActive = true;
    vi.advanceTimersByTime(2_000);
    expect(locationRef.reload).toHaveBeenCalledOnce();
  });
});
