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
 *   offered only for the views in CSV_VIEWS, an explicit allowlist: each was
 *   checked to be region-level (keyed by an ISO3 code) against live MapX. A
 *   new vector view gets no CSV until it is reviewed and added; the config
 *   test fails until every published vector view is either in CSV_VIEWS or in
 *   CSV_EXCLUDED_VIEWS with a reason.
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

/**
 * Views offered as a values-only CSV: region-level vector views whose MapX
 * table returns an `iso3cd` column and joined values (checked live, MapX
 * 1.14.2, in the #64 spike). Add a view here only after checking its table.
 */
export const CSV_VIEWS = new Set([
  "MX-VCP83-3E2TG-PJWFJ", // recovery-speed
  "MX-YBWIB-YLHIV-WKG2H", // recovery-speed
  "MX-RTJQZ-WHX2B-SI4HB", // recovery-speed
  "MX-DMKUU-PAPIT-W4EMP", // recovery-speed
  "MX-HHA9G-4VUF9-CREXQ", // recovery-speed
  "MX-PZYN0-UQZTF-J6I8N", // recovery-speed
  "MX-O4I9O-FHOJD-EHNNA", // recovery-speed
  "MX-443WM-S89FY-2ANCD", // aal-public
  "MX-6HW4M-X4PAM-WH46T", // aal-public
  "MX-QLZI0-AXK6X-8OAN7", // aal-public
  "MX-2V1JX-EV4WL-AQKZV", // pml-public
  "MX-241F9-QO6FA-T9BU6", // pml-public
  "MX-T29Z1-M34D1-JUOCG", // pml-public
  "MX-IW2XA-WEITA-ROOG4", // pml-public
  "MX-YP5S0-VBMJK-R7IMX", // aal-pml-housing
  "MX-MKE3F-AONM0-27UM0", // aal-pml-housing
  "MX-O1L8F-IKWHZ-VZTO7", // aal-pml-housing
  "MX-ZA12C-TU5AH-L9K7P", // aal-pml-housing
  "MX-XY8R2-9T29I-7235T", // aal-pml-housing
  "MX-VWYGB-7A6CV-QC1UG", // aal-pml-housing
  "MX-FCU2W-1CCYO-NFZB9", // ecosystem-loss
  "MX-9NADN-CB8JT-WC1OD", // aal-to-gdp-2025
  "MX-Y0QE0-24K69-FKLY4", // aal-to-gdp-2025
  "MX-1IW5U-0WB6E-23TWY", // aal-to-gdp-2025
  "MX-YYCOH-BJR17-AI5DC", // aal-to-gdp-2025
  "MX-GWI29-SUI19-JI9NK", // aal-to-gdp-2025
  "MX-D7PMU-PL88W-UYF2D", // pml-to-gdp-2025
  "MX-AXEIH-GM2KV-TGOII", // pml-to-gdp-2025
  "MX-V0I12-3KA70-ZVMX9", // pml-to-gdp-2025
  "MX-2C1U4-W0QF9-OQ7EO", // pml-to-gdp-2025
  "MX-C7MNL-TEXT7-TN001", // pml-to-gdp-2025
  "MX-X144T-FVH4D-CNILH", // current-fiscal-gap
  "MX-6R1HD-1QCSB-CDRCP", // current-fiscal-gap
  "MX-VPWOT-F3J3E-N5CPW", // current-fiscal-gap
  "MX-HH3SN-J2JQY-ZKSZV", // current-fiscal-gap
  "MX-I91L8-9WESU-ZXA05", // current-fiscal-gap
  "MX-WOHMT-WYKWK-X25K9", // change-fiscal-gap
  "MX-5GL7W-40NYZ-T1IX1", // change-fiscal-gap
  "MX-SL3SM-AR11B-4LQ8T", // early-warning-coverage
  "MX-UN9Z8-4M5QH-PMDNX", // gar26-aal-crops
  "MX-CIIIB-BJ7B4-G1YG6", // gar26-aal-crops
  "MX-U104U-QMDX2-5UL94", // gar26-aal-crops
  "MX-JOTIK-6CSTJ-OA8DB", // gar26-aal-crops
  "MX-4MLSN-D6Y13-FAOJR", // gar26-aal-crops
  "MX-48ERS-5K1ZS-GMICQ", // gar26-aal-crops
  "MX-WYZ5O-SZGIE-T597Q", // gar26-aal-crops
  "MX-KU5ID-GHTH8-C2WG3", // gar26-aal-crops
  "MX-FKKGD-7CMDG-ZV1PP", // gar26-aal-crops
  "MX-JPPQA-C71PA-J3C58", // gar26-aal-crops
  "MX-WR2BR-2GJ3U-3G8GZ", // gar26-aal-crops
  "MX-6LQTF-XFQ99-B07H1", // gar26-aal-crops
  "MX-78U0U-BEVOJ-FLK1Z", // gar26-pml-crops
  "MX-JRK39-37KVL-IJJ94", // gar26-pml-crops
  "MX-0IBHG-7TSG0-WZQDP", // gar26-pml-crops
  "MX-FZYQQ-DENKB-BFA8X", // gar26-pml-crops
  "MX-114YI-7PVSK-QYDA4", // gar26-pml-crops
  "MX-K3JC8-BS9WN-VF5QL", // gar26-pml-crops
  "MX-1U3CC-72NY1-1H41D", // gar26-pml-crops
  "MX-58VRP-DC61S-U5NT7", // gar26-pml-crops
  "MX-D1BQT-8E7R1-X6QXH", // gar26-pml-crops
  "MX-Q0JWA-V69UI-YRDXZ", // gar26-pml-crops
  "MX-KV1RC-IJ1LI-5UDUZ", // gar26-pml-crops
  "MX-3SDJP-VGY08-QND0V", // gar26-pml-crops
  "MX-8DHMQ-LRK3K-53041", // gar26-top-25-production
  "MX-V9BNK-6JP5H-XCJ20", // gar26-top-25-production
  "MX-P7CDI-BQGF4-KAGN6", // gar26-top-25-production
  "MX-TYQLC-0R380-BNRPM", // gar26-top-25-production
  "MX-JCMXL-3WXSH-TK16M", // gar26-aal-global
  "MX-H8H7M-X4L16-A01Q4", // gar26-aal-global
]);

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

/** Is a CSV offered for this view of this layer? A published vector view on the allowlist. */
export function isCsvEligible(layer, viewId) {
  return Boolean(
    layer && isLayerAvailable(layer) && !layer.external && layer.type === "vt" && CSV_VIEWS.has(viewId),
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
