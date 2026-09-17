/**
 * Per-layer state: one record per layer key saying whether the layer is on,
 * which source or variant is showing and which MapX view carries it.
 *
 * This is step 1 of the layer-state refactor (unisdr/undrr-risk-resilience-maps#14).
 * The sidebar writes records alongside its existing state and reads `applied`
 * instead of the switch's `.is-active` class. `store.openViews` is kept as a
 * compatibility Set derived from these records (see mirrorOpenViews), and the
 * URL hash is serialised from them (see toUrlLayers). A later controller will
 * reconcile `desired` into `applied`.
 *
 * Nothing here touches the DOM, the URL or the SDK, and nothing runs on import.
 */
import { isLayerAvailable } from "../config/layers/status.js";

/**
 * @typedef {object} LayerRecord
 * @property {string} key - stable layer config key
 * @property {boolean} desired - what the user last asked for (on/off)
 * @property {boolean} applied - whether the layer is on (MapX confirmed the add)
 * @property {number} sourceIdx - compound layers: index into `sources`; 0 otherwise
 * @property {object|null} settings - external layers: provider settings (e.g. crop, scenario)
 * @property {string|null} viewId - MapX view currently on the map for this layer. Null while
 *   off and during a source switch, between removing the old view and adding the new one
 * @property {"idle"|"loading"|"removing"|"switching"|"error"} status
 * @property {unknown} error - last add failure, cleared on success
 */

const defaults = (key) =>
  Object.freeze({
    key,
    desired: false,
    applied: false,
    sourceIdx: 0,
    settings: null,
    viewId: null,
    status: "idle",
    error: null,
  });

/**
 * Create an empty layers store. Records are immutable snapshots; `set` replaces
 * a record and notifies subscribers with `(key, next, prev)`.
 *
 * Records keep first-write order (a Map), which is not activation order: a
 * layer turned off and on again keeps its position. Callers that need a stable
 * order (the URL hash) sort by config order instead.
 */
export function createLayersStore() {
  /** @type {Map<string, LayerRecord>} */
  const records = new Map();
  const subscribers = new Set();

  return {
    /** @returns {LayerRecord} the record, or an "off" record for unknown keys */
    get: (key) => records.get(key) ?? defaults(key),

    /** @returns {LayerRecord[]} every record written so far, in first-write order */
    all: () => [...records.values()],

    /**
     * Merge a patch into a layer's record. A patch that changes nothing is
     * not stored and does not notify.
     * @param {string} key
     * @param {Partial<Omit<LayerRecord, "key">>} patch
     */
    set(key, patch) {
      const prev = records.get(key) ?? defaults(key);
      if (records.has(key) && Object.keys(patch).every((field) => Object.is(prev[field], patch[field]))) {
        return prev;
      }
      const next = Object.freeze({ ...prev, ...patch, key });
      records.set(key, next);
      for (const fn of subscribers) fn(key, next, prev);
      return next;
    },

    /**
     * @param {(key: string, next: LayerRecord, prev: LayerRecord) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    /** @returns {string[]} MapX view ids of layers that are on, in first-write order */
    openViewIds: () => [...records.values()].filter((r) => r.applied && r.viewId).map((r) => r.viewId),
  };
}

/** The view a record contributes to `openViews`, or null. */
const openViewOf = (record) => (record.applied ? record.viewId : null);

/**
 * Keep a legacy `openViews` Set in step with the store, for readers that still
 * take a Set (`main.js`, `sdk/inspect.js`). Updates are incremental (delete the
 * old view, add the new one) so the Set keeps the same insertion order it had
 * when the sidebar mutated it directly.
 * @param {ReturnType<typeof createLayersStore>} layersStore
 * @param {Set<string>} openViews
 * @returns {() => void} unsubscribe
 */
export function mirrorOpenViews(layersStore, openViews) {
  return layersStore.subscribe((_key, next, prev) => {
    const before = openViewOf(prev);
    const after = openViewOf(next);
    if (before === after) return;
    if (before) openViews.delete(before);
    if (after) openViews.add(after);
  });
}

/**
 * Whether a record change alters what the URL should say. Status, `desired`
 * and the transient `viewId: null` during a source switch do not.
 */
export function changesUrlState(next, prev) {
  return (
    next.applied !== prev.applied || next.sourceIdx !== prev.sourceIdx || next.settings !== prev.settings
  );
}

/**
 * The order layers are listed in the URL hash: published, keyed layers in
 * config order (`tab.layers` of each tab in turn). This is the walk the hash
 * was always built from. It is not the sidebar's row order, which regroups a
 * tab's layers by R2R category (see `withR2rGroups`), so it must not be
 * derived from the rendered rows.
 * @param {Array<{ layers: object[] }>} tabs - `TABS` from the layer config
 * @returns {string[]}
 */
export function urlKeyOrder(tabs) {
  return tabs
    .flatMap((tab) => tab.layers)
    .filter((layer) => layer.key && isLayerAvailable(layer))
    .map((layer) => layer.key);
}

/**
 * The layers that are on, as URL state entries, ordered by `keyOrder` (config
 * order, see urlKeyOrder). Keys not in `keyOrder` are dropped. A layer mid source-switch (no
 * view on the map) is left out, as it was when the hash was built from openViews.
 * @param {LayerRecord[]} records
 * @param {string[]} keyOrder
 * @returns {Array<{ key: string, sourceIdx: number, settings?: object }>}
 */
export function toUrlLayers(records, keyOrder) {
  const rank = new Map(keyOrder.map((key, index) => [key, index]));
  return records
    .filter((record) => record.applied && record.viewId && rank.has(record.key))
    .sort((a, b) => rank.get(a.key) - rank.get(b.key))
    .map(({ key, sourceIdx, settings }) => (settings ? { key, sourceIdx, settings } : { key, sourceIdx }));
}
