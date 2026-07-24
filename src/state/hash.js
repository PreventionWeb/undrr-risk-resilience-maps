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
 * @returns {{ tab: string|null, layers: Array<{key: string, sourceIdx: number, settings?: object}> }}
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

    const variantsStr = params.get("variants");
    if (variantsStr) {
      try {
        const variants = JSON.parse(variantsStr);
        if (variants && typeof variants === "object" && !Array.isArray(variants)) {
          for (const layer of layers) {
            const settings = variants[layer.key];
            if (settings && typeof settings === "object" && !Array.isArray(settings)) {
              layer.settings = settings;
            }
          }
        }
      } catch {
        // Invalid optional variant state must not break ordinary layer restore.
      }
    }
  }

  return { tab: tab || null, layers };
}

/**
 * Write the current state to the URL hash.
 * @param {string} tab - Active tab ID
 * @param {Array<{key: string, sourceIdx: number, settings?: object}>} layers - Active layers
 */
export function writeHash(tab, layers) {
  let hash = `#${tab}`;

  if (layers.length > 0) {
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
