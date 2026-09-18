/**
 * The iframe embed's URL parameters: parsed, validated and clamped.
 *
 * Everything an embed can be configured with arrives here, from a URL a host
 * page wrote — so nothing is trusted. Every parameter is checked against the
 * layer config and unknown parameters are ignored.
 *
 * ## Absent is not "resolved to nothing"
 *
 * The two allowlists (`tabs`, `allow`) narrow what the embed shows, so a
 * mistyped one must never end up *widening* it. An allowlist the URL does not
 * carry means "no restriction"; an allowlist the URL carries that names nothing
 * the config knows means the host asked for nothing, and the embed renders an
 * explicit empty state (`empty: true`) rather than the whole config. The one
 * middle case — both allowlists resolve, but their intersection is empty
 * (`?tabs=hazard&allow=population`) — narrows to the tab selection alone, which
 * is still inside what the host asked for. Every dropped id is named in a
 * `console.warn`, because a host reading its own console is how this gets fixed.
 *
 * Values that are not allowlists still fall back to their default rather than
 * failing the embed: a mistyped `tab` shows the first tab, a mistyped layer key
 * in `layers` is dropped. The exception is `parentOrigin`, which a host writes
 * precisely to be explicit: a value that is not an http(s) origin disables the
 * message bridge instead of quietly reverting to the `document.referrer`
 * fallback.
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
 * Resolve one allowlist parameter against the ids the config knows.
 *
 * `supplied` says whether the URL carried the parameter at all — the thing the
 * old code could not tell, which is why an allowlist of typos used to widen to
 * the whole config. Unrecognised ids are dropped and named in a warning.
 *
 * @param {URLSearchParams} params
 * @param {string} name - the parameter name, for the warning
 * @param {Set<string>} known - every id the config knows
 * @returns {{ supplied: boolean, ids: string[]|null }}
 */
function allowlist(params, name, known) {
  const raw = params.get(name);
  const supplied = list(raw);
  if (!supplied) {
    if (raw !== null) console.warn(`Embed parameter "${name}" was supplied but names nothing.`);
    return { supplied: raw !== null, ids: [] };
  }
  const ids = supplied.filter((id) => known.has(id));
  const unknown = supplied.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.warn(
      `Embed parameter "${name}": ${unknown.map((id) => `"${id}"`).join(", ")} ` +
        `${unknown.length === 1 ? "is not" : "are not"} in the layer config and ${
          unknown.length === 1 ? "was" : "were"
        } ignored.`,
    );
  }
  return { supplied: true, ids };
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
 *   origin when the URL carries no `parentOrigin` at all
 * @returns {{
 *   tab: string,
 *   layers: Array<object>,
 *   tabIds: string[],
 *   layerKeys: string[],
 *   empty: boolean,
 *   panelCollapsed: boolean,
 *   parentOrigin: string|null,
 *   instance: string|null,
 * }}
 */
export function parseEmbedParams(search, { allTabs = TABS, referrer = "" } = {}) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");

  // The allowlists first: they decide what "a valid tab" and "a known layer"
  // even mean for this embed.
  const knownTabIds = new Set(allTabs.map((tab) => tab.id));
  const knownLayerKeys = new Set(
    allTabs
      .flatMap((tab) => tab.layers)
      .map((layer) => layer.key)
      .filter(Boolean),
  );
  const wantedTabs = allowlist(params, "tabs", knownTabIds);
  const wantedLayers = allowlist(params, "allow", knownLayerKeys);

  // Supplied and resolved to nothing: the host asked for nothing, so show
  // nothing. Widening to the whole config here is how `?allow=no-such-layer`
  // used to hand a host every tab and every layer it had just excluded.
  let empty =
    (wantedTabs.supplied && wantedTabs.ids.length === 0) ||
    (wantedLayers.supplied && wantedLayers.ids.length === 0);

  let shown = empty
    ? []
    : selectTabs(allTabs, {
        tabs: wantedTabs.ids.length > 0 ? wantedTabs.ids : null,
        layers: wantedLayers.ids.length > 0 ? wantedLayers.ids : null,
      });

  // Both allowlists name real things, but nothing is in both of them (the
  // plausible host mistake `?tabs=hazard&allow=population`). Narrow to the tab
  // selection alone — inside what the host asked for — rather than widening.
  if (!empty && shown.length === 0) {
    if (wantedTabs.ids.length > 0) {
      console.warn(
        `Embed parameter "allow": none of ${wantedLayers.ids.map((key) => `"${key}"`).join(", ")} ` +
          `is in the tabs "tabs" selects (${wantedTabs.ids.join(", ")}), so the layer allowlist was ignored.`,
      );
      shown = selectTabs(allTabs, { tabs: wantedTabs.ids });
    } else empty = true;
  }

  const registry = createLayerRegistry(shown);
  const layerKeys = [...registry.urlKeyOrder()];
  const tabIds = shown.map((tab) => tab.id);

  // Info tabs are deliberately not reachable in an embed (no information pages),
  // so only a data tab this embed shows is accepted.
  const requestedTab = params.get("tab");
  const tab = requestedTab && tabIds.includes(requestedTab) ? requestedTab : (tabIds[0] ?? null);

  const layers = clampLayers(parseLayerParams(params), { allowed: layerKeys, registry });

  const instance = params.get("instance");

  return {
    tab,
    layers,
    tabIds,
    layerKeys,
    /** Configured to show nothing (see "Absent is not resolved to nothing"). */
    empty,
    panelCollapsed: params.get("panel") === "collapsed",
    parentOrigin: resolveParentOrigin(params, referrer),
    instance: instance && INSTANCE_PATTERN.test(instance) ? instance : null,
  };
}

/**
 * The one origin the message bridge may talk to.
 *
 * `parentOrigin` is what a careful host writes to be explicit, so a typo in it
 * must not silently revert to the looser `document.referrer` mode: a supplied
 * value that is not an http(s) origin disables the bridge (`null`) and says so.
 * Only an absent parameter falls back to the referrer.
 *
 * @param {URLSearchParams} params
 * @param {string} referrer
 * @returns {string|null}
 */
function resolveParentOrigin(params, referrer) {
  const raw = params.get("parentOrigin");
  if (raw === null) return parseOrigin(referrer);
  const origin = parseOrigin(raw);
  if (!origin) {
    console.warn(
      `Embed parameter "parentOrigin": "${raw}" is not an http(s) origin, so the host message ` +
        `bridge is disabled in both directions. Pass an origin such as "https://www.undrr.org".`,
    );
  }
  return origin;
}
