/**
 * Layer registry: read-only indexes over the tab/layer config.
 *
 * Replaces the separate walks over `TABS` that each built their own lookup
 * (the sidebar's row map, `hash.js`'s key index, the site inspector's view
 * index, the URL key order). Part of unisdr/undrr-risk-resilience-maps#14.
 *
 * `createLayerRegistry(tabs)` is pure: it reads the config it is given, never
 * mutates it and touches no DOM, URL or SDK. `getLayerRegistry()` builds the
 * registry for the app's `TABS` on first use and returns that one instance
 * afterwards (the config is immutable, so one registry can be shared; see
 * docs/embedding.md). Nothing runs on import.
 */
import { TABS } from "./layers.js";
import { isLayerAvailable } from "./layers/status.js";

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
 * Index a tab config once.
 *
 * Keys and view ids are unique across the config (`validateLayers()` rejects
 * duplicates); if a config has duplicates anyway, the first occurrence wins.
 *
 * Freezing is shallow: the registry object, the key order and the
 * `byViewId` entries are frozen, but the tab, layer and source objects they
 * point to are the config's own objects, returned as they are and not frozen. Callers must treat them
 * as read-only.
 *
 * @param {Array<{ id: string, collection?: string, layers: object[] }>} tabs
 * Retired public keys (`layer.aliases`, see docs/inventory.md "Renaming a
 * layer key") resolve to the layer's current key through `canonicalKey`. They
 * are an input-only spelling: the registry's other lookups and the URL key
 * order know current keys only, so every caller canonicalises a key it was
 * handed before using it, and the app only ever writes current keys back.
 *
 * @returns {{
 *   byKey: (key: string) => object|undefined,
 *   canonicalKey: (key: unknown) => unknown,
 *   byViewId: (viewId: string) => { tab: object, layer: object, source: object|null }|undefined,
 *   urlKeyOrder: () => readonly string[],
 *   collectionOf: (key: string) => string|undefined,
 *   collectionOfTab: (tabId: string) => string|undefined,
 *   areCompatible: (keyA: string, keyB: string) => boolean,
 * }}
 */
export function createLayerRegistry(tabs) {
  const keys = new Map(); // key → layer
  const aliases = new Map(); // retired key → current key
  const views = new Map(); // MapX view id → { tab, layer, source }
  const tabCollections = new Map(); // tabId → collection
  const keyCollections = new Map(); // key → collection

  for (const tab of tabs) {
    const collection = tab.collection ?? "r2r";
    tabCollections.set(tab.id, collection);
    for (const layer of tab.layers) {
      if (layer.key && !keys.has(layer.key)) {
        keys.set(layer.key, layer);
        keyCollections.set(layer.key, collection);
      }
      if (layer.key) {
        for (const alias of layer.aliases ?? []) {
          if (typeof alias === "string" && alias && !aliases.has(alias)) aliases.set(alias, layer.key);
        }
      }
      if (layer.id && !views.has(layer.id)) views.set(layer.id, Object.freeze({ tab, layer, source: null }));
      for (const source of layer.sources ?? []) {
        if (source.id && !views.has(source.id)) views.set(source.id, Object.freeze({ tab, layer, source }));
      }
    }
  }
  // A current key always wins over an alias of the same spelling
  // (`validateLayers()` rejects that config, but the lookup must not depend on it).
  for (const key of keys.keys()) aliases.delete(key);
  const keyOrder = Object.freeze(urlKeyOrder(tabs));

  return Object.freeze({
    /** Layer config by key, published or not. */
    byKey: (key) => keys.get(key),
    /**
     * The current key for a retired one (`layer.aliases`); any other value,
     * a current key or an unknown one, is returned unchanged.
     */
    canonicalKey: (key) => (typeof key === "string" && aliases.has(key) ? aliases.get(key) : key),
    /** `{ tab, layer, source }` for a permanent MapX view id (a compound layer's sources too). */
    byViewId: (viewId) => views.get(viewId),
    /** Hash order (see urlKeyOrder). */
    urlKeyOrder: () => keyOrder,
    /** Collection name for a layer key (e.g. "r2r", "gar"), or undefined if unknown. */
    collectionOf: (key) => keyCollections.get(key),
    /** Collection name for a tab id (e.g. "r2r", "gar"), or undefined if not a data tab. */
    collectionOfTab: (tabId) => tabCollections.get(tabId),
    /** Whether two layer keys belong to the same collection. */
    areCompatible: (keyA, keyB) => {
      const colA = keyCollections.get(keyA);
      const colB = keyCollections.get(keyB);
      return Boolean(colA && colB && colA === colB);
    },
  });
}

let appRegistry = null;

/** The registry for the app's `TABS`, built on first use. */
export function getLayerRegistry() {
  appRegistry ??= createLayerRegistry(TABS);
  return appRegistry;
}

/**
 * The current key for a key from outside the app (a shared link, an embed URL,
 * a host message), resolving retired keys against the whole config. Used where
 * a key is parsed before any instance registry exists (the share-link hash and
 * the embed URL); an instance registry resolves the aliases of its own layers.
 * @param {unknown} key
 * @returns {unknown}
 */
export function canonicalLayerKey(key) {
  return getLayerRegistry().canonicalKey(key);
}
