#!/usr/bin/env node
/**
 * Import inventory CSV → layer config sync tool.
 *
 * Usage:
 *   node scripts/import-inventory.mjs              # dry-run: report only
 *   node scripts/import-inventory.mjs --apply      # apply MapX ID + status changes
 *
 * The canonical inventory CSV lives at data/inventory.csv and matches the
 * column structure of the master spreadsheet held by colleagues:
 *   https://unitednations-my.sharepoint.com/:x:/r/personal/william_herrerapenagos_un_org/...
 *
 * When colleagues send an updated CSV, replace data/inventory.csv then run:
 *   node scripts/import-inventory.mjs
 * Review the report, then run with --apply to patch MapX view IDs and statuses.
 * Rows whose layer keys appear in data/removed-layer-keys.txt are ignored, so
 * retired entries in an upstream spreadsheet cannot be reintroduced.
 *
 * What --apply changes:
 *   - mapxViewId   (id field on simple layers; id on each sub-source for compound)
 *   - Inventory status changes between disabled variants:
 *       "disabled-awaiting-data" ↔ "disabled-pending-removal"
 *
 * What --apply does NOT change (review manually):
 *   - Published ↔ disabled transitions (adding/removing the status field entirely)
 *   - source, citation, license, desc, legend, widget, sourceUrl, geometry, note
 *   - external provider definitions (external rows intentionally have no MapX ID)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const CSV_PATH = resolve(ROOT, "data/inventory.csv");
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
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// ── Load CSV ──────────────────────────────────────────────────────────────────

const csvText = readFileSync(CSV_PATH, "utf-8").replace(/^\uFEFF/, "");
const [headerRow, ...dataRows] = parseCSV(csvText);

const H = {};
headerRow.forEach((h, i) => (H[h.trim()] = i));

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
  subMap.get(subSource).push({ mapxId, status, layerName, initiative, r2rCat, rrStep });
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
    if (sourcesMatch) {
      // Compound layer — extract sub-source labels and IDs from the sources array
      const sourcesBlock = forwardBlock.slice(sourcesMatch.index);
      const subRe2 = /\{[^}]*?id:\s*(null|["'][^"']*["'])[^}]*?label:\s*["']([^"']+)["'][^}]*\}/g;
      let sm;
      while ((sm = subRe2.exec(sourcesBlock)) !== null) {
        const rawId = sm[1].trim();
        const inventoryLabel = /inventoryLabel:\s*["']([^"']+)["']/.exec(sm[0]);
        const subLabel = inventoryLabel ? inventoryLabel[1] : sm[2];
        const currentId = rawId === "null" ? "" : rawId.replace(/["']/g, "");
        entries.push({ key, subSource: subLabel, uiLabel: sm[2], currentId, currentStatus: "", file });
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

      entries.push({ key, subSource: "", currentId, currentStatus, file });
    }
  }
  return entries;
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

// Track which CSV entries were matched
const csvMatched = new Map();

for (const entry of jsEntries) {
  const csvLayer = inventory.get(entry.key);
  if (!csvLayer) {
    onlyInJS.push(entry);
    continue;
  }

  const csvEntries = csvLayer.get(entry.subSource);
  const occurrenceKey = `${entry.key}|${entry.subSource}`;
  const occurrence = csvMatched.get(occurrenceKey) || 0;
  const csvEntry = csvEntries?.[occurrence];
  if (!csvEntry) {
    onlyInJS.push(entry);
    continue;
  }

  csvMatched.set(occurrenceKey, occurrence + 1);
  matched.push({ ...entry, csvEntry });

  // Check for MapX ID change
  const csvId = csvEntry.mapxId.startsWith("MX-") ? csvEntry.mapxId : "";
  if (csvId && csvId !== entry.currentId) {
    idChanges.push({ ...entry, newId: csvId, oldId: entry.currentId });
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

if (!APPLY) {
  console.log("\nDry-run complete. Pass --apply to write ID and status changes to JS files.\n");
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────────

const applyableStatusChanges = statusChanges.filter(
  (change) => change.oldStatus !== "published" && change.newStatus !== "published",
);

if (idChanges.length === 0 && applyableStatusChanges.length === 0) {
  console.log("\n--apply: nothing to change.\n");
  process.exit(0);
}

console.log("\n--apply: writing changes...");

// Group changes by file
const changesByFile = {};
for (const change of idChanges) {
  (changesByFile[change.file] ??= []).push(change);
}
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
      // New compound IDs are scoped to their layer block. UI labels must be
      // unique even when inventoryLabel intentionally repeats.
      const result = replaceInLayerBlock(src, c.key, (block) =>
        block.replace(
          new RegExp(`(id:\\s*)null((?:[^}](?!label))*?label:\\s*"${escapeRe(c.uiLabel || c.subSource)}")`),
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

  // Apply status changes (disabled ↔ disabled transitions only)
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
