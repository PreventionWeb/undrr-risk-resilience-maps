/**
 * Structured raster legends for MapX views backed by GeoServer WMS.
 *
 * MapX stores an authoritative legend URL on raster views. GeoServer's
 * GetLegendGraphic endpoint supports `format=application/json`, so compatible
 * sources can be normalised without parsing pixels or depending on MapX
 * internals. Every unsupported or failed request returns a diagnostic reason
 * so the caller can retain MapX's image legend as the fallback.
 */

const MAX_LEGEND_BYTES = 256 * 1024;
const MAX_LEGEND_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 5000;
const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,50}\)|[a-z]{1,30})$/i;
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const SUPPORTED_COLORMAP_TYPES = new Set(["intervals", "values"]);

function isSafeColor(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    COLOR_PATTERN.test(value.trim()) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function isSafeLabel(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 200 &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}

function localizedObjectValue(object, language) {
  if (!object || typeof object !== "object") return "";
  const requested = object[language];
  if (isSafeLabel(requested)) return requested.trim();

  const english = object.en;
  if (isSafeLabel(english)) return english.trim();

  const fallback = Object.entries(object).find(
    ([candidateKey, value]) => LANGUAGE_KEY_PATTERN.test(candidateKey) && isSafeLabel(value),
  );
  return fallback?.[1]?.trim() ?? "";
}

function finiteOpacity(value, defaultValue = 1) {
  if (value == null || value === "") return defaultValue;
  const opacity = Number(value);
  return Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : null;
}

/**
 * Return a GeoServer JSON legend URL when the MapX legend URL exposes the
 * standard WMS GetLegendGraphic capability.
 */
export function getGeoServerLegendJsonUrl(legendUrl) {
  if (typeof legendUrl !== "string" || !legendUrl.trim()) return null;

  let url;
  try {
    url = new URL(legendUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  const queryValue = (name) => [...url.searchParams].find(([key]) => key.toLowerCase() === name)?.[1] ?? "";
  if (queryValue("request").toLowerCase() !== "getlegendgraphic") return null;
  if (queryValue("service") && queryValue("service").toLowerCase() !== "wms") return null;
  if (!queryValue("layer")) return null;

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === "format") url.searchParams.delete(key);
  }
  url.searchParams.set("format", "application/json");
  return url.toString();
}

/**
 * Parse GeoServer's documented GetLegendGraphic JSON representation.
 *
 * Only discrete raster colour maps are supported initially. Continuous
 * `ramp` legends fall back to the provider image because reproducing their
 * interpolation faithfully requires a different visual component.
 */
export function parseGeoServerRasterLegend(payload, title = "") {
  if (!payload || !Array.isArray(payload.Legend) || payload.Legend.length !== 1) return null;

  const legend = payload.Legend[0];
  if (!legend || !Array.isArray(legend.rules) || legend.rules.length === 0) return null;

  const symbolizers = legend.rules.flatMap((rule) =>
    Array.isArray(rule?.symbolizers) ? rule.symbolizers : [],
  );
  if (symbolizers.length !== 1 || !symbolizers[0]?.Raster) return null;

  const raster = symbolizers[0].Raster;
  const colormap = raster.colormap;
  if (!colormap || !SUPPORTED_COLORMAP_TYPES.has(colormap.type)) return null;
  if (
    !Array.isArray(colormap.entries) ||
    colormap.entries.length === 0 ||
    colormap.entries.length > MAX_LEGEND_ENTRIES
  ) {
    return null;
  }

  const rasterOpacity = finiteOpacity(raster.opacity);
  if (rasterOpacity == null) return null;

  const entries = colormap.entries.map((entry) => {
    if (!entry || !isSafeColor(entry.color)) return null;
    const label = isSafeLabel(entry.label)
      ? entry.label.trim()
      : isSafeLabel(String(entry.quantity ?? ""))
        ? String(entry.quantity).trim()
        : "";
    const entryOpacity = finiteOpacity(entry.opacity);
    if (!label || entryOpacity == null) return null;

    return {
      color: entry.color.trim(),
      label,
      opacity: rasterOpacity * entryOpacity,
      size: null,
      geometry: "polygon",
      borderColor: null,
    };
  });
  if (entries.some((entry) => entry == null)) return null;

  const resolvedTitle = isSafeLabel(title)
    ? title.trim()
    : isSafeLabel(legend.title)
      ? legend.title.trim()
      : "";
  return { title: resolvedTitle, entries };
}

/**
 * Resolve a MapX raster view into the shared structured legend model.
 */
export async function resolveRasterMapXLegend(view, language = "en", request = fetch) {
  const legendUrl = view?.data?.source?.legend;
  const jsonUrl = getGeoServerLegendJsonUrl(legendUrl);
  if (!jsonUrl) return { legend: null, reason: "raster" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await request(jsonUrl, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response?.ok) return { legend: null, reason: "raster-json-unavailable" };

    const contentType = response.headers?.get?.("content-type") ?? "";
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (
      !contentType.toLowerCase().includes("json") ||
      (Number.isFinite(contentLength) && contentLength > MAX_LEGEND_BYTES)
    ) {
      return { legend: null, reason: "raster-json-invalid" };
    }

    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_LEGEND_BYTES) {
      return { legend: null, reason: "raster-json-invalid" };
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return { legend: null, reason: "raster-json-invalid" };
    }

    const title = localizedObjectValue(view?.data?.source?.legendTitles, language);
    const legend = parseGeoServerRasterLegend(payload, title);
    return legend ? { legend, reason: null } : { legend: null, reason: "raster-json-unsupported" };
  } catch {
    return { legend: null, reason: "raster-json-unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
