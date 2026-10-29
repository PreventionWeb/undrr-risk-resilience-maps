/** Site inspection consumes one MapX click_features result per click. */

let _mapx = null;
let _active = false;
/** Every subscriber, in registration order (see onInspectionResult). */
const _subscribers = new Set();

/**
 * Point the module at an SDK client and start from no subscribers.
 *
 * The subscriber Set is module state, so a second run (HMR, a second embed, a
 * torn-down panel) would otherwise leave the previous run's subscribers
 * delivering results into a detached panel. Callers that want to keep a
 * subscription register it after this call, the way `main.js` does.
 */
export function initInspection(mapx) {
  _mapx = mapx;
  _subscribers.clear();
}

export function enableInspection() {
  _active = true;
  // In dev mode keep MapX's native popup so we can cross-check data.
  // NOTE: The production branch (enable: true call) is never exercised by the
  // test suite — Vitest always runs with import.meta.env.DEV === true.
  // The native-popup setting is best-effort: rejection must not block the UI.
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: true }).catch(() => {});
  }
}

export function disableInspection() {
  _active = false;
  // See enableInspection() comment — production path untested by automated tests.
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: false }).catch(() => {});
  }
}

export function isInspectionActive() {
  return _active;
}

/**
 * Subscribe to inspection results. Every subscriber is called, in
 * registration order, so a second registration adds a listener instead of
 * silently replacing the first.
 *
 * @param {(result: {lngLat: object, views: object, openViewsSnapshot: Set<string>}) => void} cb
 * @param {{ signal?: AbortSignal }} [options] - aborting it unsubscribes, the
 *   way the UI modules take a signal
 * @returns {() => void} unsubscribe (idempotent)
 */
export function onInspectionResult(cb, { signal } = {}) {
  if (typeof cb !== "function" || signal?.aborted) return () => {};
  _subscribers.add(cb);
  const off = () => _subscribers.delete(cb);
  signal?.addEventListener("abort", off, { once: true });
  return off;
}

/**
 * Process a single `click_features` event from MapX 1.14.2+ (MapX upstream #1139).
 * MapX passes { attributes, lngLat, point } where attributes is an object keyed by
 * view ID ({ [idView]: attrs[] }). When empty or clicking an empty region, attributes is {}.
 *
 * `attributes` lists only views that hit something. Start every open view
 * as [] so the site inspector treats a miss as queried with no data, rather
 * than incorrectly treating a missing raster entry as not queryable.
 *
 * @param {object} data - { attributes?: Record<string, object[]>, lngLat?: object }
 * @param {Set<string>} openViews - current store.openViews
 */
export function handleFeaturesEvent(data, openViews) {
  if (!_active) return;
  const rawAttrs = data?.attributes;
  const views = Object.fromEntries([...openViews].map((idView) => [idView, []]));
  if (rawAttrs && typeof rawAttrs === "object") {
    for (const [idView, attrs] of Object.entries(rawAttrs)) {
      views[idView] = Array.isArray(attrs) ? attrs : [attrs];
    }
  }
  deliverInspectionResult({
    lngLat: data?.lngLat ?? null,
    views,
    openViewsSnapshot: new Set(openViews),
  });
}

function deliverInspectionResult(result) {
  // A snapshot, so a subscriber that unsubscribes (or subscribes) while the
  // result is being delivered cannot change who is called for this click.
  // One subscriber that throws must not starve the ones after it, the way the
  // layers store already isolates its subscribers.
  for (const subscriber of [..._subscribers]) {
    try {
      subscriber(result);
    } catch (error) {
      console.error("An inspection-result subscriber threw:", error);
    }
  }
}
