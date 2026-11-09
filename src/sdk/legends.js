/** Official MapX structured-legend contract and provider adapters (1.14.3+).
 * Successful results and concurrent requests are shared per manager/view/language.
 * Custom-code legends retain their reviewed methods hash; no upstream code runs.
 */
import { resolveCustomMapXLegend } from "./custom-legends.js";
import { CUSTOM_LEGENDS } from "./custom-legend-definitions.js";
import { getSDK } from "./client.js";
import {
  displayLegendValue,
  isSafeLegendColor,
  isSafeLegendText,
  localizedLegendValue,
  MAX_LEGEND_ENTRIES,
} from "./legend-model.js";
import { parseGeoServerRasterLegend } from "./raster-legends.js";

export const LEGEND_TIMEOUT_MS = 5000;
const MAX_LEGEND_BYTES = 256 * 1024;
const SUPPORTED_GEOMETRIES = new Set(["point", "line", "polygon"]);
const UNSUPPORTED_REASONS = new Set([
  "no_legend",
  "unsupported_provider",
  "custom_style",
  "fetch_failed",
  "invalid_response",
  "unsupported_view_type",
]);
let state = null;

function fallback(reason) {
  return { legend: null, reason };
}

/** Validate the public envelope before dispatching provider-owned data. */
export function resolveParsedMapXLegend(result, idView, language = "en") {
  if (
    !result ||
    result.idView !== idView ||
    !["vt", "rt", "cc", "sm", "gj"].includes(result.type) ||
    typeof result.supported !== "boolean"
  )
    return fallback("schema-invalid");

  if (!result.supported) {
    if (!UNSUPPORTED_REASONS.has(result.reason)) return fallback("schema-invalid");
    return fallback(result.reason.replaceAll("_", "-"));
  }
  // Bound validation work as well as the number of entries rendered. This cannot
  // cancel transport inside MapX, which already owns and fetched the response.
  try {
    if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_LEGEND_BYTES) {
      return fallback("schema-invalid");
    }
  } catch {
    return fallback("schema-invalid");
  }
  if (result.type === "rt" && result.provider === "geoserver") {
    const legend = parseGeoServerRasterLegend(result.data);
    return legend ? { legend, reason: null, transport: "mapx-sdk" } : fallback("raster-json-unsupported");
  }
  if (result.type !== "vt" || result.provider !== "mapx") return fallback("schema-invalid");
  const data = result.data;
  if (!SUPPORTED_GEOMETRIES.has(data?.geometry) || !Array.isArray(data.rules) || !data.rules.length) {
    return fallback("schema-invalid");
  }
  if (data.rules.length > MAX_LEGEND_ENTRIES) return fallback("too-many-rules");
  const entries = data.rules.map((rule) => normaliseRule(rule, language, data.geometry));
  if (entries.some((entry) => entry == null)) return fallback("unsupported-style");
  if (data.title != null && data.title !== "" && !isSafeLegendText(data.title))
    return fallback("schema-invalid");
  return { legend: { title: data.title?.trim() ?? "", entries }, reason: null, transport: "mapx-sdk" };
}

function normaliseRule(rule, language, geometry) {
  if (!rule || !isSafeLegendColor(rule.color)) return null;
  if (rule.sprite != null && rule.sprite !== "" && rule.sprite !== "none") return null;
  if (rule.color_border != null && !isSafeLegendColor(rule.color_border)) return null;
  const label =
    localizedLegendValue(rule.labels, language) ||
    displayLegendValue(rule.label) ||
    displayLegendValue(rule.value);
  // Computed rules already contain visible null rules and resolved range labels.
  // Preserve their order and labels instead of reconstructing scientific classes.
  if (!label) return null;
  const opacity = rule.opacity == null ? 1 : rule.opacity;
  const size = rule.size == null ? null : rule.size;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
  if (size != null && (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 256))
    return null;
  return {
    color: rule.color.trim(),
    label,
    opacity,
    size,
    geometry,
    borderColor: rule.color_border?.trim() ?? null,
  };
}

/** Bound waiting and keep legend bursts below the SDK's shared ten-request limit.
 * A timed-out in-flight call retains its slot until the SDK actually settles;
 * queued calls that expire are removed without sending anything to the iframe.
 */
function askWithDeadline(current, method, params) {
  return new Promise((resolve, reject) => {
    let started = false;
    const start = () => {
      started = true;
      current.active++;
      Promise.resolve()
        .then(() => current.sdk.ask(method, params))
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timeout);
          current.active--;
          while (current.active < 2 && current.queue.length) current.queue.shift()();
        });
    };
    const timeout = setTimeout(() => {
      if (!started) current.queue.splice(current.queue.indexOf(start), 1);
      reject(new Error(`MapX ${method} timed out`));
    }, LEGEND_TIMEOUT_MS);
    if (current.active < 2) start();
    else current.queue.push(start);
  });
}

async function resolveUncached(current, idView, language) {
  try {
    // Custom-code views have no structured SDK provider. Only our four reviewed
    // definitions need catalogue metadata, solely to detect methods drift.
    if (Object.hasOwn(CUSTOM_LEGENDS, idView)) {
      const views = await askWithDeadline(current, "get_views");
      const view = Array.isArray(views) ? views.find((item) => item?.id === idView) : null;
      if (view?.type !== "cc") return fallback("unsupported-view-type");
      return await resolveCustomMapXLegend(view);
    }
    const result = await askWithDeadline(current, "get_view_legend_json", { idView });
    return resolveParsedMapXLegend(result, idView, language);
  } catch {
    return fallback("sdk-unavailable");
  }
}

export async function resolveMapXLegend(idView, language = "en") {
  if (typeof idView !== "string" || !idView) return fallback("schema-invalid");
  const sdk = getSDK();
  if (state?.sdk !== sdk) state = { sdk, requests: new Map(), active: 0, queue: [] };
  const current = state;
  const key = JSON.stringify([idView, language]);
  if (!current.requests.has(key)) {
    const request = resolveUncached(current, idView, language);
    current.requests.set(key, request);
    request.then((result) => {
      if (!result.legend && current.requests.get(key) === request) current.requests.delete(key);
    });
  }
  return current.requests.get(key);
}

export async function getMapXLegend(idView, language = "en") {
  return (await resolveMapXLegend(idView, language)).legend;
}

export function resetMapXLegendCache() {
  state = null;
}
