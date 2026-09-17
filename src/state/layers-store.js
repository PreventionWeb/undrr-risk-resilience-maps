/**
 * Per-layer state: one record per layer key saying whether the layer is on,
 * which source or variant is showing and which MapX view carries it.
 *
 * This is step 1 of the layer-state refactor (unisdr/undrr-risk-resilience-maps#14).
 * The sidebar writes records alongside its existing state and reads `applied`
 * instead of the switch's `.is-active` class in clear-all, restore, reconcile,
 * accordion expand and the deferred turn-off (toggleLayer itself still checks
 * openViews and the external registry). `store.openViews` is kept as a
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
 * @property {boolean} desired - intent: what the user last asked for (on/off). When a
 *   MapX call fails it is reset to what MapX shows (a failed turn-on leaves `false`, a
 *   failed turn-off `true`), so it only differs from `applied` while a call is in flight
 * @property {boolean} applied - whether the layer is on (MapX confirmed the add)
 * @property {number} sourceIdx - compound layers: index into `sources`; 0 otherwise
 * @property {object|null} settings - external layers: provider settings (e.g. crop, scenario).
 *   Stored as a frozen copy; a patch with equal contents keeps the stored object
 * @property {string|null} viewId - MapX view currently on the map for this layer. Null while
 *   off and during a source switch, between removing the old view and adding the new one
 * @property {"idle"|"loading"|"removing"|"switching"|"error"} status - a MapX call in flight,
 *   or "error" when the last one failed (turn on, turn off, source switch or variant change)
 * @property {unknown} error - that failure; kept until a later call for the layer succeeds
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

/** Fields a patch may set. `key` is always the store key and is ignored in patches. */
const FIELDS = new Set(Object.keys(defaults("")).filter((field) => field !== "key"));
/** Object-valued fields, stored as frozen copies so callers can't mutate a record. */
const OBJECT_FIELDS = new Set(["settings"]);

const isPlainData = (value) =>
  Array.isArray(value) || (value !== null && typeof value === "object" && value.constructor === Object);

/** A deep, frozen copy of plain objects and arrays; other values as they are. */
function frozenCopy(value) {
  if (!isPlainData(value)) return value;
  const copy = Array.isArray(value) ? value.map(frozenCopy) : {};
  if (!Array.isArray(value)) {
    for (const [field, item] of Object.entries(value)) copy[field] = frozenCopy(item);
  }
  return Object.freeze(copy);
}

/** Deep equality for plain objects and arrays; `Object.is` for anything else. */
function sameData(a, b) {
  if (Object.is(a, b)) return true;
  if (!isPlainData(a) || !isPlainData(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const fields = Object.keys(a);
  return (
    fields.length === Object.keys(b).length &&
    fields.every((field) => Object.hasOwn(b, field) && sameData(a[field], b[field]))
  );
}

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
  /** key → the frozen "off" record returned for a key that has no record yet */
  const offRecords = new Map();
  const subscribers = new Set();

  function offRecord(key) {
    if (!offRecords.has(key)) offRecords.set(key, defaults(key));
    return offRecords.get(key);
  }

  return {
    /**
     * @returns {LayerRecord} the record, or for a key with no record a frozen "off"
     *   record. That default is created once per key and store, so `get(k) === get(k)`,
     *   and it is the `prev` passed to subscribers on the key's first write. It is not
     *   stored: `all()` does not list it.
     */
    get: (key) => records.get(key) ?? offRecord(key),

    /** @returns {LayerRecord[]} every record written so far, in first-write order */
    all: () => [...records.values()],

    /**
     * Merge a patch into a layer's record and notify subscribers before
     * returning. A patch that changes nothing, including a first write equal
     * to the "off" defaults, is not stored and does not notify.
     *
     * Unknown fields are ignored with a console warning, and `key` is ignored.
     * Object fields (`settings`) are stored as deep-frozen copies; a patch with
     * equal contents keeps the stored object, so it is not a change.
     * Subscriber errors are logged (console.error), never thrown.
     * @param {string} key
     * @param {Partial<Omit<LayerRecord, "key">>} patch
     * @returns {LayerRecord} the record after the patch
     */
    set(key, patch) {
      const prev = records.get(key) ?? offRecord(key);
      const changes = {};
      for (const [field, value] of Object.entries(patch)) {
        if (field === "key") continue;
        if (!FIELDS.has(field)) {
          console.warn(`Layers store: ignoring unknown field "${field}" for "${key}"`);
          continue;
        }
        if (OBJECT_FIELDS.has(field)) {
          if (!sameData(prev[field], value)) changes[field] = frozenCopy(value);
        } else if (!Object.is(prev[field], value)) {
          changes[field] = value;
        }
      }
      if (Object.keys(changes).length === 0) return prev;
      const next = Object.freeze({ ...prev, ...changes });
      records.set(key, next);
      // Subscribers run synchronously, in subscription order. One that throws
      // is logged and skipped, so it cannot stop the others or the caller,
      // which still has DOM work to finish after the write.
      for (const fn of subscribers) {
        try {
          fn(key, next, prev);
        } catch (error) {
          console.error(`Layers store subscriber failed for "${key}":`, error);
        }
      }
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
 * Whether a record change alters what the URL should say: on/off, source,
 * settings, or a layer that is on getting a view again (toUrlLayers leaves out
 * a layer with no view, e.g. after a source switch and its rollback both
 * failed). Status, `desired` and the transient `viewId: null` during a source
 * switch do not, so a switch still writes once, when the new view arrives.
 */
export function changesUrlState(next, prev) {
  return (
    next.applied !== prev.applied ||
    next.sourceIdx !== prev.sourceIdx ||
    next.settings !== prev.settings ||
    Boolean(next.applied && next.viewId && !prev.viewId)
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

/** Keys toUrlLayers has already warned about, so each is reported once. */
const unorderedKeysWarned = new Set();

/**
 * The layers that are on, as URL state entries, ordered by `keyOrder` (config
 * order, see urlKeyOrder). A layer mid source-switch (no view on the map) is
 * left out, as it was when the hash was built from openViews.
 *
 * `keyOrder` is required. A layer that is on but whose key is not in it is
 * left out too (the config walk never listed such a key), with a console
 * warning the first time each key is seen.
 * @param {LayerRecord[]} records
 * @param {string[]} keyOrder
 * @returns {Array<{ key: string, sourceIdx: number, settings?: object }>}
 */
export function toUrlLayers(records, keyOrder) {
  if (!Array.isArray(keyOrder)) {
    throw new TypeError("toUrlLayers: keyOrder is required (see urlKeyOrder)");
  }
  const rank = new Map(keyOrder.map((key, index) => [key, index]));
  const on = records.filter((record) => record.applied && record.viewId);
  for (const { key } of on) {
    if (rank.has(key) || unorderedKeysWarned.has(key)) continue;
    unorderedKeysWarned.add(key);
    console.warn(`toUrlLayers: layer "${key}" is not in the URL key order; leaving it out of the URL`);
  }
  return on
    .filter((record) => rank.has(record.key))
    .sort((a, b) => rank.get(a.key) - rank.get(b.key))
    .map(({ key, sourceIdx, settings }) => (settings ? { key, sourceIdx, settings } : { key, sourceIdx }));
}
