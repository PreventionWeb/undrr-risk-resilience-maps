export const MAPX_SDK_URL = "https://app.mapx.org/sdk/mxsdk.umd.js";

const SDK_LOAD_TIMEOUT_MS = 15_000;

/**
 * How long MapX gets to reach its `ready` event, counted only while the map is
 * the view the user is on (see `isMapOnScreen`).
 *
 * Measured against the live service from a cold browser profile, `ready` lands
 * 2.2-3.5s after the iframe first becomes renderable (1.1s warm). 30s is a
 * deliberate ~10x margin for a slow connection or a cold MapX backend; it is
 * not a budget the app should be able to burn while nothing is loading.
 */
const SDK_READY_TIMEOUT_MS = 30_000;

/**
 * Marks `#app-map` as laid out and loading but not shown to the user, which is
 * how the app keeps MapX warming up behind an information page. Set by the
 * sidebar's `switchTab`; see `.app-map.is-warming` in `layout.css`.
 */
export const MAP_WARMING_CLASS = "is-warming";

/** How often the ready watch re-checks whether MapX can make progress. */
const READY_TICK_MS = 500;

/**
 * Bound on how long the watch may go on *while it is counting*, measured from
 * the first tick on which the budget was actually spent -- not from when the
 * watch was armed.
 *
 * It has to measure the same thing the budget does. Wall clock from when the
 * watch starts measures something else entirely: the budget is spent only
 * while the map is on screen, so someone who reads About over lunch and then
 * clicks Hazard would have had the watch expire before a single millisecond of
 * budget was spent, and a genuinely dead MapX would then never be reported --
 * blank map, no notice, no retry, for the life of the page.
 *
 * Counted from the first spent tick, the bound still ends the case it exists
 * for: a watch that spends its budget a sliver at a time, because the map keeps
 * going off screen (a tab switched away from and back, an information page
 * opened between attempts), would otherwise take hours to reach a verdict that
 * would be meaningless by then. After this the watch stops without accusing the
 * service; a reload (or the retry countdown) arms a fresh one.
 *
 * The trade: a page that never brings the map on screen at all now keeps its
 * interval -- one predicate check per tick -- for the life of the page, where
 * before it stopped after 15 minutes. That is the price of reporting a real
 * outage to someone who read an information page first, and the watch is
 * cancellable for the callers that own a lifetime.
 */
const MAX_WATCH_MS = 15 * 60_000;

/**
 * The map container, as both the app and an embed mark it.
 *
 * `data-ui="app-map"` is the hook the sidebar acts on, and `#app-map` is what
 * the standalone page calls the same element; looking for the hook first keeps
 * these predicates and `ui/map-warming.js` talking about one element in an
 * embed that has no `#app-map` id. A page with more than one sidebar root has
 * more than one map, and these module-level predicates answer for the first;
 * such a page needs per-instance availability, which this module does not do.
 *
 * @param {Document} [documentRef]
 * @returns {Element|null}
 */
export function findMapContainer(documentRef = document) {
  const scoped = documentRef.querySelector?.('[data-ui="app-map"]');
  if (scoped) return scoped;
  return documentRef.getElementById?.("app-map") ?? null;
}

export function loadMapXSdk({
  documentRef = document,
  windowRef = window,
  timeoutMs = SDK_LOAD_TIMEOUT_MS,
} = {}) {
  if (windowRef.mxsdk?.Manager) return Promise.resolve(windowRef.mxsdk);

  return new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve(windowRef.mxsdk);
    };

    const timeout = setTimeout(() => finish(new Error("MapX SDK load timed out")), timeoutMs);

    script.src = MAPX_SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (windowRef.mxsdk?.Manager) finish();
      else finish(new Error("MapX SDK did not initialise"));
    };
    script.onerror = () => finish(new Error("MapX SDK could not be loaded"));
    documentRef.head.appendChild(script);
  });
}

/**
 * Can the MapX iframe make progress towards `ready` right now?
 *
 * MapX renders inside a cross-origin iframe, and browsers throttle rendering
 * (rAF, and with it MapX's own start-up) to a standstill whenever that iframe
 * is not laid out inside the viewport. Two states in this app do exactly that:
 *
 * - the Mangrove preview gate, which sets `visibility: hidden` on the body's
 *   children until the PIN is entered;
 * - the browser tab being in the background.
 *
 * In both the iframe makes zero progress, so time spent in them must not count
 * against the ready budget.
 *
 * An information page being active is *not* one of them: the map stays laid out
 * in the viewport and keeps loading behind it (see `.app-map.is-warming` in
 * `layout.css`). Being invisible to the user is a different question -- see
 * `isMapOnScreen`.
 *
 * @param {Document} [documentRef]
 * @returns {boolean}
 */
export function canMapLoad(documentRef = document) {
  if (documentRef.visibilityState === "hidden") return false;

  const container = findMapContainer(documentRef);
  // No container to reason about: don't stall the watch on a missing element.
  if (!container) return true;
  // Set by `ui/map-warming.js` wherever the warm-up does not apply: `inert` is
  // unsupported, or the warm-up is not worth its cost on this device or
  // connection. The map is then hidden as it was before the warm-up existed,
  // and it really cannot load.
  if (container.style.display === "none") return false;

  const styles = documentRef.defaultView?.getComputedStyle?.(container);
  if (styles && (styles.display === "none" || styles.visibility === "hidden")) return false;

  return true;
}

/**
 * Is the map on screen *for the user* right now?
 *
 * Narrower than `canMapLoad`: while an information page is shown the map is
 * still loading, but it is behind the page, transparent and inert, so nothing
 * may happen that the user would only understand if they could see the map --
 * in particular the retry countdown must not reload the page out from under
 * someone who is reading, and the ready budget must not be spent on a map
 * nobody is looking at.
 *
 * A missing container is false here, the opposite of `canMapLoad`: "don't stall
 * a watch on an element that isn't there" is not the same as "reload a page
 * that has no map in it".
 *
 * @param {Document} [documentRef]
 * @returns {boolean}
 */
export function isMapOnScreen(documentRef = document) {
  if (!canMapLoad(documentRef)) return false;
  const container = findMapContainer(documentRef);
  if (!container) return false;
  return !container.classList?.contains(MAP_WARMING_CLASS);
}

/**
 * Wait for MapX to become ready, calling `onTimeout` if it never does.
 *
 * The budget is spent, not elapsed, and it is spent on `isMapOnScreen()` --
 * time in which the map is the view the user is on -- not merely on time in
 * which it could load. The map also loads while it warms up behind an
 * information page, but that time is the user's reading time, not MapX's
 * loading time: on a 400 kbps / 400 ms link, counting it armed the notice 78s
 * in, while still on `#home`, for a service that became ready at 174s. The
 * first thing a data-tab click would then show is "The map is temporarily
 * unavailable", with a reload countdown, before the map had a second on
 * screen. Spending the budget on-screen keeps 30s as a ~10x margin over a real
 * cold load, and the warm-up still happens -- it simply cannot accuse a healthy
 * service on the user's behalf.
 *
 * Each tick subtracts the time that actually elapsed since the last one, not
 * the nominal tick: `setInterval` coalesces under load and in background tabs,
 * so counting ticks made "30s" whatever the machine felt like.
 *
 * @param {() => void} onTimeout
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - on-screen loading time MapX is allowed
 * @param {Document} [options.documentRef]
 * @param {number} [options.tickMs] - how often progress is re-checked
 * @param {(documentRef: Document) => boolean} [options.shouldCount] - override
 *   the progress check (used by tests)
 * @param {number} [options.maxWatchMs] - bound on the watch, from its first
 *   spent tick (see `MAX_WATCH_MS`)
 * @param {() => number} [options.now] - clock (used by tests)
 * @returns {() => void} cancel the watch
 */
export function watchForMapReady(
  onTimeout,
  {
    timeoutMs = SDK_READY_TIMEOUT_MS,
    documentRef = document,
    tickMs = READY_TICK_MS,
    shouldCount = isMapOnScreen,
    maxWatchMs = MAX_WATCH_MS,
    now = () => Date.now(),
  } = {},
) {
  let remaining = timeoutMs;
  let lastTickAt = now();
  // Null until the budget is first spent: the bound below runs on the same
  // clock as the budget, so it cannot expire before the map was ever on screen.
  let countingSince = null;

  const interval = setInterval(() => {
    const at = now();
    const elapsed = at - lastTickAt;
    lastTickAt = at;

    if (!shouldCount(documentRef)) return;

    if (countingSince === null) countingSince = at;
    else if (at - countingSince >= maxWatchMs) {
      // Spent a sliver at a time for too long to still be judging this load.
      clearInterval(interval);
      return;
    }

    remaining -= elapsed;
    if (remaining > 0) return;
    clearInterval(interval);
    onTimeout();
  }, tickMs);

  return () => clearInterval(interval);
}

export function showMapServiceNotice(documentRef = document) {
  const notice = documentRef.getElementById("map-service-notice");
  if (notice) notice.hidden = false;
}

export function hideMapServiceNotice(documentRef = document) {
  const notice = documentRef.getElementById("map-service-notice");
  if (notice) notice.hidden = true;
}

/** Reload the page: the standalone app's retry. An embed passes its own `reload`. */
const reloadPage = () => window.location.reload();

/**
 * Wire the notice's "Try again" button.
 * @param {Document} [documentRef]
 * @param {() => void} [reload] - how to retry (default: reload the page). An
 *   embed passes its own, so the retry never reloads the host page.
 * @param {{ signal?: AbortSignal }} [options] - aborting it removes the listener,
 *   so an instance's `destroy()` can take it back
 */
export function initMapServiceRetry(documentRef = document, reload = reloadPage, { signal } = {}) {
  documentRef.getElementById("map-service-retry")?.addEventListener(
    "click",
    () => {
      reload();
    },
    { signal },
  );
}

export function startMapServiceRetryCountdown({
  documentRef = document,
  reload = reloadPage,
  seconds = 60,
  // Don't reload out from under someone reading an info page, looking at
  // another tab, or still at the preview PIN gate.
  shouldCountDown = () => isMapOnScreen(documentRef),
} = {}) {
  const countdown = documentRef.getElementById("map-service-countdown");
  let remaining = seconds;

  const render = () => {
    if (countdown) {
      countdown.textContent = `Retrying in ${remaining} ${remaining === 1 ? "second" : "seconds"}`;
    }
  };

  render();
  const interval = setInterval(() => {
    if (!shouldCountDown()) return;
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      reload();
      return;
    }
    render();
  }, 1_000);

  return () => clearInterval(interval);
}
