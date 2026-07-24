/**
 * Structured MapX vector legends.
 *
 * MapX exposes complete vector style rules through `get_views`, while its
 * dedicated legend image command returns only a PNG. This module normalises
 * the supported part of the view style into a small, provider-neutral model
 * for the parent application's HTML renderer.
 */
import { getSDK } from "./client.js";

const MAX_LEGEND_RULES = 500;
const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,50}\)|[a-z]{1,30})$/i;

let catalogPromise = null;

function isSafeColor(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    COLOR_PATTERN.test(value.trim()) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function localizedValue(object, key, language) {
  if (!object || typeof object !== "object") return "";
  const requested = object[`${key}_${language}`] ?? object[language];
  if (typeof requested === "string" && requested.trim()) return requested.trim();

  const english = object[`${key}_en`] ?? object.en;
  if (typeof english === "string" && english.trim()) return english.trim();

  const prefix = `${key}_`;
  const fallback = Object.entries(object).find(
    ([candidateKey, value]) =>
      (candidateKey.startsWith(prefix) || (key === "" && candidateKey.length === 2)) &&
      typeof value === "string" &&
      value.trim(),
  );
  return fallback?.[1]?.trim() ?? "";
}

function displayValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function hasEnabledCustomStyle(style) {
  const json = style?.custom?.json;
  if (json == null || json === "") return false;
  if (typeof json === "object") return json?.enable === true;
  if (typeof json !== "string" || !json.trim()) return true;
  try {
    return JSON.parse(json)?.enable === true;
  } catch {
    return true;
  }
}

function normaliseRule(rule, language, geometry, isNoData = false) {
  if (!rule || !isSafeColor(rule.color)) return null;
  if (rule.sprite != null && rule.sprite !== "" && rule.sprite !== "none") return null;
  if (rule.add_border === true && !isSafeColor(rule.color_border)) return null;

  const localizedLabel = localizedValue(rule, "label", language);
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
 * Convert a MapX view returned by `get_views` into a structured legend.
 * Unsupported schemas return null so callers can use the authoritative PNG.
 */
export function parseMapXLegend(view, language = "en") {
  if (view?.type !== "vt") return null;

  const style = view?.data?.style;
  const rules = style?.rules;
  if (
    !style ||
    hasEnabledCustomStyle(style) ||
    (style.hideNulls != null && typeof style.hideNulls !== "boolean") ||
    !Array.isArray(rules) ||
    rules.length === 0 ||
    rules.length > MAX_LEGEND_RULES
  ) {
    return null;
  }

  const geometryValue = view?.data?.geometry?.type;
  if (!["point", "line", "polygon"].includes(geometryValue)) return null;
  const geometry = geometryValue;
  const entries = rules.map((rule) => normaliseRule(rule, language, geometry));
  if (entries.some((entry) => entry == null)) return null;

  if (style.hideNulls !== true && style.nulls != null) {
    if (!Array.isArray(style.nulls)) return null;
    if (entries.length + style.nulls.length > MAX_LEGEND_RULES) return null;
    for (const rule of style.nulls) {
      const entry = normaliseRule(rule, language, geometry, true);
      if (!entry) return null;
      entries.push(entry);
    }
  }

  const title = localizedValue(style.titleLegend, "", language);
  return { title, entries, source: "mapx-vector-style" };
}

async function getCatalog() {
  if (!catalogPromise) {
    catalogPromise = getSDK()
      .ask("get_views")
      .then((views) => {
        if (!Array.isArray(views)) throw new Error("MapX get_views did not return an array");
        return views;
      })
      .catch((error) => {
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

export async function getMapXLegend(idView, language = "en") {
  if (typeof idView !== "string" || !idView) return null;
  const views = await getCatalog();
  const view = views.find((candidate) => candidate?.id === idView);
  return view ? parseMapXLegend(view, language) : null;
}

/** Test helper: clear the project-catalogue request cache. */
export function resetMapXLegendCache() {
  catalogPromise = null;
}
