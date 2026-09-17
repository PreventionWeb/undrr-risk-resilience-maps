/**
 * Per-layer state: one record per layer key saying whether the layer is on,
 * which source or variant is showing and which MapX view carries it.
 *
 * Part of the layer-state refactor (unisdr/undrr-risk-resilience-maps#14).
 * Records hold intent (`desired`, `sourceIdx`, `settings`), written by the UI,
 * and what MapX shows (`applied`, `viewId`, `appliedSourceIdx`,
 * `appliedSettings`), written by the layer controller
 * (src/services/layer-controller.js), which reconciles one into the other.
 * `store.openViews` is kept as a compatibility Set derived from these records
 * (see mirrorOpenViews), and the URL hash is serialised from the applied
 * fields (see toUrlLayers).
 *
 * Nothing here touches the DOM, the URL or the SDK, and nothing runs on import.
 */
/**
 * @typedef {object} LayerRecord
 * @property {string} key - stable layer config key
 * @property {boolean} desired - intent: what the user last asked for (on/off). When a
 *   MapX call fails it is reset to what MapX shows (a failed turn-on leaves `false`, a
 *   failed turn-off `true`), unless newer intent arrived during the call, so it only
 *   differs from `applied` while a call is in flight or pending
 * @property {number} sourceIdx - intent: compound layers' index into `sources`; 0 otherwise.
 *   Reset to `appliedSourceIdx` when a switch fails
 * @property {object|null} settings - intent: external layers' provider settings (e.g. crop,
 *   scenario); null means the provider defaults. Stored as a frozen copy; a patch with
 *   equal contents keeps the stored object
 * @property {boolean} applied - whether the layer is on (MapX confirmed the add)
 * @property {number} appliedSourceIdx - the source MapX shows (or last showed) for the layer
 * @property {object|null} appliedSettings - the provider settings of the external view on the
 *   map. Stored as a frozen copy, like `settings`
 * @property {string|null} viewId - MapX view currently on the map for this layer. Null while
 *   off and during a source switch, between removing the old view and adding the new one
 * @property {"idle"|"loading"|"removing"|"switching"|"error"} status - a MapX call in flight,
 *   or "error" when the last one failed (turn on, turn off, source switch or variant change)
 *   and intent was reset to the applied state
 * @property {unknown} error - that failure; kept until a later call for the layer succeeds
 */

const defaults = (key) =>
  Object.freeze({
    key,
    desired: false,
    sourceIdx: 0,
    settings: null,
    applied: false,
    appliedSourceIdx: 0,
    appliedSettings: null,
    viewId: null,
    status: "idle",
    error: null,
  });

/** Fields a patch may set. `key` is always the store key and is ignored in patches. */
const FIELDS = new Set(Object.keys(defaults("")).filter((field) => field !== "key"));
/** Object-valued fields, stored as frozen copies so callers can't mutate a record. */
const OBJECT_FIELDS = new Set(["settings", "appliedSettings"]);

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
     * Object fields (`settings`, `appliedSettings`) are stored as deep-frozen copies; a patch with
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
 * Whether a record change alters what the URL should say. Only what MapX
 * shows does: on/off, the applied source or settings, or a layer that is on
 * getting a view again (toUrlLayers leaves out a layer with no view, e.g. when
 * another layer wrote the hash during this layer's source switch). Intent,
 * status and the transient `viewId: null` during a source switch do not, so a
 * switch still writes once, when the new view arrives.
 */
export function changesUrlState(next, prev) {
  return (
    next.applied !== prev.applied ||
    next.appliedSourceIdx !== prev.appliedSourceIdx ||
    next.appliedSettings !== prev.appliedSettings ||
    Boolean(next.applied && next.viewId && !prev.viewId)
  );
}

/** Keys toUrlLayers has already warned about, so each is reported once. */
const unorderedKeysWarned = new Set();

/**
 * The layers that are on, as URL state entries built from their applied source
 * and settings (what MapX shows, not intent still loading), ordered by
 * `keyOrder` (config order, see `urlKeyOrder` in config/registry.js). A layer mid source-switch (no
 * view on the map) is left out, as it was when the hash was built from openViews.
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
    throw new TypeError("toUrlLayers: keyOrder is required (see urlKeyOrder in config/registry.js)");
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
    .map(({ key, appliedSourceIdx: sourceIdx, appliedSettings: settings }) =>
      settings ? { key, sourceIdx, settings } : { key, sourceIdx },
    );
}
