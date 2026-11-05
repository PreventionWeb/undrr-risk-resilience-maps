/**
 * What can be downloaded for a map view (prototype, behind `?downloads=1`; #64).
 *
 * Two kinds of download, decided from the layer config alone:
 *
 * - **Hosted files.** A view's `downloads: [[url, bytes], ...]` lists the files
 *   UNEP/GRID-Geneva host for it (GeoTIFFs at gar-data.unepgrid.ch). They come
 *   from the "Download URL" and "Download size (bytes)" columns of
 *   data/inventory.csv through scripts/import-inventory.mjs. Sizes are stored,
 *   not fetched, so rendering a link costs no request.
 * - **A values-only CSV**, generated in the browser from the view's MapX
 *   attribute table (see src/sdk/table.js and src/utils/region-csv.js). It is
 *   offered only for a view whose `csvDownload` is `"yes"`: the inventory's
 *   "CSV download" column, imported per view (the layer, or a compound
 *   source). `"no: <reason>"` records a view that was checked and refused;
 *   blank means not reviewed, so a new vector view gets no CSV until someone
 *   vets it with `yarn test:downloads-contract` and marks it `yes`.
 *
 * Nothing here touches the DOM or the SDK.
 */
import { isLayerAvailable } from "./layers/status.js";

/** The last path segment of a URL, decoded when it can be; never throws. */
function fileNameOf(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url).split(/[?#]/)[0];
  }
  const raw = path.split("/").pop() || "download";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Files over this size ask for confirmation before downloading (decimal gigabyte). */
export const LARGE_DOWNLOAD_BYTES = 1_000_000_000;

/**
 * Views whose table has no region code column, mapped to a sibling view on the
 * same MapX source that has one. The codes are matched row by row on `gid`
 * (attachRegionCodes), and the CSV fails rather than guess if the two tables
 * differ. The recovery-speed flood Q5 view's attribute list leaves out
 * `iso3cd`; the flood Q1 view reads the same source (checked live: same
 * source id, same 260 rows).
 */
export const REGION_CODE_SOURCES = new Map([["MX-MDFMH-34XOD-EU9HN", "MX-YBWIB-YLHIV-WKG2H"]]);

/**
 * Where region names come from for a view whose table has no `maplab` column
 * (about 40 of the CSV views carry only `name_en`, which is unsuitable):
 * another view on the same UN boundary table that does carry `maplab`, read
 * through MapX at runtime. This one returns a label for every standard region
 * code the other views have values for but one (left blank), and its labels
 * match the other `maplab` views exactly. No names are kept in this repo.
 */
export const REGION_NAME_REFERENCE_VIEW = "MX-0IBHG-7TSG0-WZQDP";

const FORMATS = { tif: "GeoTIFF", tiff: "GeoTIFF" };

/**
 * One hosted file, normalised: `{ url, bytes, filename, format, large }`.
 * @param {[string, number]} entry
 */
export function normaliseDownload([url, bytes]) {
  const filename = fileNameOf(url);
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  return {
    url,
    bytes,
    filename,
    format: FORMATS[extension] ?? extension.toUpperCase(),
    large: bytes > LARGE_DOWNLOAD_BYTES,
  };
}

/** A `csvDownload` value as written in the inventory: "yes", "no: <reason>" or blank. */
export function isValidCsvDownload(value) {
  return value === undefined || value === "" || value === "yes" || /^no: \S/.test(value);
}

/**
 * Is a CSV offered for this view? A published, non-external vector layer
 * whose view (the compound `source`, or the layer itself) is marked `yes`.
 */
export function isCsvEligible(layer, source = null) {
  const view = source ?? layer;
  return Boolean(
    layer &&
    isLayerAvailable(layer) &&
    !layer.external &&
    layer.type === "vt" &&
    typeof view?.id === "string" &&
    view.csvDownload === "yes",
  );
}

/**
 * The downloads for one view: the layer itself (simple layer) or one of its
 * compound sources. Unpublished layers offer nothing.
 *
 * @param {object} layer - layer config
 * @param {object|null} [source] - a compound source of `layer`
 * @returns {{ viewId: string|null, files: ReturnType<typeof normaliseDownload>[], csv: boolean }}
 */
export function getViewDownloads(layer, source = null) {
  const viewId = (source ? source.id : layer?.id) ?? null;
  if (!layer || !isLayerAvailable(layer)) return { viewId, files: [], csv: false };
  const entries = (source ? source.downloads : layer.downloads) ?? [];
  return { viewId, files: entries.map(normaliseDownload), csv: isCsvEligible(layer, source) };
}

/** Does any view of the layer (any compound source) offer a download? */
export function layerHasDownloads(layer) {
  const views = layer?.sources?.length ? layer.sources.map((source) => [layer, source]) : [[layer, null]];
  return views.some(([l, s]) => {
    const { files, csv } = getViewDownloads(l, s);
    return files.length > 0 || csv;
  });
}

/**
 * A byte count for people: decimal units (as file managers and the hosting
 * server's listings use), one decimal place from MB up.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  const shown = () => value.toFixed(unit === 0 ? 0 : 1);
  // Move up while the *rounded* value would reach 1000, so 999,999 bytes reads
  // "1.0 MB", not "1000 KB".
  while (unit < units.length - 1 && Number(shown()) >= 1000) {
    value /= 1000;
    unit++;
  }
  return `${shown()} ${units[unit]}`;
}
