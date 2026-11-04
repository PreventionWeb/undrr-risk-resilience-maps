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
 * - `iso3`, `region_name`, then one column per value attribute. A single value
 *   column is named from our layer config (the view's label); otherwise, or
 *   without a label, from the attribute name without its `jN_` prefix.
 * - `region_name` is `maplab`. `name_en` is not used: it holds the romanised
 *   local names joined with `#` (several languages in one cell), which is not a
 *   display name. A view without `maplab` takes names from `regionNames` (the
 *   caller reads them from another view on the same boundary table; see
 *   REGION_NAME_REFERENCE_VIEW), and a code missing there is left blank. No
 *   lookup table of names is kept in this repo.
 * - Dropped: `gid`; rows with no value; rows whose code is not a standard
 *   ISO 3166-1 alpha-3 code (three uppercase letters). The boundary table also
 *   holds a few areas with placeholder codes, and some views carry values for
 *   them; they are left out until UNEP/GRID-Geneva advise how to publish them.
 *
 * ## Format
 *
 * UTF-8 with a byte-order mark (so Excel reads the names correctly), CRLF line
 * ends and RFC 4180 quoting. A short metadata block from our config comes
 * first, as `# `-prefixed lines (title, citation, license, source, MapX view ID,
 * download date). We chose a header block over a sidecar file: one download,
 * and the attribution travels with the data. Data tools skip it with a comment
 * option (`pandas.read_csv(path, comment="#")`, `read.csv(path, comment.char = "#")`);
 * spreadsheets show it as the first rows.
 */

/** The region code column every region-level view carries. */
export const REGION_CODE_ATTRIBUTE = "iso3cd";
/** The UN map label column, when the view has one. */
export const REGION_NAME_ATTRIBUTE = "maplab";
/** Columns that are never values: the internal id and the unsuitable name column. */
const NON_VALUE_ATTRIBUTES = new Set([REGION_CODE_ATTRIBUTE, REGION_NAME_ATTRIBUTE, "name_en", "gid"]);

const BOM = "﻿";
const CRLF = "\r\n";

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

/** A standard ISO 3166-1 alpha-3 code: exactly three uppercase letters. */
export function isStandardIso3(code) {
  return typeof code === "string" && /^[A-Z]{3}$/.test(code);
}

/** `j0_crop_all_aal_wheat` → `crop_all_aal_wheat`. */
export function stripJoinPrefix(attribute) {
  return String(attribute).replace(/^j\d+_/, "");
}

/** MapX's empty values: null, missing, blank, and the vector-tile `$NULL`. */
function isEmptyValue(value) {
  return value === null || value === undefined || value === "" || value === "$NULL";
}

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * One RFC 4180 cell. Quoted when it holds a comma, quote, CR or LF (quotes
 * doubled). A text cell that a spreadsheet would run as a formula (starting
 * with = + - @, tab or CR, and not a number) gets a leading apostrophe.
 */
export function csvCell(value) {
  if (isEmptyValue(value)) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !NUMERIC.test(text.trim())) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
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
 * @param {{ layer: object, source?: object|null, viewId: string, date?: Date, viewerUrl?: string }} options
 * @returns {Array<[string, string]>}
 */
export function csvMetadata({ layer, source = null, viewId, date = new Date(), viewerUrl = "" }) {
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
    ["Downloaded", date.toISOString().slice(0, 10)],
    ["Downloaded from", viewerUrl],
    ["Region names", "UN map labels as published in MapX; blank where none is available."],
    [
      "Note",
      "Values only; region boundaries are not included. Rows with no value, and areas without a standard ISO 3166-1 alpha-3 code, are left out.",
    ],
  ];
}

/**
 * `iso3 → maplab` from a table that has `maplab`, for standard codes only.
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Map<string, string>}
 */
export function regionNamesFrom(rows) {
  const names = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = row?.[REGION_CODE_ATTRIBUTE];
    const name = row?.[REGION_NAME_ATTRIBUTE];
    if (isStandardIso3(code) && typeof name === "string" && name.trim() && !names.has(code))
      names.set(code, name);
  }
  return names;
}

/** Does the table carry its own `maplab` column? */
export function hasRegionNames(rows) {
  return Array.isArray(rows) && rows.some((row) => row && REGION_NAME_ATTRIBUTE in row);
}

/** Value columns: every attribute in the rows that is not a code, name or id, in first-seen order. */
function valueAttributes(rows) {
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) if (!NON_VALUE_ATTRIBUTES.has(key)) seen.add(key);
  }
  return [...seen];
}

/** Header names for the value columns; duplicates after prefix stripping keep the full name. */
function valueHeaders(attributes, valueLabel) {
  if (attributes.length === 1 && valueLabel) return [valueLabel];
  const stripped = attributes.map(stripJoinPrefix);
  return stripped.map((name, i) =>
    stripped.indexOf(name) !== stripped.lastIndexOf(name) ? attributes[i] : name,
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
 * @returns {{ csv: string, rowCount: number, droppedNoValue: number, droppedNonStandard: number, valueAttributes: string[] }}
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
  let droppedNonStandard = 0;
  const kept = [];
  for (const row of rows) {
    if (!row || attributes.every((attribute) => isEmptyValue(row[attribute]))) {
      droppedNoValue++;
      continue;
    }
    if (!isStandardIso3(row[REGION_CODE_ATTRIBUTE])) {
      droppedNonStandard++;
      continue;
    }
    kept.push(row);
  }
  const nameOf = (row) => row[REGION_NAME_ATTRIBUTE] ?? regionNames.get(row[REGION_CODE_ATTRIBUTE]) ?? "";
  kept.sort(
    (a, b) =>
      a[REGION_CODE_ATTRIBUTE].localeCompare(b[REGION_CODE_ATTRIBUTE]) ||
      String(nameOf(a)).localeCompare(String(nameOf(b))),
  );

  const lines = [
    // One line per field; a value's own line breaks would end the comment early.
    ...metadata
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(([label, value]) => `# ${label}: ${String(value).replace(/\s*[\r\n]+\s*/g, " ")}`),
    csvRow(["iso3", "region_name", ...valueHeaders(attributes, valueLabel)]),
    ...kept.map((row) =>
      csvRow([row[REGION_CODE_ATTRIBUTE], nameOf(row), ...attributes.map((attribute) => row[attribute])]),
    ),
  ];

  return {
    csv: BOM + lines.join(CRLF) + CRLF,
    rowCount: kept.length,
    droppedNoValue,
    droppedNonStandard,
    valueAttributes: attributes,
  };
}
