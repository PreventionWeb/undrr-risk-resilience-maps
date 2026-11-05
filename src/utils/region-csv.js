/**
 * Values-only CSV for a region-level MapX vector view (prototype, #64).
 *
 * Pure: takes the rows `get_view_table_attribute` returned and our own layer
 * config, returns the file's text. No DOM, no SDK. src/ui/downloads.js does the
 * fetching and the browser download.
 *
 * ## What MapX returns
 *
 * Only the attributes the view is set up to show, never geometry: the value
 * column(s) with a join prefix (`j0_aal_households_existingclimate`), the
 * region code `iso3cd`, a name column (`maplab`, the UN map label, or
 * `name_en`) and `gid`, the source's internal row id.
 *
 * ## What the CSV holds
 *
 * - `region_code`, `region_name`, then one column per value attribute. Only joined
 *   value attributes (`jN_…`) are exported: a whitelist, so a column MapX might
 *   add later (geometry, coordinates, timestamps) can never become a value. A
 *   single value column is named from our layer config (the view's label);
 *   otherwise, or without a label, from the attribute name without its prefix.
 * - `region_name` is `maplab`. `name_en` is not used: it holds the romanised
 *   local names joined with `#` (several languages in one cell), which is not a
 *   display name. A view without `maplab` takes names from `regionNames` (the
 *   caller reads them from another view on the same boundary table; see
 *   REGION_NAME_REFERENCE_VIEW), and a code missing there is left blank. No
 *   lookup table of names is kept in this repo.
 * - `region_code` is the geographic area code from the map's boundary table:
 *   an ISO 3166-1 alpha-3 code where one exists, and the map service's own
 *   code for other areas. Every area the map shows a value for is exported,
 *   as on the map; the metadata block carries the standard UN disclaimer
 *   (UN_DISCLAIMER), and the file does not call the codes country codes.
 * - Dropped: `gid`; rows with no value (null, blank, NaN, Infinity); rows with
 *   no usable area code; and a code repeated after its first row.
 *
 * ## Format
 *
 * UTF-8 with a byte-order mark (so Excel reads the names correctly), CRLF line
 * ends and RFC 4180 quoting. A short metadata block from our config comes
 * first: one line per field, `#,"<Label>: <value>"` (title, citation, license,
 * source, MapX view ID, download date). We chose a header block over a sidecar
 * file: one download, and the attribution travels with the data. Data tools
 * skip it with a comment option (`pandas.read_csv(path, comment="#")`,
 * `read.csv(path, comment.char = "#")`), which needs the `#` outside quotes;
 * the quoted text after it keeps a citation's commas in one spreadsheet cell.
 */

import { csvCell, csvRow, csvText } from "./csv.js";
import { HIDDEN_ATTRIBUTE_KEYS } from "./html.js";

/** The region code column every region-level view carries. */
export const REGION_CODE_ATTRIBUTE = "iso3cd";
/** The UN map label column, when the view has one. */
export const REGION_NAME_ATTRIBUTE = "maplab";
/** Joined value attributes, the only ones exported: `j0_…`, `j1_…`. */
const VALUE_ATTRIBUTE = /^j\d+_./;
/** Never values even if prefixed, and never a reason to keep a row. */
const NEVER_VALUES = new Set(HIDDEN_ATTRIBUTE_KEYS);
/** Our own column names; a value header that would repeat one keeps its full attribute name. */
const FIXED_HEADERS = ["region_code", "region_name"];
/** Defuse formulas in every cell of the region CSV (see csvCell). */
const DEFUSE = { defuse: true };

/** A CSV could not be made from the table, with a stable `code`. */
export class RegionCsvError extends Error {
  /**
   * @param {"no-region-code"|"no-values"|"no-rows"} code
   * @param {string} message - for people
   */
  constructor(code, message) {
    super(message);
    this.name = "RegionCsvError";
    this.code = code;
  }
}

/**
 * The standard United Nations disclaimer, worded for a dataset. It goes in
 * every region CSV's metadata block.
 */
export const UN_DISCLAIMER =
  "The designations employed and the presentation of material in this dataset do not imply the expression of any opinion whatsoever on the part of the Secretariat of the United Nations concerning the legal status of any country, territory, city or area or of its authorities, or concerning the delimitation of its frontiers or boundaries.";

/**
 * A usable area code: a short run of letters and digits (`CHE`, or a map
 * service code such as `xab`). Anything else (null, blank, punctuation, long
 * text) is not a code, and its row is left out.
 */
export function isRegionCode(code) {
  return typeof code === "string" && /^[A-Za-z0-9]{2,8}$/.test(code);
}

/** `j0_crop_all_aal_wheat` → `crop_all_aal_wheat`. */
export function stripJoinPrefix(attribute) {
  return String(attribute).replace(/^j\d+_/, "");
}

/** MapX's empty values: null, missing, blank, the vector-tile `$NULL`, and non-finite numbers. */
function isEmptyValue(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  return value === null || value === undefined || value === "" || value === "$NULL";
}

/** `<layer-key>_<view-id>.csv`, limited to characters every file system accepts. */
export function csvFilename(layerKey, viewId) {
  const safe = (part) => String(part ?? "").replace(/[^A-Za-z0-9_-]+/g, "-");
  return `${safe(layerKey)}_${safe(viewId)}.csv`;
}

/** The view's display label: the layer, plus the compound source shown. */
export function viewLabel(layer, source = null) {
  return source?.label ? `${layer.label} – ${source.label}` : layer.label;
}

/**
 * The metadata block for a view, from our config: `[label, value]` pairs.
 * Empty values are dropped when the block is written.
 *
 * @param {{ layer: object, source?: object|null, viewId: string, date?: Date, viewerUrl?: string, namesMissing?: boolean }} options
 *   `viewerUrl` is the viewer the file was downloaded from (the page's own
 *   location, so a preview or local build says so); `namesMissing` notes that
 *   region names could not be read.
 * @returns {Array<[string, string]>}
 */
export function csvMetadata({
  layer,
  source = null,
  viewId,
  date = new Date(),
  viewerUrl = "",
  namesMissing = false,
}) {
  const license = [layer.license, layer.licenseUrl].filter(Boolean).join(" ");
  return [
    ["Title", viewLabel(layer, source)],
    ["Description", source?.desc || layer.desc],
    ["Source", source?.source || layer.source],
    ["Source URL", layer.sourceUrl],
    ["Citation", layer.citation],
    ["License", license],
    ["MapX view ID", viewId],
    ["Layer key", layer.key],
    ["Downloaded (UTC)", date.toISOString().slice(0, 10)],
    ["Downloaded from", viewerUrl],
    [
      "Region names",
      // Filled in once the rows are known (buildRegionCsv passes the counts).
      ({ rowCount = 0, unnamedCount = 0 } = {}) =>
        namesMissing
          ? "Not available for this download: the map service could not provide them."
          : unnamedCount > 0
            ? `UN map labels as published in MapX. ${unnamedCount} of ${rowCount} regions have no name in the map service; their region_name is blank.`
            : "UN map labels as published in MapX.",
    ],
    [
      "Region codes",
      "ISO 3166-1 alpha-3 where one exists; other areas use the map service's own code. Codes identify geographic areas as drawn on the map.",
    ],
    ["Note", "Values only; region boundaries are not included. Rows with no value are left out."],
    ["Disclaimer", UN_DISCLAIMER],
  ];
}

/**
 * `region code → maplab` from a table that has `maplab`.
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Map<string, string>}
 */
export function regionNamesFrom(rows) {
  const names = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = row?.[REGION_CODE_ATTRIBUTE];
    const name = row?.[REGION_NAME_ATTRIBUTE];
    if (isRegionCode(code) && typeof name === "string" && name.trim() && !names.has(code))
      names.set(code, name);
  }
  return names;
}

/** Does the table carry its own `maplab` column? */
export function hasRegionNames(rows) {
  return Array.isArray(rows) && rows.some((row) => row && REGION_NAME_ATTRIBUTE in row);
}

/** Value columns: the joined (`jN_…`) attributes in the rows, in first-seen order. */
function valueAttributes(rows) {
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (VALUE_ATTRIBUTE.test(key) && !NEVER_VALUES.has(stripJoinPrefix(key))) seen.add(key);
    }
  }
  return [...seen];
}

/**
 * Header names for the value columns. Without prefixes, except where that
 * would repeat another column's name (another value or region_code/region_name).
 */
function valueHeaders(attributes, valueLabel) {
  if (attributes.length === 1 && valueLabel && !FIXED_HEADERS.includes(valueLabel)) return [valueLabel];
  const stripped = attributes.map(stripJoinPrefix);
  return stripped.map((name, i) =>
    FIXED_HEADERS.includes(name) || stripped.indexOf(name) !== stripped.lastIndexOf(name)
      ? attributes[i]
      : name,
  );
}

/**
 * The metadata lines: `#,"Label: value"`. The `#` is outside the quotes, so
 * comment options skip the line; the rest is one defused, quoted cell.
 */
function metadataLines(metadata, stats) {
  return (
    metadata
      // A value may depend on the rows written (see csvMetadata's "Region names").
      .map(([label, value]) => [label, typeof value === "function" ? value(stats) : value])
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(
        ([label, value]) =>
          `#,${csvCell(`${label}: ${String(value).replace(/\s*[\r\n]+\s*/g, " ")}`, DEFUSE)}`,
      )
  );
}

/**
 * Build the CSV.
 *
 * @param {Array<Record<string, unknown>>} rows - from `get_view_table_attribute`
 * @param {object} [options]
 * @param {string} [options.valueLabel] - name for a single value column (our layer label)
 * @param {Array<[string, string]>} [options.metadata] - see csvMetadata(); none by default
 * @param {Map<string, string>} [options.regionNames] - names by code, for rows without `maplab`
 * @returns {{ csv: string, rowCount: number, unnamedCount: number, droppedNoValue: number, droppedNoCode: number, droppedDuplicate: number, valueAttributes: string[] }}
 * @throws {RegionCsvError} when the table has no rows, no region code column or no value column
 */
export function buildRegionCsv(rows, { valueLabel = "", metadata = [], regionNames = new Map() } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new RegionCsvError("no-rows", "The map service returned no data for this layer.");
  }
  if (!rows.some((row) => row && REGION_CODE_ATTRIBUTE in row)) {
    throw new RegionCsvError(
      "no-region-code",
      "This layer's data has no region codes, so it cannot be exported as a values-only CSV.",
    );
  }
  const attributes = valueAttributes(rows);
  if (attributes.length === 0) {
    throw new RegionCsvError("no-values", "This layer's data has no value column to export.");
  }

  let droppedNoValue = 0;
  let droppedNoCode = 0;
  let droppedDuplicate = 0;
  const kept = new Map();
  for (const row of rows) {
    if (!row || attributes.every((attribute) => isEmptyValue(row[attribute]))) {
      droppedNoValue++;
      continue;
    }
    const code = row[REGION_CODE_ATTRIBUTE];
    if (!isRegionCode(code)) {
      droppedNoCode++;
      continue;
    }
    if (kept.has(code)) {
      droppedDuplicate++;
      continue;
    }
    kept.set(code, row);
  }
  // `||`: a blank maplab falls back to the reference name too.
  const nameOf = (row) => row[REGION_NAME_ATTRIBUTE] || regionNames.get(row[REGION_CODE_ATTRIBUTE]) || "";
  const sorted = [...kept.values()].sort((a, b) =>
    a[REGION_CODE_ATTRIBUTE].localeCompare(b[REGION_CODE_ATTRIBUTE]),
  );

  const unnamedCount = sorted.filter((row) => !nameOf(row)).length;
  const lines = [
    ...metadataLines(metadata, { rowCount: sorted.length, unnamedCount }),
    csvRow([...FIXED_HEADERS, ...valueHeaders(attributes, valueLabel)], DEFUSE),
    ...sorted.map((row) =>
      csvRow(
        [
          row[REGION_CODE_ATTRIBUTE],
          nameOf(row),
          ...attributes.map((attribute) => (isEmptyValue(row[attribute]) ? "" : row[attribute])),
        ],
        DEFUSE,
      ),
    ),
  ];

  return {
    csv: csvText(lines),
    rowCount: sorted.length,
    unnamedCount,
    droppedNoValue,
    droppedNoCode,
    droppedDuplicate,
    valueAttributes: attributes,
  };
}

/**
 * Give a table without region codes the codes of a sibling view on the same
 * MapX source, matched by `gid` (the source's row id). The two tables must
 * hold exactly the same rows; otherwise this throws rather than guess.
 *
 * @param {Array<Record<string, unknown>>} rows - the view's table, without `iso3cd`
 * @param {Array<Record<string, unknown>>} codeRows - the sibling's table, with `iso3cd` and `gid`
 * @returns {Array<Record<string, unknown>>} copies of `rows` with `iso3cd`
 * @throws {RegionCsvError} "no-region-code" when the rows do not match
 */
export function attachRegionCodes(rows, codeRows) {
  const mismatch = () =>
    new RegionCsvError(
      "no-region-code",
      "This layer's data has no region codes, and they could not be matched from a related layer.",
    );
  if (!Array.isArray(rows) || !Array.isArray(codeRows) || rows.length !== codeRows.length) throw mismatch();
  const codes = new Map();
  for (const row of codeRows) {
    if (row?.gid === undefined || row.gid === null || codes.has(row.gid)) throw mismatch();
    codes.set(row.gid, row[REGION_CODE_ATTRIBUTE]);
  }
  return rows.map((row) => {
    if (!row || !codes.has(row.gid)) throw mismatch();
    return { ...row, [REGION_CODE_ATTRIBUTE]: codes.get(row.gid) };
  });
}
