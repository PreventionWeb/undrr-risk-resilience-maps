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
 * an empty pair removes them (see "Removals" below).
 *
 * Optional "CSV download" column: whether a view is offered as a values-only
 * CSV. `yes`, `no: <reason>`, or blank (not reviewed, so no CSV). It is
 * written to the view's config as `csvDownload` (the layer for a simple
 * layer, the source for a compound one). Mark a view `yes` only after
 * `yarn test:downloads-contract` passes for it.
 *
 * Removals: an apply that would remove a view's hosted files or turn a `yes`
 * CSV off stops and lists them, unless `--allow-removals` is passed. A
 * spreadsheet that kept the columns but lost their values would otherwise
 * silently clear every download.
 *
 * Re-vetting: a view marked `yes` whose MapX view id changes stops the apply
 * too, unless `--csv-vetted` is passed after running
 * `yarn test:downloads-contract --view <new id>`: a CSV is offered only for a
 * view someone has checked. `yes` on a layer that is not `type: "vt"` in the
 * config is an error.
 *
 * Every planned change must land: if a patch matches nothing in the config
 * (a lost update), nothing is written and the apply fails.
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
const ALLOW_REMOVALS = process.argv.includes("--allow-removals");
const CSV_VETTED = process.argv.includes("--csv-vetted");

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

const CSV_DOWNLOAD_HEADER = "CSV download";

/** A row's CSV decision: "yes", "no: <reason>", "" (not reviewed), or undefined without the column. */
function parseCsvDownload(row, context) {
  if (H[CSV_DOWNLOAD_HEADER] === undefined) return undefined;
  const value = (row[H[CSV_DOWNLOAD_HEADER]] || "").trim();
  if (value === "" || value === "yes") return value;
  const no = /^no\s*:\s*(\S.*)$/i.exec(value);
  if (no) return `no: ${no[1].trim()}`;
  throw new Error(
    `${context}: "${CSV_DOWNLOAD_HEADER}" must be yes, "no: <reason>" or blank (got "${value}")`,
  );
}

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
  const rowContext = `Inventory row "${key}"${subSource ? ` / "${subSource}"` : ""}`;
  const downloads = parseDownloads(r, rowContext);
  const csvDownload = parseCsvDownload(r, rowContext);
  subMap.get(subSource).push({
    mapxId,
    status,
    layerName,
    desc,
    initiative,
    r2rCat,
    rrStep,
    note,
    explainerUrl,
    csvDownload,
    downloads,
  });
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
          layerType: /type:\s*"(\w+)"/.exec(forwardBlock.slice(0, sourcesMatch.index))?.[1] ?? "",
          currentId,
          currentStatus: "",
          currentLayerLabel,
          currentDesc: descMatch ? decodeJsString(descMatch[1]) : "",
          ...extractOptionalMetadata(forwardBlock.slice(0, sourcesMatch.index), src),
          ...extractOptionalMetadata(sm[0], src),
          csvDownload: extractOptionalMetadata(sm[0], src, ["csvDownload"]).csvDownload,
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
        layerType: /type:\s*"(\w+)"/.exec(objSrc + forwardBlock)?.[1] ?? "",
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

function extractOptionalMetadata(block, src, fields = ["note", "explainerUrl", "csvDownload"]) {
  const result = {};
  for (const field of fields) {
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
const csvTypeErrors = [];
const revets = [];

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

  // The view id the config will carry after this import: field patches on a
  // compound source find the source by it, because the id swap runs first.
  const csvId = csvEntry.mapxId.startsWith("MX-") ? csvEntry.mapxId : "";
  const idChanged = Boolean(csvId && csvId !== entry.currentId);
  const matchId = idChanged ? csvId : entry.currentId;

  for (const field of ["note", "explainerUrl", "csvDownload"]) {
    if (csvEntry[field] !== undefined && csvEntry[field] !== (entry[field] ?? "")) {
      metadataChanges.push({ ...entry, matchId, field, value: csvEntry[field] });
    }
  }

  const csvDecision = csvEntry.csvDownload ?? entry.csvDownload ?? "";
  if (csvDecision === "yes" && entry.layerType !== "vt") {
    const sub = entry.subSource ? ` / "${entry.subSource}"` : "";
    csvTypeErrors.push(
      `  ${entry.key}${sub}: CSV download is "yes" but the layer is type "${entry.layerType || "?"}" in ${entry.file}; only vector (vt) views can have a CSV`,
    );
  }

  if (csvEntry.downloads !== undefined && !sameDownloads(csvEntry.downloads, entry.currentDownloads)) {
    downloadChanges.push({ ...entry, matchId, downloads: csvEntry.downloads });
  }

  // Check for MapX ID change
  if (idChanged) {
    idChanges.push({ ...entry, newId: csvId, oldId: entry.currentId });
    // A CSV must be re-vetted against the new view before it is offered.
    if (csvDecision === "yes") revets.push({ ...entry, newId: csvId });
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

if (csvTypeErrors.length) {
  throw new Error(`Inventory CSV marks a non-vector view for CSV download:\n${csvTypeErrors.join("\n")}`);
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
  console.log(`\nNotes / explainer link / CSV download changes: ${metadataChanges.length}`);
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

// Removals: a view left with fewer hosted files, or a "yes" CSV turned off.
const removals = [
  ...downloadChanges
    // Fewer files than configured. A replaced URL (GRID swapping a file) is not a removal.
    .filter((change) => change.downloads.length < (change.currentDownloads ?? []).length)
    .map((change) => ({
      ...change,
      what: `hosted files ${change.currentDownloads.length} → ${change.downloads.length}`,
    })),
  ...metadataChanges
    .filter(
      (change) => change.field === "csvDownload" && change.csvDownload === "yes" && change.value !== "yes",
    )
    .map((change) => ({ ...change, what: `CSV download "yes" → "${change.value || "(blank)"}"` })),
];
if (removals.length) {
  console.log(`\n── ⚠  Removals (${removals.length}) ──`);
  for (const change of removals) {
    const sub = change.subSource ? ` [${change.subSource}]` : "";
    console.log(`  ${change.key}${sub}: ${change.what}`);
  }
  console.log(
    "  A spreadsheet that kept the download columns but lost their values clears every download.\n" +
      "  If these removals are intended, apply with --allow-removals.",
  );
}

if (revets.length) {
  console.log(`\n── ⚠  CSV views with a new MapX view id: re-vet before applying (${revets.length}) ──`);
  for (const change of revets) {
    const sub = change.subSource ? ` [${change.subSource}]` : "";
    console.log(`  ${change.key}${sub}: ${change.currentId || "(none)"} → ${change.newId}`);
  }
  console.log(
    `  Run: yarn test:downloads-contract --skip-files ${revets.map((c) => `--view ${c.newId}`).join(" ")}\n` +
      '  If it passes, apply with --csv-vetted. Otherwise set "CSV download" to blank or "no: <reason>" first.',
  );
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

if (removals.length && !ALLOW_REMOVALS) {
  console.error(
    `\n--apply refused: ${removals.length} removal(s) listed above. Re-run with --allow-removals if they are intended.\n`,
  );
  process.exit(1);
}

if (revets.length && !CSV_VETTED) {
  console.error(
    `\n--apply refused: ${revets.length} CSV view(s) changed MapX view id (listed above). Vet them, then re-run with --csv-vetted.\n`,
  );
  process.exit(1);
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

// A planned change whose patch matched nothing in the config is a lost update:
// nothing is written then, and the apply fails.
const unapplied = [];
const outputs = new Map();
const describe = (c, what) => `${c.key}${c.subSource ? ` [${c.subSource}]` : ""}: ${what}`;
function landed(result, c, what) {
  if (!result.modified) unapplied.push(describe(c, what));
  return result;
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
      } else unapplied.push(describe(c, `view id ${c.currentId} → ${c.newId}`));
    } else if (c.subSource) {
      // New compound IDs are scoped to their layer block. Source labels match
      // the inventory Sub-source values and must be unique within a layer.
      const result = landed(
        replaceInLayerBlock(src, c.key, (block) =>
          block.replace(
            new RegExp(`(id:\\s*)null((?:[^}](?!label))*?label:\\s*"${escapeRe(c.subSource)}")`),
            `$1"${c.newId}"$2`,
          ),
        ),
        c,
        `view id → ${c.newId}`,
      );
      src = result.src;
      modified ||= result.modified;
    } else {
      const result = landed(
        replaceInLayerBlock(src, c.key, (block) => block.replace(/(id:\s*)null/, `$1"${c.newId}"`)),
        c,
        `view id → ${c.newId}`,
      );
      src = result.src;
      modified ||= result.modified;
    }
  }

  for (const c of labelChanges.values()) {
    if (c.file !== relPath) continue;
    const result = landed(
      replaceInLayerBlock(src, c.key, (block) =>
        block.replace(/(\n\s+label:\s*)"(?:\\.|[^"\\])*"/, `$1${JSON.stringify(c.newLabel)}`),
      ),
      c,
      "layer name",
    );
    src = result.src;
    modified ||= result.modified;
  }

  for (const c of descChanges) {
    if (c.file !== relPath) continue;
    const result = landed(
      replaceInLayerBlock(src, c.key, (block) => {
        if (!c.subSource) {
          const replaced = block.replace(
            /(\n\s+desc:\s*)"(?:\\.|[^"\\])*"/,
            `$1${JSON.stringify(c.newDesc)}`,
          );
          return replaced !== block
            ? replaced
            : block.replace(/(\n\s+type:\s*"[^"]+",)/, `$1\n    desc: ${JSON.stringify(c.newDesc)},`);
        }
        const sourcePattern = new RegExp(
          `(\\{[^}]*?label:\\s*"${escapeRe(c.subSource)}"[^}]*?desc:\\s*)"(?:\\\\.|[^"\\\\])*"`,
        );
        const replaced = block.replace(sourcePattern, `$1${JSON.stringify(c.newDesc)}`);
        if (replaced !== block) return replaced;
        const sourceWithoutDesc = new RegExp(
          `(\\{[^}]*?label:\\s*"${escapeRe(c.subSource)}"[^}]*?)(\\s*\\})`,
        );
        return block.replace(sourceWithoutDesc, `$1, desc: ${JSON.stringify(c.newDesc)}$2`);
      }),
      c,
      "description",
    );
    src = result.src;
    modified ||= result.modified;
  }

  // Apply status changes (disabled ↔ disabled transitions only)
  for (const change of metadataChanges.filter((change) => change.file === relPath)) {
    const result = landed(
      replaceInLayerBlock(src, change.key, (block) => {
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
        // By view id when the source has one (labels can repeat within a
        // layer); [^{}] keeps a first source from matching from the layer's brace.
        const source = change.matchId
          ? new RegExp(`\\{[^{}]*?id:\\s*"${escapeRe(change.matchId)}"[^{}]*\\}`)
          : new RegExp(`\\{[^{}]*?label:\\s*"${escapeRe(change.subSource)}"[^{}]*\\}`);
        return block.replace(source, patch);
      }),
      change,
      change.field,
    );
    src = result.src;
    modified ||= result.modified;
  }

  for (const change of downloadChanges.filter((change) => change.file === relPath)) {
    const result = landed(
      replaceInLayerBlock(src, change.key, (block) => {
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
        const source = change.matchId
          ? new RegExp(`\\{[^{}]*?id:\\s*"${escapeRe(change.matchId)}"[^{}]*\\}`)
          : new RegExp(`\\{[^{}]*?label:\\s*"${escapeRe(change.subSource)}"[^{}]*\\}`);
        return block.replace(source, patch);
      }),
      change,
      "hosted files",
    );
    src = result.src;
    modified ||= result.modified;
  }

  const fileStatusChanges = (statusChanges || []).filter(
    (c) => c.file === relPath && c.oldStatus !== "published" && c.newStatus !== "published",
  );
  for (const c of fileStatusChanges) {
    const result = landed(
      replaceInLayerBlock(src, c.key, (block) =>
        block.replace(/status:\s*(?:["'][^"']+["']|[A-Z_]+)/, `status: "${c.newStatus}"`),
      ),
      c,
      "status",
    );
    src = result.src;
    modified ||= result.modified;
  }

  if (modified) outputs.set(relPath, src);
}

if (unapplied.length) {
  console.error(
    `\n--apply failed: ${unapplied.length} planned change(s) matched nothing in the config, so nothing was written:\n` +
      unapplied.map((line) => `  ${line}`).join("\n") +
      "\n",
  );
  process.exit(1);
}
for (const [relPath, src] of outputs) {
  writeFileSync(resolve(ROOT, relPath), src, "utf-8");
  console.log(`  Updated: ${relPath}`);
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
