#!/usr/bin/env node
/**
 * Import inventory CSV → layer config sync tool.
 *
 * Usage:
 *   node scripts/import-inventory.mjs              # dry-run: report only
 *   node scripts/import-inventory.mjs --input file.csv
 *   node scripts/import-inventory.mjs --apply      # sync supported inventory fields
 *
 * The canonical inventory CSV lives at data/inventory.csv and matches the
 * column structure of the master spreadsheet held by colleagues:
 *   https://unitednations-my.sharepoint.com/:x:/r/personal/william_herrerapenagos_un_org/...
 *
 * When colleagues send an updated CSV, replace data/inventory.csv then run:
 *   node scripts/import-inventory.mjs
 * Review the report, then run with --apply to sync MapX view IDs, display copy,
 * and supported statuses.
 * Rows whose layer keys appear in data/removed-layer-keys.txt are ignored, so
 * retired entries in an upstream spreadsheet cannot be reintroduced.
 *
 * What --apply changes:
 *   - mapxViewId   (id field on simple layers; id on each sub-source for compound)
 *   - label        (from Layer name)
 *   - desc         (from Description, including compound sub-sources)
 *   - Inventory status changes between disabled variants:
 *       "disabled-awaiting-data" ↔ "disabled-pending-removal"
 *
 * What --apply does NOT change (review manually):
 *   - Published ↔ disabled transitions (adding/removing the status field entirely)
 *   - source, citation, license, legend, widget, sourceUrl, geometry
 *   - external provider definitions (external rows intentionally have no MapX ID)
 * Optional Note and Explainer link columns are synced when supplied; omitting
 * either column preserves its configured values.
 *
 * Optional "Download URL" and "Download size (bytes)" columns (supplied as a
 * pair) carry the hosted files behind a view (GeoTIFFs from UNEP/GRID-Geneva).
 * Several files are separated by ";" in both cells, in the same order. They
 * are written to the view's config as `downloads: [[url, bytes], ...]` (an
 * array of tuples, so the config stays free of nested braces this script's
 * object matching relies on). Omitting both columns preserves configured files;
 * an empty pair removes them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;
if (inputIndex >= 0 && !inputPath) throw new Error("--input requires a CSV path");
const CSV_PATH = inputPath ? resolve(process.cwd(), inputPath) : resolve(ROOT, "data/inventory.csv");
const REMOVED_KEYS_PATH = resolve(ROOT, "data/removed-layer-keys.txt");

const APPLY = process.argv.includes("--apply");

const removedKeys = new Set(
  readFileSync(REMOVED_KEYS_PATH, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = [];
  let cells = [],
    cur = "",
    inQuote = false;
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (inQuote && input[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cells.push(cur);
      cur = "";
    } else if (ch === "\n" && !inQuote) {
      cells.push(cur);
      if (cells.some((cell) => cell.trim())) rows.push(cells);
      cells = [];
      cur = "";
    } else cur += ch;
  }
  if (inQuote) throw new Error("Inventory CSV has an unterminated quoted field");
  cells.push(cur);
  if (cells.some((cell) => cell.trim())) rows.push(cells);
  return rows;
}

// ── Load CSV ──────────────────────────────────────────────────────────────────

const csvText = readFileSync(CSV_PATH, "utf-8").replace(/^\uFEFF/, "");
const [headerRow, ...dataRows] = parseCSV(csvText);

const REQUIRED_HEADERS = [
  "Variable R-R Initiative",
  "Category",
  "R2R category",
  "R&R Step",
  "Layer key",
  "Layer name",
  "Sub-source",
  "Type",
  "Description",
  "MapX view ID",
  "Source",
  "Citation",
  "License",
  "Inventory status",
];
const providedHeaders = new Set((headerRow || []).map((header) => header.trim()));
const missingHeaders = REQUIRED_HEADERS.filter((header) => !providedHeaders.has(header));
if (missingHeaders.length) {
  throw new Error(`Inventory CSV missing required header(s): ${missingHeaders.join(", ")}`);
}

const H = {};
headerRow.forEach((h, i) => (H[h.trim()] = i));

const DOWNLOAD_URL_HEADER = "Download URL";
const DOWNLOAD_SIZE_HEADER = "Download size (bytes)";
if ((H[DOWNLOAD_URL_HEADER] === undefined) !== (H[DOWNLOAD_SIZE_HEADER] === undefined)) {
  throw new Error(
    `Inventory CSV must supply "${DOWNLOAD_URL_HEADER}" and "${DOWNLOAD_SIZE_HEADER}" together`,
  );
}
const HAS_DOWNLOAD_COLUMNS = H[DOWNLOAD_URL_HEADER] !== undefined;

/**
 * The hosted files for one row: `[[url, bytes], ...]`, `[]` for none, or
 * undefined when the CSV has no download columns (configured files are kept).
 */
function parseDownloads(row, context) {
  if (!HAS_DOWNLOAD_COLUMNS) return undefined;
  const split = (value) =>
    (value || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
  const urls = split(row[H[DOWNLOAD_URL_HEADER]]);
  const sizes = split(row[H[DOWNLOAD_SIZE_HEADER]]);
  if (urls.length !== sizes.length) {
    throw new Error(`${context}: ${urls.length} download URL(s) but ${sizes.length} size(s)`);
  }
  return urls.map((url, i) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`${context}: download URL "${url}" is not a URL`);
    }
    if (parsed.protocol !== "https:") throw new Error(`${context}: download URL "${url}" must use https`);
    if (!/^[1-9]\d*$/.test(sizes[i])) {
      throw new Error(`${context}: download size "${sizes[i]}" must be a whole number of bytes`);
    }
    return [parsed.href, Number(sizes[i])];
  });
}

// Build inventory index: key → { subSource → [rows] }.
// A sub-source label is not necessarily unique: recovery-speed, for example,
// repeats each hazard for the poorest and richest household groups.
const inventory = new Map();
const ignoredRemovedRows = [];

for (const r of dataRows) {
  const key = (r[H["Layer key"]] || "").trim();
  const subSource = (r[H["Sub-source"]] || "").trim();
  const mapxId = (r[H["MapX view ID"]] || "").trim();
  const status = (r[H["Inventory status"]] || "").trim();
  const layerName = (r[H["Layer name"]] || "").trim();
  const initiative = (r[H["Variable R-R Initiative"]] || "").trim();
  const r2rCat = (r[H["R2R category"]] || "").trim();
  const rrStep = (r[H["R&R Step"]] || "").trim();

  if (!key) continue;
  if (removedKeys.has(key)) {
    ignoredRemovedRows.push({ key, layerName, subSource });
    continue;
  }

  if (!inventory.has(key)) inventory.set(key, new Map());
  const subMap = inventory.get(key);
  if (!subMap.has(subSource)) subMap.set(subSource, []);
  const desc = (r[H["Description"]] || "").trim();
  const note = H["Note"] === undefined ? undefined : (r[H["Note"]] || "").trim();
  const explainerUrl = H["Explainer link"] === undefined ? undefined : (r[H["Explainer link"]] || "").trim();
  const downloads = parseDownloads(r, `Inventory row "${key}"${subSource ? ` / "${subSource}"` : ""}`);
  subMap
    .get(subSource)
    .push({ mapxId, status, layerName, desc, initiative, r2rCat, rrStep, note, explainerUrl, downloads });
}

// ── Load JS layer config (static import via dynamic require-like read) ────────

// We need to discover all keys+subSources that exist in the JS config.
// Rather than executing the JS, we parse it textually — good enough for
// extracting key strings and MapX IDs.

const CONFIG_FILES = [
  "src/config/layers/hazard.js",
  "src/config/layers/risk.js",
  "src/config/layers/resilience.js",
  "src/config/layers/exposure.js",
  "src/config/layers/vulnerability.js",
  "src/config/layers/gar.js",
];

// Extract all { key, subSource } combinations from JS source text.
// Returns array of { key, subSource, currentId, currentStatus, file }
//
// Each layer object has `id:` BEFORE `key:`, so for simple layers we search
// backward from the `key:` position to find the enclosing object's `id:`.
function extractLayerEntries(src, file) {
  const entries = [];
  const keyRe = /key:\s*["']([^"']+)["']/g;
  let km;
  while ((km = keyRe.exec(src)) !== null) {
    const key = km[1];
    const keyIdx = km.index;

    // Look ahead for a sources: array (compound layer)
    const rest = src.slice(keyIdx);
    const nextLayerIdx = rest.indexOf("\n  {", 10);
    const forwardBlock = nextLayerIdx > 0 ? rest.slice(0, nextLayerIdx) : rest.slice(0, 3000);

    const sourcesMatch = /sources:\s*\[/.exec(forwardBlock);
    const layerLabelMatch = /label:\s*"((?:\\.|[^"\\])*)"/.exec(forwardBlock);
    const currentLayerLabel = layerLabelMatch ? decodeJsString(layerLabelMatch[1]) : "";
    if (sourcesMatch) {
      // Compound layer — extract sub-source labels and IDs from the sources array
      const sourcesBlock = forwardBlock.slice(sourcesMatch.index);
      const subRe2 = /\{[^}]*?id:\s*(null|["'][^"']*["'])[^}]*?label:\s*["']([^"']+)["'][^}]*\}/g;
      let sm;
      while ((sm = subRe2.exec(sourcesBlock)) !== null) {
        const rawId = sm[1].trim();
        const currentId = rawId === "null" ? "" : rawId.replace(/["']/g, "");
        const descMatch = /desc:\s*"((?:\\.|[^"\\])*)"/.exec(sm[0]);
        entries.push({
          key,
          subSource: sm[2],
          currentId,
          currentStatus: "",
          currentLayerLabel,
          currentDesc: descMatch ? decodeJsString(descMatch[1]) : "",
          ...extractOptionalMetadata(forwardBlock.slice(0, sourcesMatch.index), src),
          ...extractOptionalMetadata(sm[0], src),
          currentDownloads: readDownloads(sm[0]),
          file,
        });
      }
    } else {
      // Simple layer — id: appears BEFORE key: in the object, so search backward.
      // Find the opening brace of this object (last "  {" before key:).
      const before = src.slice(0, keyIdx);
      const objStart = before.lastIndexOf("  {\n");
      const objSrc = objStart >= 0 ? before.slice(objStart) : before.slice(-400);

      const idMatch = /id:\s*(null|["'][^"']*["'])/.exec(objSrc);
      const currentId = idMatch ? (idMatch[1] === "null" ? "" : idMatch[1].replace(/["']/g, "")) : "";

      // Also capture current status for status-change detection
      const statusMatch = /status:\s*(?:["']([^"']+)["']|([A-Z_]+))/.exec(objSrc + forwardBlock);
      const statusConstants = {
        AWAITING: "disabled-awaiting-data",
        PENDING_REMOVAL: "disabled-pending-removal",
      };
      const currentStatus = statusMatch
        ? statusMatch[1] || statusConstants[statusMatch[2]] || statusMatch[2]
        : "published";

      const descMatch = /desc:\s*"((?:\\.|[^"\\])*)"/.exec(objSrc + forwardBlock);
      entries.push({
        key,
        subSource: "",
        currentId,
        currentStatus,
        currentLayerLabel,
        currentDesc: descMatch ? decodeJsString(descMatch[1]) : "",
        ...extractOptionalMetadata(forwardBlock, src),
        currentDownloads: readDownloads(forwardBlock),
        file,
      });
    }
  }
  return entries;
}

function extractOptionalMetadata(block, src) {
  const result = {};
  for (const field of ["note", "explainerUrl"]) {
    const match = new RegExp(`${field}:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([A-Z_]+))`).exec(block);
    if (!match) continue;
    const constant = match[2] && new RegExp(`const ${match[2]}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(src);
    result[field] = decodeJsString(match[1] ?? constant?.[1] ?? "");
  }
  return result;
}

/**
 * Find a `downloads: [...]` array literal in a block of config source: its
 * start and end offsets and parsed value. Brackets are matched (strings
 * skipped), so a literal Prettier wrapped over several lines is read too.
 */
function findDownloadsLiteral(block) {
  const match = /downloads:\s*\[/.exec(block);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < block.length; i++) {
    const ch = block[i];
    if (ch === '"') {
      for (i++; i < block.length && block[i] !== '"'; i++) if (block[i] === "\\") i++;
    } else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) {
      const literal = block.slice(open, i + 1).replace(/,(\s*\])/g, "$1");
      return { start: match.index, end: i + 1, value: JSON.parse(literal) };
    }
  }
  throw new Error("Unterminated downloads array in layer config");
}

function readDownloads(block) {
  return findDownloadsLiteral(block)?.value ?? [];
}

const jsEntries = [];
const fileSources = {};
for (const relPath of CONFIG_FILES) {
  const absPath = resolve(ROOT, relPath);
  const src = readFileSync(absPath, "utf-8");
  fileSources[relPath] = src;
  jsEntries.push(...extractLayerEntries(src, relPath));
}

// ── Status mapping ────────────────────────────────────────────────────────────

function csvStatusToJs(csvStatus) {
  switch ((csvStatus || "").trim()) {
    case "Uploaded":
    case "External runtime":
    case "done":
      return "published";
    case "Pending removal":
      return "disabled-pending-removal";
    default:
      // "In development", "Forthcoming", "Data needs reprocess", etc.
      return csvStatus ? "disabled-awaiting-data" : "published";
  }
}

// ── Reconcile ─────────────────────────────────────────────────────────────────

const matched = [];
const onlyInJS = [];
const onlyInCSV = [];
const idChanges = [];
const statusChanges = [];
const labelChanges = new Map();
const descChanges = [];
const metadataChanges = [];
const downloadChanges = [];

// Track which CSV entries were matched
const csvMatched = new Map();

for (const entry of jsEntries) {
  const csvLayer = inventory.get(entry.key);
  if (!csvLayer) {
    onlyInJS.push(entry);
    continue;
  }

  let matchedSubSource = entry.subSource;
  let csvEntries = csvLayer.get(matchedSubSource);
  // A simple layer may gain a descriptive sub-source in a colleague export.
  // It remains unambiguous when that layer key has exactly one CSV row.
  if (!entry.subSource && !csvEntries && csvLayer.size === 1) {
    [matchedSubSource, csvEntries] = csvLayer.entries().next().value;
  }
  const occurrenceKey = `${entry.key}|${matchedSubSource}`;
  const occurrence = csvMatched.get(occurrenceKey) || 0;
  const csvEntry = csvEntries?.[occurrence];
  if (!csvEntry) {
    onlyInJS.push(entry);
    continue;
  }

  csvMatched.set(occurrenceKey, occurrence + 1);
  matched.push({ ...entry, csvEntry });

  for (const field of ["note", "explainerUrl"]) {
    if (csvEntry[field] !== undefined && csvEntry[field] !== (entry[field] ?? "")) {
      metadataChanges.push({ ...entry, field, value: csvEntry[field] });
    }
  }

  if (csvEntry.downloads !== undefined && !sameDownloads(csvEntry.downloads, entry.currentDownloads)) {
    downloadChanges.push({ ...entry, downloads: csvEntry.downloads });
  }

  // Check for MapX ID change
  const csvId = csvEntry.mapxId.startsWith("MX-") ? csvEntry.mapxId : "";
  if (csvId && csvId !== entry.currentId) {
    idChanges.push({ ...entry, newId: csvId, oldId: entry.currentId });
  }

  if (csvEntry.layerName && csvEntry.layerName !== entry.currentLayerLabel) {
    const existing = labelChanges.get(entry.key);
    if (existing && existing.newLabel !== csvEntry.layerName) {
      throw new Error(`Conflicting Layer name values for "${entry.key}" in inventory CSV`);
    }
    labelChanges.set(entry.key, {
      ...entry,
      oldLabel: entry.currentLayerLabel,
      newLabel: csvEntry.layerName,
    });
  }

  if (csvEntry.desc && csvEntry.desc !== entry.currentDesc) {
    descChanges.push({ ...entry, oldDesc: entry.currentDesc, newDesc: csvEntry.desc });
  }

  // Check for status change (simple layers only; sub-sources don't carry status)
  if (!entry.subSource) {
    const newStatus = csvStatusToJs(csvEntry.status);
    if (newStatus !== entry.currentStatus) {
      statusChanges.push({ ...entry, oldStatus: entry.currentStatus, newStatus, csvStatus: csvEntry.status });
    }
  }
}

// Find CSV-only entries
for (const [key, subMap] of inventory) {
  for (const [subSource, csvEntries] of subMap) {
    const matchKey = `${key}|${subSource}`;
    const matchedCount = csvMatched.get(matchKey) || 0;
    for (const csvEntry of csvEntries.slice(matchedCount)) {
      onlyInCSV.push({ key, subSource, csvEntry });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log("\n=== Layer Inventory Sync Report ===\n");
console.log(`Input:       ${CSV_PATH}`);
console.log(
  `CSV rows:    ${[...inventory.values()].reduce(
    (n, m) => n + [...m.values()].reduce((sum, rows) => sum + rows.length, 0),
    0,
  )}`,
);
console.log(`JS entries:  ${jsEntries.length}`);
console.log(`Matched:     ${matched.length}`);

if (ignoredRemovedRows.length) {
  const ignoredKeys = [...new Set(ignoredRemovedRows.map((row) => row.key))];
  console.log(
    `Ignored:     ${ignoredRemovedRows.length} retired row(s) across ${ignoredKeys.length} layer key(s): ${ignoredKeys.join(", ")}`,
  );
}

if (idChanges.length) {
  console.log(`\n── MapX ID updates (${idChanges.length}) ──`);
  for (const c of idChanges) {
    const sub = c.subSource ? ` [${c.subSource}]` : "";
    console.log(`  ${c.key}${sub}`);
    console.log(`    old: ${c.oldId || "(null)"}`);
    console.log(`    new: ${c.newId}`);
    console.log(`    file: ${c.file}`);
  }
} else {
  console.log("\n── No MapX ID changes detected ──");
}

if (labelChanges.size) {
  console.log(`\n── Layer name updates (${labelChanges.size}) ──`);
  for (const change of labelChanges.values()) {
    console.log(`  ${change.key}: "${change.oldLabel}" → "${change.newLabel}"`);
  }
}

if (descChanges.length) {
  console.log(`\n── Description updates (${descChanges.length}) ──`);
  for (const change of descChanges) {
    const sub = change.subSource ? ` [${change.subSource}]` : "";
    console.log(`  ${change.key}${sub}`);
  }
}

if (onlyInJS.length) {
  console.log(`\n── In JS config but NOT in CSV (${onlyInJS.length}) ──`);
  for (const e of onlyInJS) {
    const sub = e.subSource ? ` / "${e.subSource}"` : "";
    console.log(`  ${e.key}${sub}  (${e.file})`);
  }
}

if (statusChanges.length) {
  console.log(`\n── Status changes (${statusChanges.length}) ──`);
  for (const c of statusChanges) {
    const applyable = c.oldStatus !== "published" && c.newStatus !== "published";
    console.log(`  ${c.key}`);
    console.log(`    old: ${c.oldStatus}  →  new: ${c.newStatus}  (CSV: "${c.csvStatus}")`);
    if (!applyable) console.log(`    ⚠  Requires manual edit (published ↔ disabled transition)`);
  }
}

if (onlyInCSV.length) {
  console.log(`\n── In CSV but NOT in JS config (${onlyInCSV.length}) ──`);
  for (const e of onlyInCSV) {
    const sub = e.subSource ? ` / "${e.subSource}"` : "";
    console.log(`  ${e.key}${sub}`);
  }
}

if (metadataChanges.length) {
  console.log(`\nNotes / explainer link changes: ${metadataChanges.length}`);
  for (const change of metadataChanges) {
    console.log(`  ${change.key}${change.subSource ? ` / ${change.subSource}` : ""}: ${change.field}`);
    console.log(`    ${JSON.stringify(change[change.field] ?? "")} → ${JSON.stringify(change.value)}`);
  }
}

if (downloadChanges.length) {
  console.log(`\n── Download file updates (${downloadChanges.length}) ──`);
  for (const change of downloadChanges) {
    const sub = change.subSource ? ` [${change.subSource}]` : "";
    const files = change.downloads.map(([url, bytes]) => `${url} (${bytes} bytes)`).join(", ") || "(none)";
    console.log(`  ${change.key}${sub}: ${files}`);
  }
}

if (!APPLY) {
  console.log("\nDry-run complete. Pass --apply to sync supported inventory fields to JS files.\n");
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────────

const applyableStatusChanges = statusChanges.filter(
  (change) => change.oldStatus !== "published" && change.newStatus !== "published",
);

if (
  idChanges.length === 0 &&
  labelChanges.size === 0 &&
  descChanges.length === 0 &&
  metadataChanges.length === 0 &&
  downloadChanges.length === 0 &&
  applyableStatusChanges.length === 0
) {
  console.log("\n--apply: nothing to change.\n");
  process.exit(0);
}

console.log("\n--apply: writing changes...");

// Group changes by file
const changesByFile = {};
for (const change of idChanges) {
  (changesByFile[change.file] ??= []).push(change);
}
for (const change of labelChanges.values()) {
  changesByFile[change.file] ??= [];
}
for (const change of descChanges) {
  changesByFile[change.file] ??= [];
}
for (const change of metadataChanges) changesByFile[change.file] ??= [];
for (const change of downloadChanges) changesByFile[change.file] ??= [];
for (const change of applyableStatusChanges) {
  changesByFile[change.file] ??= [];
}

for (const [relPath, changes] of Object.entries(changesByFile)) {
  let src = fileSources[relPath];
  let modified = false;

  for (const c of changes) {
    if (!c.newId) continue;

    if (c.currentId) {
      // Existing IDs are globally unique by config contract, making the old
      // ID the safest target when spreadsheet labels are repeated.
      const re = new RegExp(`(id:\\s*)"${escapeRe(c.currentId)}"`);
      const replaced = src.replace(re, `$1"${c.newId}"`);
      if (replaced !== src) {
        src = replaced;
        modified = true;
      }
    } else if (c.subSource) {
      // New compound IDs are scoped to their layer block. Source labels match
      // the inventory Sub-source values and must be unique within a layer.
      const result = replaceInLayerBlock(src, c.key, (block) =>
        block.replace(
          new RegExp(`(id:\\s*)null((?:[^}](?!label))*?label:\\s*"${escapeRe(c.subSource)}")`),
          `$1"${c.newId}"$2`,
        ),
      );
      src = result.src;
      modified ||= result.modified;
    } else {
      const result = replaceInLayerBlock(src, c.key, (block) =>
        block.replace(/(id:\s*)null/, `$1"${c.newId}"`),
      );
      src = result.src;
      modified ||= result.modified;
    }
  }

  for (const c of labelChanges.values()) {
    if (c.file !== relPath) continue;
    const result = replaceInLayerBlock(src, c.key, (block) =>
      block.replace(/(\n\s+label:\s*)"(?:\\.|[^"\\])*"/, `$1${JSON.stringify(c.newLabel)}`),
    );
    src = result.src;
    modified ||= result.modified;
  }

  for (const c of descChanges) {
    if (c.file !== relPath) continue;
    const result = replaceInLayerBlock(src, c.key, (block) => {
      if (!c.subSource) {
        const replaced = block.replace(/(\n\s+desc:\s*)"(?:\\.|[^"\\])*"/, `$1${JSON.stringify(c.newDesc)}`);
        return replaced !== block
          ? replaced
          : block.replace(/(\n\s+type:\s*"[^"]+",)/, `$1\n    desc: ${JSON.stringify(c.newDesc)},`);
      }
      const sourcePattern = new RegExp(
        `(\\{[^}]*?label:\\s*"${escapeRe(c.subSource)}"[^}]*?desc:\\s*)"(?:\\\\.|[^"\\\\])*"`,
      );
      const replaced = block.replace(sourcePattern, `$1${JSON.stringify(c.newDesc)}`);
      if (replaced !== block) return replaced;
      const sourceWithoutDesc = new RegExp(`(\\{[^}]*?label:\\s*"${escapeRe(c.subSource)}"[^}]*?)(\\s*\\})`);
      return block.replace(sourceWithoutDesc, `$1, desc: ${JSON.stringify(c.newDesc)}$2`);
    });
    src = result.src;
    modified ||= result.modified;
  }

  // Apply status changes (disabled ↔ disabled transitions only)
  for (const change of metadataChanges.filter((change) => change.file === relPath)) {
    const result = replaceInLayerBlock(src, change.key, (block) => {
      const patch = (object) => {
        const fieldPattern = new RegExp(`(${change.field}:\\s*)(?:"(?:\\\\.|[^"\\\\])*"|[A-Z_]+)`);
        if (fieldPattern.test(object))
          return object.replace(fieldPattern, (_match, prefix) => prefix + JSON.stringify(change.value));
        return object.replace(
          /(label:\s*"(?:\\.|[^"\\])*",)/,
          (_match, label) => `${label}\n        ${change.field}: ${JSON.stringify(change.value)},`,
        );
      };
      if (!change.subSource) return patch(block);
      // [^{}]: a first source's label must not match from the layer's own brace.
      const source = new RegExp(`\\{[^{}]*?label:\\s*"${escapeRe(change.subSource)}"[^{}]*\\}`);
      return block.replace(source, patch);
    });
    src = result.src;
    modified ||= result.modified;
  }

  for (const change of downloadChanges.filter((change) => change.file === relPath)) {
    const result = replaceInLayerBlock(src, change.key, (block) => {
      const patch = (object) => {
        const existing = findDownloadsLiteral(object);
        const literal = `downloads: ${formatDownloads(change.downloads)}`;
        if (existing) {
          if (change.downloads.length) {
            return object.slice(0, existing.start) + literal + object.slice(existing.end);
          }
          // Remove the field with its trailing comma and line.
          const after = object.slice(existing.end).replace(/^,?[ \t]*\n?[ \t]*/, "");
          return object.slice(0, existing.start) + after;
        }
        if (!change.downloads.length) return object;
        return object.replace(
          /(label:\s*"(?:\\.|[^"\\])*",)/,
          (_match, label) => `${label}\n        ${literal},`,
        );
      };
      if (!change.subSource) return patch(block);
      // Sub-source labels can repeat within a layer (recovery-speed), view ids
      // cannot: find the source object by its id, by its label only without one.
      // [^{}] keeps a first source from matching from the layer's own brace.
      const source = change.currentId
        ? new RegExp(`\\{[^{}]*?id:\\s*"${escapeRe(change.currentId)}"[^{}]*\\}`)
        : new RegExp(`\\{[^{}]*?label:\\s*"${escapeRe(change.subSource)}"[^{}]*\\}`);
      return block.replace(source, patch);
    });
    src = result.src;
    modified ||= result.modified;
  }

  const fileStatusChanges = (statusChanges || []).filter(
    (c) => c.file === relPath && c.oldStatus !== "published" && c.newStatus !== "published",
  );
  for (const c of fileStatusChanges) {
    const result = replaceInLayerBlock(src, c.key, (block) =>
      block.replace(/status:\s*(?:["'][^"']+["']|[A-Z_]+)/, `status: "${c.newStatus}"`),
    );
    src = result.src;
    modified ||= result.modified;
  }

  if (modified) {
    const absPath = resolve(ROOT, relPath);
    writeFileSync(absPath, src, "utf-8");
    console.log(`  Updated: ${relPath}`);
  }
}

console.log("\nDone. Review the changes with: git diff src/config/layers/\n");

function sameDownloads(a, b) {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function formatDownloads(downloads) {
  return `[${downloads.map(([url, bytes]) => `[${JSON.stringify(url)}, ${bytes}]`).join(", ")}]`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeJsString(value) {
  return JSON.parse(`"${value}"`);
}

function replaceInLayerBlock(src, key, transform) {
  const keyMatch = new RegExp(`key:\\s*"${escapeRe(key)}"`).exec(src);
  if (!keyMatch) return { src, modified: false };

  const start = src.lastIndexOf("  {\n", keyMatch.index);
  if (start < 0) return { src, modified: false };

  const next = src.indexOf("\n  {", keyMatch.index);
  const end = next < 0 ? src.lastIndexOf("\n];") : next;
  if (end < 0) return { src, modified: false };

  const block = src.slice(start, end);
  const replaced = transform(block);
  if (replaced === block) return { src, modified: false };
  return { src: src.slice(0, start) + replaced + src.slice(end), modified: true };
}
