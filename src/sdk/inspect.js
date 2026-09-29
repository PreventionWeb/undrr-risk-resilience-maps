/**
 * Site inspection mode.
 *
 * Manages an on/off toggle and collects batched `click_attributes` events from
 * the MapX SDK. MapX fires one `click_attributes` event per open queryable view
 * per map click (types vt, gj and cc query rendered features; rt queries WMS
 * GetFeatureInfo); the batch is complete when all expected views have reported.
 *
 * Usage (from main.js):
 *   initInspection(mapxSDK)
 *   const off = onInspectionResult((result) => showSiteInspector(result))
 *   // wire a toggle button:
 *   enableInspection() / disableInspection()
 *   // in the click_attributes handler:
 *   if (isInspectionActive()) handleClickEvent(data, store.openViews)
 *   else showInfobox(data)
 */

let _mapx = null;
let _active = false;
/** Incremented on every enable/disable to invalidate in-flight batches. */
let _generation = 0;
/** { generation, lngLat, parts: Map<idView, attrs[]>, openViewsSnapshot: Set } */
let _batch = null;
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
  _generation++;
  _active = true;
  _batch = null;
  // In dev mode keep MapX's native popup so we can cross-check data.
  // NOTE: The production branch (enable: true call) is never exercised by the
  // test suite — Vitest always runs with import.meta.env.DEV === true.
  // MapX upstream: https://github.com/unep-grid/mapx/issues/1132. Up to 1.14.0, ask() never settles if a resolver
  // fails, so this call is fire-and-forget. From 1.14.1 it rejects with a
  // MapxSdkError; once prod runs 1.14.1+, await it and handle the rejection.
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: true }).catch(() => {});
  }
}

export function disableInspection() {
  _generation++;
  _active = false;
  _batch = null;
  // See enableInspection() comment — production path untested by automated tests.
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: false }).catch(() => {});
  }
}

export function isInspectionActive() {
  return _active;
}

/**
 * Subscribe to completed batch results. Every subscriber is called, in
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
 * Process one `click_attributes` event from the SDK.
 *
 * Collects events into a Map keyed by view ID (handles out-of-order delivery).
 * Fires the callback when `map.size === nPart` (all views have reported).
 *
 * A generation stamp on the batch prevents stale events from a previous
 * click session or from after inspection was disabled from triggering the callback.
 * The batch is also keyed on the click's `lngLat`: MapX handles each click
 * asynchronously, so a late event from an earlier click can arrive after the
 * next click's `part === 1`, and must not join (or complete) that batch.
 *
 * MapX upstream: https://github.com/unep-grid/mapx/issues/1139. If MapX adds
 * a single per-click event, subscribe to that instead and drop this batching.
 *
 * @param {object} data - click_attributes payload: {part, nPart, idView, attributes, lngLat}
 * @param {Set<string>} openViews - current store.openViews (snapshotted at batch start)
 */
export function handleClickEvent(data, openViews) {
  if (!_active) return;

  const { part, nPart, idView, attributes, lngLat } = data;
  const gen = _generation;

  if (part === 1) {
    _batch = {
      generation: gen,
      lngLat,
      parts: new Map(),
      openViewsSnapshot: new Set(openViews),
    };
  }

  if (!_batch || _batch.generation !== gen || !sameLngLat(_batch.lngLat, lngLat)) return;

  _batch.parts.set(idView, attributes ?? []);

  if (_batch.parts.size === nPart) {
    const result = {
      lngLat: _batch.lngLat,
      views: Object.fromEntries(_batch.parts),
      openViewsSnapshot: _batch.openViewsSnapshot,
    };
    _batch = null;
    // A snapshot, so a subscriber that unsubscribes (or subscribes) while the
    // result is being delivered cannot change who is called for this batch.
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
}

function sameLngLat(a, b) {
  return a?.lng === b?.lng && a?.lat === b?.lat;
}
