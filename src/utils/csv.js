/**
 * CSV writing shared by the layer inventory export (src/utils/export-layers.js)
 * and the values-only region CSV (src/utils/region-csv.js): RFC 4180 cells,
 * the UTF-8 byte-order mark and CRLF line ends Excel expects, and saving text
 * as a file from the browser.
 */

/** UTF-8 byte-order mark: Excel reads the file as UTF-8 only with it. */
export const BOM = "﻿";
export const CRLF = "\r\n";

const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * One RFC 4180 cell: quoted when it holds a comma, quote, CR or LF, with
 * quotes doubled. `null`, `undefined` and non-finite numbers are empty.
 *
 * With `defuse`, text a spreadsheet would run as a formula (starting with
 * = + - @, tab or CR, and not a number) gets a leading apostrophe. The
 * inventory export leaves it off: its cells are re-imported verbatim.
 *
 * @param {unknown} value
 * @param {{ defuse?: boolean }} [options]
 */
export function csvCell(value, { defuse = false } = {}) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (defuse && typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !NUMERIC.test(text.trim())) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line. */
export function csvRow(values, options) {
  return values.map((value) => csvCell(value, options)).join(",");
}

/** A whole file: BOM, CRLF-joined lines, and a final CRLF when `trailing`. */
export function csvText(lines, { trailing = true } = {}) {
  return BOM + lines.join(CRLF) + (trailing ? CRLF : "");
}

/** Save text as a file through a temporary link. */
export function saveTextFile(doc, text, filename, type = "text/csv;charset=utf-8") {
  const win = doc.defaultView ?? window;
  const blob = new win.Blob([text], { type });
  const url = win.URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked a moment later: some browsers start reading the blob after click().
  win.setTimeout(() => win.URL.revokeObjectURL(url), 10_000);
}
