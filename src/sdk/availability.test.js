import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canMapLoad,
  findMapContainer,
  isMapOnScreen,
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
    const cancel = watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10 });
    cancel();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("gives up once MapX has had its full loading time", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    document.body.innerHTML = `<div id="app-map" data-ui="app-map"></div>`;
    watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10 });

    vi.advanceTimersByTime(90);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledOnce();

    // The watch stops itself: no repeat failures.
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not spend the ready budget while the map cannot load", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let visible = false;

    watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10, shouldCount: () => visible });

    // A user sitting behind the PIN gate, or reading an info page, for a long
    // time must not trip the failure notice.
    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();

    visible = true;
    vi.advanceTimersByTime(90);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  // The warm-up keeps MapX loading behind an information page, but that time is
  // the user's reading time: counting it armed the notice on a healthy service
  // that was still loading (measured: armed at 75s, ready at 193s).
  it("does not spend the ready budget while the map warms up behind an information page", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    document.body.innerHTML = `<div id="app-map" data-ui="app-map" class="is-warming"></div>`;
    const appMap = document.getElementById("app-map");

    watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10 });

    vi.advanceTimersByTime(10_000);
    expect(onTimeout).not.toHaveBeenCalled();

    // The user opens a data tab: now MapX is the view, and the clock starts.
    appMap.classList.remove("is-warming");
    vi.advanceTimersByTime(90);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  // `setInterval` coalesces under load and in background tabs, so a budget that
  // counted ticks made "30s" whatever the machine felt like.
  it("spends the budget in elapsed time, not in ticks", () => {
    const onTimeout = vi.fn();
    document.body.innerHTML = `<div id="app-map" data-ui="app-map"></div>`;
    let clock = 0;
    const scheduled = [];
    const fakeSetInterval = (fn) => {
      scheduled.push(fn);
      return scheduled.length;
    };
    vi.stubGlobal("setInterval", fakeSetInterval);
    vi.stubGlobal("clearInterval", () => {});

    watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10, now: () => clock });
    const tick = scheduled[0];

    // Two ticks, but 120ms of real time between them: the budget is spent.
    clock = 60;
    tick();
    expect(onTimeout).not.toHaveBeenCalled();
    clock = 120;
    tick();
    expect(onTimeout).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  // Nothing ever brings the map on screen (a background tab, an unanswered PIN
  // gate): the watch must not keep a 2 Hz interval alive for the life of the
  // page, and it must not accuse the service either.
  it("stops watching after its wall-clock bound", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const shouldCount = vi.fn(() => false);

    watchForMapReady(onTimeout, { timeoutMs: 100, tickMs: 10, maxWatchMs: 200, shouldCount });

    vi.advanceTimersByTime(1_000);
    const ticks = shouldCount.mock.calls.length;
    expect(ticks).toBeLessThanOrEqual(200 / 10);

    // And it really has stopped, rather than merely stopped counting.
    vi.advanceTimersByTime(10_000);
    expect(shouldCount).toHaveBeenCalledTimes(ticks);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  describe("canMapLoad", () => {
    const setMap = (markup) => {
      document.body.innerHTML = markup;
      return document.getElementById("app-map");
    };

    it("is true when the map container is on screen", () => {
      setMap(`<div id="app-map"></div>`);
      expect(canMapLoad(document)).toBe(true);
    });

    it("is true when there is no map container to reason about", () => {
      document.body.replaceChildren();
      expect(canMapLoad(document)).toBe(true);
    });

    it("is false while the map is hidden outright", () => {
      setMap(`<div id="app-map" style="display: none"></div>`);
      expect(canMapLoad(document)).toBe(false);
    });

    it("is true while the map warms up behind an information page", () => {
      // The warm-up state leaves the map laid out and rendering: MapX makes
      // real progress there, so the ready budget is allowed to run.
      setMap(`<div id="app-map" class="is-warming" aria-hidden="true"><div inert></div></div>`);
      expect(canMapLoad(document)).toBe(true);
    });

    it("is false while the preview gate hides the page", () => {
      setMap(`<div id="app-map" style="visibility: hidden"></div>`);
      expect(canMapLoad(document)).toBe(false);
    });

    it("is false while the tab is in the background", () => {
      setMap(`<div id="app-map"></div>`);
      const documentRef = { visibilityState: "hidden", getElementById: () => null };
      expect(canMapLoad(documentRef)).toBe(false);
    });
  });

  describe("isMapOnScreen", () => {
    it("is true when the map is the view the user is on", () => {
      document.body.innerHTML = `<div id="app-map"></div>`;
      expect(isMapOnScreen(document)).toBe(true);
    });

    it("is false while the map warms up behind an information page", () => {
      // It can load, but the user cannot see it: nothing may reload the page
      // under them while they read.
      document.body.innerHTML = `<div id="app-map" class="is-warming"><div inert></div></div>`;
      expect(canMapLoad(document)).toBe(true);
      expect(isMapOnScreen(document)).toBe(false);
    });

    it("is false whenever the map cannot load at all", () => {
      document.body.innerHTML = `<div id="app-map" style="display: none"></div>`;
      expect(isMapOnScreen(document)).toBe(false);
    });

    // The opposite of `canMapLoad`, deliberately: "don't stall a watch on an
    // element that isn't there" is not "reload a page that has no map in it".
    it("is false when there is no map container at all", () => {
      document.body.replaceChildren();
      expect(canMapLoad(document)).toBe(true);
      expect(isMapOnScreen(document)).toBe(false);
    });
  });

  // The predicates and `ui/map-warming.js` have to be talking about the same
  // element, and the sidebar acts on the root-scoped `data-ui` hook.
  describe("the map container the predicates read", () => {
    it("is the `data-ui` hook, as in an embed with no #app-map id", () => {
      document.body.innerHTML = `<div data-ui="app-map" class="is-warming"></div>`;
      expect(findMapContainer(document)).toBe(document.querySelector('[data-ui="app-map"]'));
      expect(isMapOnScreen(document)).toBe(false);
    });

    it("falls back to the id for a page that only has that", () => {
      document.body.innerHTML = `<div id="app-map" class="is-warming"></div>`;
      expect(findMapContainer(document)).toBe(document.getElementById("app-map"));
      expect(isMapOnScreen(document)).toBe(false);
    });
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
    // The map is the view the user is on: the default `shouldCountDown` reads
    // that from the container, and a page with no map never counts down.
    document.body.innerHTML = `<div id="app-map" data-ui="app-map"></div><p id="map-service-countdown"></p>`;
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
