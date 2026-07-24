/**
 * Structured MapX vector legends.
 *
 * MapX exposes complete vector style rules through `get_views`, while its
 * dedicated legend image command returns only a PNG. This module normalises
 * the supported part of the view style into a small, provider-neutral model
 * for the parent application's HTML renderer.
 */
import { getSDK } from "./client.js";
import { resolveRasterMapXLegend } from "./raster-legends.js";

const MAX_LEGEND_RULES = 500;
const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,50}\)|[a-z]{1,30})$/i;
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const SUPPORTED_GEOMETRIES = ["point", "line", "polygon"];

let catalogPromise = null;
let catalogSDK = null;

/**
 * @typedef {Object} LegendEntry
 * @property {string} color
 * @property {string} label
 * @property {number} opacity
 * @property {number|null} size
 * @property {"point"|"line"|"polygon"} geometry
 * @property {string|null} borderColor
 */

/**
 * @typedef {Object} LegendDefinition
 * @property {string} title
 * @property {LegendEntry[]} entries
 */

/**
 * @typedef {"raster"|"raster-json-unavailable"|"raster-json-invalid"|"raster-json-unsupported"|"unsupported-view-type"|"catalog-miss"|"custom-style"|"schema-invalid"|"too-many-rules"|"unsupported-style"} LegendFallbackReason
 */

/**
 * @typedef {Object} LegendResolution
 * @property {LegendDefinition|null} legend
 * @property {LegendFallbackReason|null} reason
 */

function isSafeColor(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    COLOR_PATTERN.test(value.trim()) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function localizedObjectValue(object, language) {
  if (!object || typeof object !== "object") return "";
  const requested = object[language];
  if (typeof requested === "string" && requested.trim()) return requested.trim();

  const english = object.en;
  if (typeof english === "string" && english.trim()) return english.trim();

  const fallback = Object.entries(object).find(
    ([candidateKey, value]) =>
      LANGUAGE_KEY_PATTERN.test(candidateKey) && typeof value === "string" && value.trim(),
  );
  return fallback?.[1]?.trim() ?? "";
}

function localizedPrefixedValue(object, prefix, language) {
  if (!object || typeof object !== "object") return "";
  const requested = object[`${prefix}${language}`];
  if (typeof requested === "string" && requested.trim()) return requested.trim();

  const english = object[`${prefix}en`];
  if (typeof english === "string" && english.trim()) return english.trim();

  const fallback = Object.entries(object).find(([candidateKey, value]) => {
    const suffix = candidateKey.slice(prefix.length);
    return (
      candidateKey.startsWith(prefix) &&
      LANGUAGE_KEY_PATTERN.test(suffix) &&
      typeof value === "string" &&
      value.trim()
    );
  });
  return fallback?.[1]?.trim() ?? "";
}

function displayValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function hasUnsupportedCustomStyle(style) {
  const json = style?.custom?.json;
  if (json == null || json === "") return false;
  if (typeof json === "object") return json?.enable !== false;
  if (typeof json !== "string" || !json.trim()) return true;
  try {
    return JSON.parse(json)?.enable !== false;
  } catch {
    return true;
  }
}

function normaliseRule(rule, language, geometry, isNoData = false) {
  if (!rule || !isSafeColor(rule.color)) return null;
  if (rule.sprite != null && rule.sprite !== "" && rule.sprite !== "none") return null;
  if (rule.add_border === true && !isSafeColor(rule.color_border)) return null;

  const localizedLabel = localizedPrefixedValue(rule, "label_", language);
  const label = localizedLabel || displayValue(rule.value) || (isNoData ? "No data" : "");
  if (!label) return null;

  const opacity = rule.opacity == null ? 1 : Number(rule.opacity);
  const size = rule.size == null ? null : Number(rule.size);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
  if (size != null && (!Number.isFinite(size) || size < 0 || size > 256)) return null;

  return {
    color: rule.color.trim(),
    label,
    opacity,
    size,
    geometry,
    borderColor: rule.add_border === true ? rule.color_border.trim() : null,
  };
}

/**
 * Resolve a MapX view returned by `get_views` into a structured legend or a
 * diagnostic fallback reason.
 *
 * @returns {LegendResolution}
 */
export function resolveParsedMapXLegend(view, language = "en") {
  if (view?.type !== "vt") {
    return { legend: null, reason: view?.type === "rt" ? "raster" : "unsupported-view-type" };
  }

  const style = view?.data?.style;
  const rules = style?.rules;
  if (hasUnsupportedCustomStyle(style)) {
    return { legend: null, reason: "custom-style" };
  }
  if (Array.isArray(rules) && rules.length > MAX_LEGEND_RULES) {
    return { legend: null, reason: "too-many-rules" };
  }
  if (
    !style ||
    (style.hideNulls != null && typeof style.hideNulls !== "boolean") ||
    !Array.isArray(rules) ||
    rules.length === 0
  ) {
    return { legend: null, reason: "schema-invalid" };
  }

  const geometryValue = view?.data?.geometry?.type;
  if (!SUPPORTED_GEOMETRIES.includes(geometryValue)) {
    return { legend: null, reason: "schema-invalid" };
  }
  const geometry = geometryValue;
  const entries = rules.map((rule) => normaliseRule(rule, language, geometry));
  if (entries.some((entry) => entry == null)) {
    return { legend: null, reason: "unsupported-style" };
  }

  if (style.hideNulls !== true && style.nulls != null) {
    if (!Array.isArray(style.nulls)) return { legend: null, reason: "schema-invalid" };
    if (entries.length + style.nulls.length > MAX_LEGEND_RULES) {
      return { legend: null, reason: "too-many-rules" };
    }
    for (const rule of style.nulls) {
      const entry = normaliseRule(rule, language, geometry, true);
      if (!entry) return { legend: null, reason: "unsupported-style" };
      entries.push(entry);
    }
  }

  const title = localizedObjectValue(style.titleLegend, language);
  return { legend: { title, entries }, reason: null };
}

/**
 * Convert a MapX view into a structured legend. Kept as the small parsing API
 * for callers that do not need fallback diagnostics.
 */
export function parseMapXLegend(view, language = "en") {
  return resolveParsedMapXLegend(view, language).legend;
}

async function getCatalog(refresh = false) {
  const sdk = getSDK();
  if (sdk !== catalogSDK) {
    catalogSDK = sdk;
    catalogPromise = null;
  }
  if (refresh) catalogPromise = null;

  if (!catalogPromise) {
    const request = sdk
      .ask("get_views")
      .then((views) => {
        if (!Array.isArray(views)) throw new Error("MapX get_views did not return an array");
        return views;
      })
      .catch((error) => {
        if (catalogPromise === request) catalogPromise = null;
        throw error;
      });
    catalogPromise = request;
  }
  return catalogPromise;
}

/**
 * Resolve a view from the live MapX catalogue. A cache miss is refreshed once
 * because `view_add` can add public cross-project views after initialisation.
 *
 * @returns {Promise<LegendResolution>}
 */
export async function resolveMapXLegend(idView, language = "en") {
  if (typeof idView !== "string" || !idView) {
    return { legend: null, reason: "catalog-miss" };
  }

  let views = await getCatalog();
  let view = views.find((candidate) => candidate?.id === idView);
  if (!view) {
    views = await getCatalog(true);
    view = views.find((candidate) => candidate?.id === idView);
  }
  if (!view) return { legend: null, reason: "catalog-miss" };
  if (view.type === "rt") return resolveRasterMapXLegend(view, language);
  return resolveParsedMapXLegend(view, language);
}

export async function getMapXLegend(idView, language = "en") {
  return (await resolveMapXLegend(idView, language)).legend;
}

/** Clear cached catalogue state after an SDK/project lifecycle change. */
export function resetMapXLegendCache() {
  catalogPromise = null;
  catalogSDK = null;
}
