/**
 * The iframe embed's URL parameters: parsed, validated and clamped.
 *
 * Everything an embed can be configured with arrives here, from a URL a host
 * page wrote — so nothing is trusted. Every parameter is checked against the
 * layer config, unknown parameters are ignored, and an invalid value falls back
 * to the default rather than failing the embed: a host that mistypes a layer key
 * gets a working map without that layer, not a blank frame.
 *
 * Parameters (see docs/embedding.md "How to embed"):
 *
 * | name           | value                                        | default             |
 * | -------------- | -------------------------------------------- | ------------------- |
 * | `tab`          | a data tab id                                | the first shown tab |
 * | `layers`       | `key[:sourceIdx]` list, comma separated      | none                |
 * | `variants`     | JSON of per-layer provider settings          | none                |
 * | `tabs`         | tab-id allowlist, comma separated            | every tab           |
 * | `allow`        | layer-key allowlist, comma separated         | every layer         |
 * | `panel`        | `collapsed` or `expanded`                    | `expanded`          |
 * | `parentOrigin` | the host origin messages are exchanged with  | `document.referrer` |
 * | `instance`     | opaque id echoed in every message            | none                |
 *
 * `layers` and `variants` are parsed by the same code as the share-link hash
 * (`parseLayerParams` in state/hash.js), so an embed URL and a share link cannot
 * drift into two dialects.
 *
 * Nothing runs on import.
 */
import { TABS } from "../config/layers.js";
import { createLayerRegistry } from "../config/registry.js";
import { clampSourceIdx } from "../services/layer-controller.js";
import { parseLayerParams } from "../state/hash.js";
import { selectTabs } from "../app/create-risk-map.js";

/**
 * How many layers an embed URL (or a host command) may open at once. Each one is
 * a MapX view and a legend request; a URL asking for fifty is a mistake or an
 * attempt to make the frame expensive, not a use case.
 */
export const MAX_LAYERS = 12;

/** Longest accepted `instance` id, and the characters it may use. */
const INSTANCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Split a comma-separated list parameter into trimmed, non-empty values. */
function list(value) {
  if (!value) return null;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * An origin string, or null. Only `http:`/`https:` absolute URLs count, and only
 * their origin is kept, so a host cannot smuggle a path, a query or credentials
 * into the `targetOrigin` the embed posts to.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function parseOrigin(value) {
  if (!value || typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // `origin` is "null" for opaque origins (a `data:` or sandboxed document).
  return url.origin && url.origin !== "null" ? url.origin : null;
}

/**
 * Validate and clamp a requested layer list against what an instance may show.
 *
 * Shared by the URL parameters and the host `set-layers` command, so a message
 * cannot ask for something a URL could not. Unknown or disallowed keys are
 * dropped, a source index the layer does not have falls back to its first source
 * (`clampSourceIdx`, the rule a share link already follows), duplicates keep
 * their first entry, provider settings survive only as a plain object, and
 * the list is cut to `MAX_LAYERS`.
 *
 * @param {unknown} layers - candidate entries, from a URL or a message
 * @param {{ allowed: Set<string>|string[], registry: { byKey: Function } }} context
 * @returns {Array<{ key: string, sourceIdx: number, settings?: object }>}
 */
export function clampLayers(layers, { allowed, registry }) {
  if (!Array.isArray(layers)) return [];
  const allowedKeys = allowed instanceof Set ? allowed : new Set(allowed);
  const seen = new Set();
  const clamped = [];

  for (const entry of layers) {
    if (!entry || typeof entry !== "object") continue;
    const { key } = entry;
    if (typeof key !== "string" || !allowedKeys.has(key) || seen.has(key)) continue;
    const layer = registry.byKey(key);
    if (!layer) continue;
    seen.add(key);

    const requested = Number(entry.sourceIdx);
    const sourceIdx = clampSourceIdx(layer, Number.isFinite(requested) ? requested : 0);
    const settings =
      entry.settings && typeof entry.settings === "object" && !Array.isArray(entry.settings)
        ? entry.settings
        : undefined;
    clamped.push(settings ? { key, sourceIdx, settings } : { key, sourceIdx });
    if (clamped.length === MAX_LAYERS) break;
  }

  return clamped;
}

/**
 * Parse an embed URL's query string into what the embed needs.
 *
 * @param {string|URLSearchParams} search - `location.search` or the params
 * @param {object} [context]
 * @param {object[]} [context.allTabs] - the layer config (default `TABS`)
 * @param {string} [context.referrer] - `document.referrer`, the fallback parent
 *   origin when the URL names none
 * @returns {{
 *   tab: string,
 *   layers: Array<object>,
 *   tabIds: string[],
 *   layerKeys: string[],
 *   panelCollapsed: boolean,
 *   parentOrigin: string|null,
 *   instance: string|null,
 * }}
 */
export function parseEmbedParams(search, { allTabs = TABS, referrer = "" } = {}) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");

  // The allowlists first: they decide what "a valid tab" and "a known layer"
  // even mean for this embed. Names that are not in the config are dropped, and
  // an allowlist that leaves nothing is treated as absent rather than as an
  // empty embed.
  const knownTabIds = new Set(allTabs.map((tab) => tab.id));
  const requestedTabs = list(params.get("tabs"))?.filter((id) => knownTabIds.has(id));
  const requestedLayers = list(params.get("allow"));
  const tabs = selectTabs(allTabs, {
    tabs: requestedTabs?.length ? requestedTabs : null,
    layers: requestedLayers?.length ? requestedLayers : null,
  });
  // Nothing survived (every name was a typo): show the whole config rather than
  // an empty frame.
  const shown = tabs.length > 0 ? tabs : allTabs;
  const registry = createLayerRegistry(shown);
  const layerKeys = [...registry.urlKeyOrder()];
  const tabIds = shown.map((tab) => tab.id);

  // Info tabs are deliberately not reachable in an embed (no information pages),
  // so only a data tab this embed shows is accepted.
  const requestedTab = params.get("tab");
  const tab = requestedTab && tabIds.includes(requestedTab) ? requestedTab : tabIds[0];

  const layers = clampLayers(parseLayerParams(params), { allowed: layerKeys, registry });

  const instance = params.get("instance");
  const parentOrigin = parseOrigin(params.get("parentOrigin")) ?? parseOrigin(referrer);

  return {
    tab,
    layers,
    tabIds,
    layerKeys,
    panelCollapsed: params.get("panel") === "collapsed",
    parentOrigin,
    instance: instance && INSTANCE_PATTERN.test(instance) ? instance : null,
  };
}
