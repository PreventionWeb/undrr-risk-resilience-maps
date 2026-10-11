/**
 * Camera values: parsed, validated and clamped.
 *
 * The embed accepts a camera from two untrusted places, its URL (`center`,
 * `zoom`, `bbox`, `area`) and its host's messages (`set-view`, `fit-bounds`,
 * `fit-area`), and the layer config may carry a `bounds` per layer. All three
 * go through these functions, so a message cannot ask for a camera a URL could
 * not, and a config typo is caught by the same rule that refuses a host's.
 *
 * Each parser returns the clean value or `null`. None of them throws or logs:
 * deciding whether a `null` is a warning, an `error` message or a config error
 * is the caller's business.
 *
 * Nothing here touches the SDK or the DOM, and nothing runs on import.
 */

/** MapLibre's zoom range. Values outside it are clamped, not refused. */
export const ZOOM_MIN = 0;
export const ZOOM_MAX = 22;

/**
 * The latitude Web Mercator stops at. A latitude beyond it (but within ±90) is
 * clamped to it; one beyond ±90 is not a latitude and is refused.
 */
export const MAX_LATITUDE = 85.051129;

/**
 * A number from a number or a numeric string, else NaN. Strings come from the
 * URL; `Number("")` is 0, which must not pass for a coordinate.
 */
function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A longitude in [-180, 180], or null. */
function longitude(value) {
  const lng = toNumber(value);
  return Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null;
}

/** A latitude in [-90, 90], clamped to the Mercator limit, or null. */
function latitude(value) {
  const lat = toNumber(value);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 ? clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) : null;
}

/** `"a,b,c"` → `["a", "b", "c"]`; anything else unchanged. */
const splitList = (value) =>
  typeof value === "string" ? value.split(",").map((item) => item.trim()) : value;

/**
 * A map centre.
 *
 * Accepts `{ lng, lat }` (a message, or what MapX's `map_get_center` returns),
 * `[lng, lat]`, or the URL form `"lng,lat"` (GeoJSON order, as MapLibre takes
 * it).
 *
 * @param {unknown} value
 * @returns {{ lng: number, lat: number }|null}
 */
export function parseCenter(value) {
  const raw = splitList(value);
  let lngValue;
  let latValue;
  if (Array.isArray(raw)) {
    if (raw.length !== 2) return null;
    [lngValue, latValue] = raw;
  } else if (raw && typeof raw === "object") {
    ({ lng: lngValue, lat: latValue } = raw);
  } else {
    return null;
  }
  const lng = longitude(lngValue);
  const lat = latitude(latValue);
  return lng === null || lat === null ? null : { lng, lat };
}

/**
 * A zoom level, clamped to [ZOOM_MIN, ZOOM_MAX], or null when not a number.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseZoom(value) {
  const zoom = toNumber(value);
  return Number.isFinite(zoom) ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : null;
}

/**
 * A bounding box `[west, south, east, north]`.
 *
 * Accepts the array, or the URL form `"w,s,e,n"`. West must be less than east
 * and south less than north: a box crossing the antimeridian is refused rather
 * than guessed at (MapX's `map_set_bounds_array` takes the same four numbers
 * and has no way to say "the other way round"). Latitudes are clamped to the
 * Mercator limit.
 *
 * @param {unknown} value
 * @returns {[number, number, number, number]|null}
 */
export function parseBounds(value) {
  const raw = splitList(value);
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const west = longitude(raw[0]);
  const south = latitude(raw[1]);
  const east = longitude(raw[2]);
  const north = latitude(raw[3]);
  if (west === null || south === null || east === null || north === null) return null;
  if (!(west < east) || !(south < north)) return null;
  return [west, south, east, north];
}

/**
 * A view's spatial extent as MapX's `get_view_source_summary` reports it
 * (`extent_sp: { lng1, lat1, lng2, lat2 }`, computed server-side with
 * `ST_EstimatedExtent`), as bounds. Null when the summary has none or it is
 * not a usable box (an empty source estimates to a point).
 *
 * @param {unknown} extent
 * @returns {[number, number, number, number]|null}
 */
export function extentToBounds(extent) {
  if (!extent || typeof extent !== "object") return null;
  return parseBounds([extent.lng1, extent.lat1, extent.lng2, extent.lat2]);
}

/**
 * The bounds of a GeoJSON FeatureCollection's geometries (WGS84), or null when
 * it has no coordinates. Used for runtime GeoJSON views (external providers),
 * whose extent MapX's source summary cannot report: they have no server source.
 *
 * @param {{ features?: Array<{ geometry?: { coordinates?: unknown } }> }} collection
 * @returns {[number, number, number, number]|null}
 */
export function geojsonBounds(collection) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number") {
      const [lng, lat] = coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      return;
    }
    for (const item of coordinates) visit(item);
  };
  for (const feature of collection?.features ?? []) visit(feature?.geometry?.coordinates);
  return parseBounds([west, south, east, north]);
}

/**
 * A location code MapX's `common_loc_fit_bbox` understands: an ISO 3166-1
 * alpha-3 country code (`KEN`, case-insensitive, normalised to upper case) or
 * an M49 region code (`m49_029`, normalised to lower case). Whether MapX
 * actually knows the code is only learned by asking it.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseAreaCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim();
  if (/^[A-Za-z]{3}$/.test(code)) return code.toUpperCase();
  if (/^m49_\d{3}$/i.test(code)) return code.toLowerCase();
  return null;
}
