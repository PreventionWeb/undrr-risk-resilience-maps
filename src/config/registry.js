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
 * @param {Array<{ id: string, layers: object[] }>} tabs
 * @returns {{
 *   byKey: (key: string) => object|undefined,
 *   byViewId: (viewId: string) => { tab: object, layer: object, source: object|null }|undefined,
 *   tabOf: (key: string) => object|undefined,
 *   allLayers: () => object[],
 *   urlKeyOrder: () => string[],
 * }}
 */
export function createLayerRegistry(tabs) {
  const layers = [];
  const keys = new Map(); // key → { tab, layer }
  const views = new Map(); // MapX view id → { tab, layer, source }

  for (const tab of tabs) {
    for (const layer of tab.layers) {
      layers.push(layer);
      if (layer.key && !keys.has(layer.key)) keys.set(layer.key, { tab, layer });
      if (layer.id && !views.has(layer.id)) views.set(layer.id, { tab, layer, source: null });
      for (const source of layer.sources ?? []) {
        if (source.id && !views.has(source.id)) views.set(source.id, { tab, layer, source });
      }
    }
  }
  const keyOrder = Object.freeze(urlKeyOrder(tabs));
  Object.freeze(layers);

  return Object.freeze({
    /** Layer config by key, published or not. */
    byKey: (key) => keys.get(key)?.layer,
    /** `{ tab, layer, source }` for a permanent MapX view id (a compound layer's sources too). */
    byViewId: (viewId) => views.get(viewId),
    /** The tab a layer key belongs to. */
    tabOf: (key) => keys.get(key)?.tab,
    /** Every layer, tab by tab in config order (published or not, keyed or not). */
    allLayers: () => layers,
    /** Hash order (see urlKeyOrder). */
    urlKeyOrder: () => keyOrder,
  });
}

let appRegistry = null;

/** The registry for the app's `TABS`, built on first use. */
export function getLayerRegistry() {
  appRegistry ??= createLayerRegistry(TABS);
  return appRegistry;
}
