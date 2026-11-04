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
 *   offered by rule: a published, non-external vector (`vt`) view, minus the
 *   views listed in CSV_EXCLUDED_VIEWS. The table carries no geometry, so a CSV
 *   only means something for region-level views keyed by an ISO3 code.
 *
 * Nothing here touches the DOM or the SDK.
 */
import { isLayerAvailable } from "./layers/status.js";

/** Files over this size get a warning next to their link (decimal gigabyte). */
export const LARGE_DOWNLOAD_BYTES = 1_000_000_000;

/**
 * Vector views that return a table but cannot make a useful values-only CSV,
 * with the reason. Checked against live MapX (1.14.2) in the #64 spike.
 */
export const CSV_EXCLUDED_VIEWS = new Map([
  // The view's attribute list has no region code column; its sibling views do.
  ["MX-MDFMH-34XOD-EU9HN", "The view returns no region code column."],
  // Not region-level: without geometry the rows identify nothing.
  ["MX-Z7JZA-I9BQC-KKVOT", "Not region-level (rows are grid cells with no region code)."],
  ["MX-TQ2DK-9RHAJ-CRPAN", "Not region-level (rows are grid cells with no region code)."],
  ["MX-1L2TA-6FXPV-N3QMX", "Not region-level (rows are river basins with no region code)."],
  ["MX-FX1HT-Z7KXL-8X22K", "Not region-level (rows are forest classes with no region code)."],
]);

/**
 * Where region names come from for a view whose table has no `maplab` column
 * (about 40 of the 69 CSV views carry only `name_en`, which is unsuitable):
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
  const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "download");
  const extension = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  return {
    url,
    bytes,
    filename,
    format: FORMATS[extension] ?? extension.toUpperCase(),
    large: bytes > LARGE_DOWNLOAD_BYTES,
  };
}

/** Is a CSV offered for this view of this layer? */
export function isCsvEligible(layer, viewId) {
  return Boolean(
    layer &&
    isLayerAvailable(layer) &&
    !layer.external &&
    layer.type === "vt" &&
    typeof viewId === "string" &&
    viewId.startsWith("MX-") &&
    !CSV_EXCLUDED_VIEWS.has(viewId),
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
  return { viewId, files: entries.map(normaliseDownload), csv: isCsvEligible(layer, viewId) };
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
