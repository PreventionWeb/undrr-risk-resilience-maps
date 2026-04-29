/**
 * Site inspection mode.
 *
 * Manages an on/off toggle and collects batched `click_attributes` events from
 * the MapX SDK. MapX fires one `click_attributes` event per open vector-tile (vt)
 * view per map click; the batch is complete when all expected views have reported.
 *
 * Usage (from main.js):
 *   initInspection(mapxSDK)
 *   onInspectionResult((result) => showSiteInspector(result))
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
let _callback = null;

export function initInspection(mapx) {
  _mapx = mapx;
}

export function enableInspection() {
  _generation++;
  _active = true;
  _batch = null;
  // In dev mode keep MapX's native popup so we can cross-check data.
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: true }).catch(() => {});
  }
}

export function disableInspection() {
  _generation++;
  _active = false;
  _batch = null;
  if (!import.meta.env.DEV) {
    _mapx?.ask("set_features_click_sdk_only", { enable: false }).catch(() => {});
  }
}

export function isInspectionActive() {
  return _active;
}

/** Register a callback invoked with a completed batch result. */
export function onInspectionResult(cb) {
  _callback = cb;
}

/**
 * Process one `click_attributes` event from the SDK.
 *
 * Collects events into a Map keyed by view ID (handles out-of-order delivery).
 * Fires the callback when `map.size === nPart` (all views have reported).
 *
 * A generation stamp on the batch prevents stale events from a previous
 * click session or from after inspection was disabled from triggering the callback.
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

  if (!_batch || _batch.generation !== gen) return;

  _batch.parts.set(idView, attributes ?? []);

  if (_batch.parts.size === nPart) {
    const result = {
      lngLat: _batch.lngLat,
      views: Object.fromEntries(_batch.parts),
      openViewsSnapshot: _batch.openViewsSnapshot,
    };
    _batch = null;
    _callback?.(result);
  }
}
