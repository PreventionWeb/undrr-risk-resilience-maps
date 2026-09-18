export const MAPX_SDK_URL = "https://app.mapx.org/sdk/mxsdk.umd.js";

const SDK_LOAD_TIMEOUT_MS = 15_000;

/**
 * How long MapX gets to reach its `ready` event, counted only while the map can
 * actually load (see `canMapLoad`).
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

  const container = documentRef.getElementById("app-map");
  // No container to reason about: don't stall the watch on a missing element.
  if (!container) return true;
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
 * someone who is reading.
 *
 * @param {Document} [documentRef]
 * @returns {boolean}
 */
export function isMapOnScreen(documentRef = document) {
  if (!canMapLoad(documentRef)) return false;
  const container = documentRef.getElementById("app-map");
  return !container?.classList?.contains(MAP_WARMING_CLASS);
}

/**
 * Wait for MapX to become ready, calling `onTimeout` if it never does.
 *
 * The budget is spent, not elapsed: it only ticks down while `canMapLoad()`
 * says the iframe is being rendered. Otherwise a user reading the home page,
 * sitting behind the preview PIN gate, or leaving the tab in the background
 * would see the map-service notice for a perfectly healthy service.
 *
 * @param {() => void} onTimeout
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - loading time MapX is allowed
 * @param {Document} [options.documentRef]
 * @param {number} [options.tickMs] - how often progress is re-checked
 * @param {(documentRef: Document) => boolean} [options.shouldCount] - override
 *   the progress check (used by tests)
 * @returns {() => void} cancel the watch
 */
export function watchForMapReady(
  onTimeout,
  {
    timeoutMs = SDK_READY_TIMEOUT_MS,
    documentRef = document,
    tickMs = READY_TICK_MS,
    shouldCount = canMapLoad,
  } = {},
) {
  let remaining = timeoutMs;

  const interval = setInterval(() => {
    if (!shouldCount(documentRef)) return;
    remaining -= tickMs;
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
 * @param {() => void} [reload] - how to retry (default: reload the page)
 */
export function initMapServiceRetry(documentRef = document, reload = reloadPage) {
  documentRef.getElementById("map-service-retry")?.addEventListener("click", () => {
    reload();
  });
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
