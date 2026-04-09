/**
 * URL hash state encoding/decoding.
 *
 * Encodes the active tab and layer state into the URL hash so links
 * are shareable and browser back/forward works.
 *
 * Format: #tab?layers=key:sourceIdx,key:sourceIdx,...
 * Examples:
 *   #hazard
 *   #hazard?layers=river-flooding:0,earthquake-pga:2
 *   #exposure?layers=population,forests
 *
 * Simple layers use just the key (no colon). Compound layers append
 * :sourceIndex. Source index 0 is omitted for brevity.
 */

import { TABS } from "../config/layers.js";

/** Build a flat lookup: key → layer config object. */
function buildLayerIndex() {
  const index = new Map();
  for (const tab of TABS) {
    for (const layer of tab.layers) {
      if (layer.key) index.set(layer.key, layer);
    }
  }
  return index;
}

let _layerIndex = null;
function getLayerIndex() {
  if (!_layerIndex) _layerIndex = buildLayerIndex();
  return _layerIndex;
}

/**
 * Parse the URL hash into { tab, layers }.
 * @returns {{ tab: string|null, layers: Array<{key: string, sourceIdx: number}> }}
 */
export function parseHash() {
  const raw = location.hash.replace("#", "");
  if (!raw) return { tab: null, layers: [] };

  const [tab, query] = raw.split("?");
  const layers = [];

  if (query) {
    const params = new URLSearchParams(query);
    const layerStr = params.get("layers");
    if (layerStr) {
      for (const segment of layerStr.split(",")) {
        const [key, idxStr] = segment.split(":");
        if (key) {
          layers.push({ key, sourceIdx: idxStr ? Number(idxStr) : 0 });
        }
      }
    }
  }

  return { tab: tab || null, layers };
}

/**
 * Write the current state to the URL hash.
 * @param {string} tab - Active tab ID
 * @param {Array<{key: string, sourceIdx: number}>} layers - Active layers
 */
export function writeHash(tab, layers) {
  let hash = `#${tab}`;

  if (layers.length > 0) {
    const segments = layers.map(({ key, sourceIdx }) =>
      sourceIdx > 0 ? `${key}:${sourceIdx}` : key,
    );
    hash += `?layers=${segments.join(",")}`;
  }

  if (location.hash !== hash) {
    history.pushState(null, "", hash);
  }
}

/**
 * Look up a layer config by its key.
 * @returns {object|undefined}
 */
export function getLayerByKey(key) {
  return getLayerIndex().get(key);
}

/**
 * Find which tab a layer key belongs to.
 * @returns {string|undefined}
 */
export function getTabForLayerKey(key) {
  for (const tab of TABS) {
    if (tab.layers.some((l) => l.key === key)) return tab.id;
  }
  return undefined;
}
