/**
 * Structured raster legends for MapX views backed by GeoServer WMS.
 *
 * MapX stores an authoritative legend URL on raster views. GeoServer's
 * GetLegendGraphic endpoint supports `format=application/json`, so compatible
 * sources can be normalised without parsing pixels or depending on MapX
 * internals. Every unsupported or failed request returns a diagnostic reason
 * so the caller can retain MapX's image legend as the fallback.
 */

import {
  displayLegendValue,
  isSafeLegendColor,
  isSafeLegendText,
  localizedLegendValue,
  MAX_LEGEND_ENTRIES,
} from "./legend-model.js";

const MAX_LEGEND_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const MAPX_MIRROR_URL = "https://api.mapx.org/get/mirror";
const APPROVED_MIRROR_ENDPOINTS = new Set([MAPX_MIRROR_URL]);
const SUPPORTED_COLORMAP_TYPES = new Set(["intervals", "values"]);

/**
 * Provider hosts approved for structured raster requests.
 *
 * URLs originate in mutable MapX metadata. Both direct browser requests and
 * server-side mirror requests therefore fail closed unless a maintainer has
 * reviewed and explicitly added the HTTPS provider here.
 */
const APPROVED_RASTER_PROVIDERS = new Map([
  [
    "giri.unepgrid.ch",
    {
      allowMirror: true,
      layers: new Set([
        "ingeniar:PGA_250y",
        "ingeniar:PGA_475y",
        "ingeniar:PGA_975y",
        "ingeniar:PGA_1500y",
        "ingeniar:PGA_2475y",
      ]),
      paths: new Set(["/geoserver/wms"]),
      queryKeys: new Set([
        "service",
        "version",
        "style",
        "styles",
        "request",
        "layer",
        "format",
        "transparent",
        "tranparent",
      ]),
    },
  ],
]);
const successfulResolutionCache = new Map();

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
  const providerPolicy = APPROVED_RASTER_PROVIDERS.get(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    !providerPolicy?.paths.has(url.pathname)
  ) {
    return null;
  }

  const query = new Map();
  for (const [key, value] of url.searchParams) {
    const normalizedKey = key.toLowerCase();
    if (!providerPolicy.queryKeys.has(normalizedKey) || query.has(normalizedKey)) return null;
    query.set(normalizedKey, value);
  }
  if (query.get("request")?.toLowerCase() !== "getlegendgraphic") return null;
  if (query.has("service") && query.get("service").toLowerCase() !== "wms") return null;
  if (!providerPolicy.layers.has(query.get("layer"))) return null;

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === "format") url.searchParams.delete(key);
  }
  url.searchParams.set("format", "application/json");
  return url.toString();
}

/**
 * Route a validated provider request through the same MapX mirror used by
 * MapX raster sources. This is a retry path for providers that allow
 * app.mapx.org but reject the embedding viewer's browser origin.
 */
export function getMapXMirrorUrl(providerUrl, mirrorBaseUrl = MAPX_MIRROR_URL) {
  const validatedProviderUrl = getGeoServerLegendJsonUrl(providerUrl);
  const provider = validatedProviderUrl ? new URL(validatedProviderUrl) : null;
  if (!provider || APPROVED_RASTER_PROVIDERS.get(provider.hostname)?.allowMirror !== true) {
    return null;
  }

  let mirrorUrl;
  try {
    mirrorUrl = new URL(mirrorBaseUrl);
  } catch {
    return null;
  }
  if (
    mirrorUrl.protocol !== "https:" ||
    mirrorUrl.username ||
    mirrorUrl.password ||
    mirrorUrl.search ||
    mirrorUrl.hash ||
    !APPROVED_MIRROR_ENDPOINTS.has(mirrorUrl.toString())
  ) {
    return null;
  }

  mirrorUrl.searchParams.set("url", validatedProviderUrl);
  return mirrorUrl.toString();
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
    if (!entry || !isSafeLegendColor(entry.color)) return null;
    const label = isSafeLegendText(entry.label) ? entry.label.trim() : displayLegendValue(entry.quantity);
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

  const resolvedTitle = isSafeLegendText(title)
    ? title.trim()
    : isSafeLegendText(legend.title)
      ? legend.title.trim()
      : "";
  return { title: resolvedTitle, entries };
}

/**
 * Resolve a MapX raster view into the shared structured legend model.
 *
 * The provider is attempted directly. Only the approved provider's explicit
 * HTTP 403 origin denial is retried through the MapX mirror. A single timeout
 * covers fetch, retry, and bounded response-body consumption.
 *
 * @param {Object} view Full MapX raster view returned by `get_views`
 * @param {string} language Preferred MapX legend-title language
 * @param {typeof fetch} request Injectable fetch-compatible request function
 * @param {{ mirrorBaseUrl?: string, signal?: AbortSignal }} options Transport overrides
 * @returns {Promise<Object>} Legend resolution with safe transport diagnostics
 */
export async function resolveRasterMapXLegend(view, language = "en", request = fetch, options = {}) {
  const legendUrl = view?.data?.source?.legend;
  const useCache = request === globalThis.fetch && options.signal == null && options.mirrorBaseUrl == null;
  const cacheKey = useCache ? JSON.stringify([view?.id, view?.date_modified, legendUrl, language]) : null;
  if (cacheKey && successfulResolutionCache.has(cacheKey)) {
    return successfulResolutionCache.get(cacheKey);
  }

  const resolutionPromise = resolveRasterMapXLegendUncached(view, language, request, options);
  if (cacheKey) successfulResolutionCache.set(cacheKey, resolutionPromise);

  const resolution = await resolutionPromise;
  if (cacheKey && !resolution.legend) successfulResolutionCache.delete(cacheKey);
  return resolution;
}

async function resolveRasterMapXLegendUncached(view, language, request, options) {
  const legendUrl = view?.data?.source?.legend;
  const jsonUrl = getGeoServerLegendJsonUrl(legendUrl);
  if (!jsonUrl) {
    return {
      legend: null,
      reason: "raster",
      diagnostic: { transport: "direct", failureKind: "provider-policy", status: null },
    };
  }

  const controller = new AbortController();
  let abortFailureKind = null;
  const abortFromCaller = () => {
    abortFailureKind = "aborted";
    controller.abort();
  };
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => {
    abortFailureKind = "timeout";
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const getAbortFailureKind = () => abortFailureKind;

  try {
    const direct = await requestLegend(jsonUrl, request, controller.signal, "direct", getAbortFailureKind);
    let outcome = direct;

    if (shouldRetryThroughMirror(direct)) {
      const mirrorUrl = getMapXMirrorUrl(jsonUrl, options.mirrorBaseUrl);
      if (mirrorUrl && !controller.signal.aborted) {
        const mirror = await requestLegend(
          mirrorUrl,
          request,
          controller.signal,
          "mapx-mirror",
          getAbortFailureKind,
        );
        outcome = {
          ...mirror,
          directFailureKind: direct.failureKind,
          directStatus: direct.status,
        };
      }
    }
    if (!outcome.response?.ok) {
      return unavailableResolution(outcome);
    }

    const response = outcome.response;
    const contentType = response.headers?.get?.("content-type") ?? "";
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (
      !contentType.toLowerCase().includes("json") ||
      (Number.isFinite(contentLength) && contentLength > MAX_LEGEND_BYTES)
    ) {
      return invalidResolution(
        outcome.transport,
        contentType.toLowerCase().includes("json") ? "content-length" : "content-type",
      );
    }

    const bodyResult = await readBoundedBody(response, controller.signal, getAbortFailureKind);
    if (bodyResult.body == null) {
      return invalidResolution(outcome.transport, bodyResult.failureKind);
    }

    let payload;
    try {
      payload = JSON.parse(bodyResult.body);
    } catch {
      return invalidResolution(outcome.transport, "json");
    }

    const title = localizedLegendValue(view?.data?.source?.legendTitles, language);
    const legend = parseGeoServerRasterLegend(payload, title);
    return legend
      ? { legend, reason: null, transport: outcome.transport, diagnostic: null }
      : {
          legend: null,
          reason: "raster-json-unsupported",
          diagnostic: { transport: outcome.transport, failureKind: "schema", status: null },
        };
  } catch (error) {
    return unavailableResolution({
      transport: "direct",
      failureKind: getAbortFailureKind() ?? "network",
      status: null,
      error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Clear successful raster results after an SDK/project lifecycle change. */
export function resetRasterLegendCache() {
  successfulResolutionCache.clear();
}

async function requestLegend(url, request, signal, transport, getAbortFailureKind) {
  if (signal.aborted) {
    return {
      response: null,
      transport,
      failureKind: getAbortFailureKind() ?? "aborted",
      status: null,
    };
  }

  try {
    const response = await abortable(
      request(url, {
        credentials: "omit",
        headers: { Accept: "application/json" },
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      }),
      signal,
    );
    return {
      response,
      transport,
      failureKind: response?.ok ? null : "http",
      status: Number.isInteger(response?.status) ? response.status : null,
    };
  } catch {
    return {
      response: null,
      transport,
      failureKind: getAbortFailureKind() ?? "network",
      status: null,
    };
  }
}

function shouldRetryThroughMirror(outcome) {
  return outcome.status === 403;
}

async function readBoundedBody(response, signal, getAbortFailureKind) {
  const reader = response.body?.getReader?.();
  if (!reader) return { body: null, failureKind: "body-stream" };

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!ArrayBuffer.isView(value) || value.byteLength !== value.length) {
        cancelReader(reader);
        return { body: null, failureKind: "body-stream" };
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_LEGEND_BYTES) {
        cancelReader(reader);
        return { body: null, failureKind: "body-too-large" };
      }
      chunks.push(value);
    }
  } catch {
    cancelReader(reader);
    return {
      body: null,
      failureKind: getAbortFailureKind() ?? "body-stream",
    };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), failureKind: null };
}

function cancelReader(reader) {
  try {
    Promise.resolve(reader.cancel()).catch(() => {});
  } catch {
    // Cancellation is best-effort; the request signal remains authoritative.
  }
}

async function abortable(promise, signal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function unavailableResolution(outcome) {
  return {
    legend: null,
    reason: "raster-json-unavailable",
    diagnostic: {
      transport: outcome.transport,
      failureKind: outcome.failureKind,
      status: outcome.status,
      ...(outcome.directFailureKind
        ? {
            directFailureKind: outcome.directFailureKind,
            directStatus: outcome.directStatus,
          }
        : {}),
    },
  };
}

function invalidResolution(transport, failureKind) {
  return {
    legend: null,
    reason: "raster-json-invalid",
    diagnostic: { transport, failureKind, status: null },
  };
}
