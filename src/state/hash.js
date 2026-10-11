/**
 * URL hash state encoding/decoding.
 *
 * Encodes the active tab and layer state into the URL hash so links
 * are shareable and browser back/forward works.
 *
 * Format: #tab?layers=key:sourceIdx,key:sourceIdx,...&variants=<encoded JSON>
 * Examples:
 *   #hazard
 *   #hazard?layers=river-flooding:0,earthquake-pga:2
 *   #exposure?layers=population,forests
 *
 * Simple layers use just the key (no colon). Compound layers append
 * :sourceIndex. Source index 0 is omitted for brevity. Runtime external
 * settings are stored separately in `variants` so shared links reproduce the
 * selected scientific variant without changing the existing layer syntax.
 */

import { getLayerRegistry } from "../config/registry.js";

/**
 * Decode the `layers` and `variants` parameters into a layers array.
 *
 * Shared by `parseHash()` and the iframe embed's URL parameters
 * (`src/embed/params.js`), so an embed URL and a share link cannot drift into
 * two dialects of the same syntax. It decides nothing about which layers exist:
 * unknown keys and out-of-range indices are the caller's business (the router
 * clamps and drops them, see `docs/embedding.md`).
 *
 * @param {URLSearchParams} params
 * @returns {Array<{key: string, sourceIdx: number, settings?: object}>}
 */
export function parseLayerParams(params) {
  const layers = [];
  const layerStr = params.get("layers");
  if (layerStr) {
    for (const segment of layerStr.split(",")) {
      const [key, idxStr] = segment.split(":");
      if (key) {
        layers.push({ key, sourceIdx: idxStr ? Number(idxStr) : 0 });
      }
    }
  }

  const variantsStr = params.get("variants");
  if (variantsStr) {
    try {
      applyVariants(layers, JSON.parse(variantsStr));
    } catch {
      // Invalid optional variant state must not break ordinary layer restore.
    }
  }

  return layers;
}

/**
 * Attach per-layer provider settings (`variants`: `{ [layerKey]: settings }`)
 * to the entries of a layers array, in place.
 *
 * The one reading of `variants`, shared by the share-link hash, the embed's
 * `variants` URL parameter and its host's `set-layers` command. A `variants`
 * that is not a plain object is ignored (returns `false`), as is an entry
 * whose settings are not one; a key no entry has is ignored too. Where an
 * entry already carries `settings`, the variant replaces them: a host that
 * echoes a `state` message's layers back with new `variants` is asking for
 * the new ones.
 *
 * @param {Array<{key: string, settings?: object}>} layers
 * @param {unknown} variants
 * @returns {boolean} whether `variants` had a usable shape
 */
export function applyVariants(layers, variants) {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return false;
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || !Object.hasOwn(variants, layer.key)) continue;
    const settings = variants[layer.key];
    if (settings && typeof settings === "object" && !Array.isArray(settings)) layer.settings = settings;
  }
  return true;
}

/**
 * Parse the URL hash into { tab, layers }.
 * @param {{ location?: { hash: string } }} [options] - where to read the hash
 *   (default: the global `location`)
 * @returns {{ tab: string|null, layers: Array<{key: string, sourceIdx: number, settings?: object}> }}
 */
export function parseHash({ location: loc = location } = {}) {
  const raw = loc.hash.replace("#", "");
  if (!raw) return { tab: null, layers: [] };

  const [tab, query] = raw.split("?");
  const layers = query ? parseLayerParams(new URLSearchParams(query)) : [];

  return { tab: tab || null, layers };
}

/**
 * Encode state as a URL hash, including the leading `#`.
 *
 * The one encoder: `writeHash()` below puts this in the address bar, and the
 * iframe embed uses it to build the "open the full viewer" link out of its own
 * state, so an embed can never offer a link in a different format from a share
 * link.
 *
 * @param {string} tab - Active tab ID
 * @param {Array<{key: string, sourceIdx: number, settings?: object}>} layers - Active layers
 * @returns {string}
 */
export function formatHash(tab, layers = []) {
  let hash = `#${tab}`;
  if (layers.length === 0) return hash;

  const segments = layers.map(({ key, sourceIdx }) => (sourceIdx > 0 ? `${key}:${sourceIdx}` : key));
  hash += `?layers=${segments.join(",")}`;

  const variants = Object.fromEntries(
    layers
      .filter(({ settings }) => settings && typeof settings === "object")
      .map(({ key, settings }) => [key, settings]),
  );
  if (Object.keys(variants).length > 0) {
    hash += `&variants=${encodeURIComponent(JSON.stringify(variants))}`;
  }
  return hash;
}

/**
 * Write the current state to the URL hash.
 * @param {string} tab - Active tab ID
 * @param {Array<{key: string, sourceIdx: number, settings?: object}>} layers - Active layers
 * @param {{ replace?: boolean, location?: { hash: string }, history?: History }} [options] -
 *   `replace` the current history entry (restoring state already in the URL)
 *   instead of pushing a new one; `location` and `history` default to the globals
 */
export function writeHash(
  tab,
  layers,
  { replace = false, location: loc = location, history: hist = history } = {},
) {
  const hash = formatHash(tab, layers);

  if (loc.hash === hash) return;
  if (replace) {
    hist.replaceState(null, "", hash);
  } else {
    hist.pushState(null, "", hash);
  }
}

/**
 * Look up a layer config by its key.
 * @returns {object|undefined}
 */
export function getLayerByKey(key) {
  return getLayerRegistry().byKey(key);
}
