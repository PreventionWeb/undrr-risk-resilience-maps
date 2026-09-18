import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    const reload = vi.fn();

    showMapServiceNotice();
    expect(document.getElementById("map-service-notice").hidden).toBe(false);
    hideMapServiceNotice();
    expect(document.getElementById("map-service-notice").hidden).toBe(true);

    initMapServiceRetry(document, reload);
    document.getElementById("map-service-retry").click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("counts down and automatically retries MapX", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="map-service-countdown"></p>`;
    const reload = vi.fn();

    startMapServiceRetryCountdown({ documentRef: document, reload, seconds: 3 });
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 3 seconds");

    vi.advanceTimersByTime(2_000);
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 1 second");
    expect(reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("pauses automatic retry while the map is not active", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<p id="map-service-countdown"></p>`;
    const reload = vi.fn();
    let mapIsActive = false;

    startMapServiceRetryCountdown({
      documentRef: document,
      reload,
      seconds: 2,
      shouldCountDown: () => mapIsActive,
    });
    vi.advanceTimersByTime(2_000);
    expect(document.getElementById("map-service-countdown").textContent).toBe("Retrying in 2 seconds");

    mapIsActive = true;
    vi.advanceTimersByTime(2_000);
    expect(reload).toHaveBeenCalledOnce();
  });
});

/**
 * The notice in index.html is Mangrove's ServiceNotice, CSS-only: its markup
 * has to keep matching the component's published contract, and the ids this
 * module drives have to keep existing inside it.
 */
describe("the map-service notice markup in index.html", () => {
  let notice;

  beforeAll(() => {
    // Vitest runs from the project root, and `import.meta.url` is an http URL
    // under jsdom, so resolve the entry point from the working directory.
    const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
    const page = document.implementation.createHTMLDocument("index");
    page.documentElement.innerHTML = html;
    notice = page.getElementById("map-service-notice");
  });

  it("is a Mangrove warning notice in the overlay variant", () => {
    expect(notice).not.toBeNull();
    expect(notice.hasAttribute("hidden")).toBe(true);
    expect(notice.getAttribute("role")).toBe("alert");
    for (const className of ["mg-notice", "mg-notice--warning", "mg-notice--overlay"]) {
      expect(notice.classList.contains(className)).toBe(true);
    }
    // Our own class is positioning only; it must stay for the panel inset.
    expect(notice.classList.contains("map-service-notice")).toBe(true);
  });

  it("uses the component's header, description and action blocks", () => {
    const header = notice.querySelector(".mg-notice__header");
    expect(header.querySelector(".mg-notice__icon.mg-icon.mg-icon-exclamation-triangle")).not.toBeNull();
    expect(header.querySelector(".mg-notice__title").textContent.trim()).toBe(
      "The map is temporarily unavailable",
    );
    expect(header.querySelector(".mg-status-label.mg-status-label--warning")).not.toBeNull();
    expect(header.querySelector(".mg-status-label__indicator").getAttribute("aria-hidden")).toBe("true");
    expect(notice.querySelector(".mg-notice__description p")).not.toBeNull();
    expect(notice.querySelector(".mg-notice__actions.mg-buttons")).not.toBeNull();
  });

  it("carries the component's visually hidden status region", () => {
    const status = notice.querySelector(".mg-u-sr-only[role='status']");
    expect(status).not.toBeNull();
    expect(status.textContent).toBe("");
  });

  it("keeps the ids and the countdown politeness this module drives", () => {
    expect(notice.querySelector("#map-service-retry")?.type).toBe("button");
    const countdown = notice.querySelector("#map-service-countdown");
    expect(countdown).not.toBeNull();
    // role="alert" already announces the notice; a per-second countdown on top
    // of it would interrupt.
    expect(countdown.getAttribute("aria-live")).toBe("off");
  });

  it("opens the status link in a new tab and says so", () => {
    const link = notice.querySelector(".mg-notice__actions a");
    expect(link.getAttribute("href")).toBe("https://app.mapx.org/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector(".mg-u-sr-only").textContent).toBe("(opens in a new tab)");
  });

  it("does not opt into the React hydration path", () => {
    expect(notice.hasAttribute("data-mg-service-notice")).toBe(false);
  });
});
