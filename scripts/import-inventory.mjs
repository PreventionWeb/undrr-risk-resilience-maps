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
 *
 * What --apply changes:
 *   - mapxViewId   (id field on simple layers; id on each sub-source for compound)
 *   - Inventory status changes between disabled variants:
 *       "disabled-awaiting-data" ↔ "disabled-pending-removal"
 *
 * What --apply does NOT change (review manually):
 *   - Published ↔ disabled transitions (adding/removing the status field entirely)
 *   - source, citation, license, desc, legend, widget, sourceUrl, geometry, note
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const CSV_PATH = resolve(ROOT, "data/inventory.csv");

const APPLY = process.argv.includes("--apply");

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

// Build inventory index: key → { subSource → {mapxId, status, layerName, initiative, r2rCategory, rrStep} }
const inventory = new Map();

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

  if (!inventory.has(key)) inventory.set(key, new Map());
  inventory.get(key).set(subSource, { mapxId, status, layerName, initiative, r2rCat, rrStep });
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
        const subLabel = sm[2];
        const currentId = rawId === "null" ? "" : rawId.replace(/["']/g, "");
        entries.push({ key, subSource: subLabel, currentId, currentStatus: "", file });
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
      const statusMatch = /status:\s*["']([^"']+)["']/.exec(objSrc + forwardBlock.slice(0, 200));
      const currentStatus = statusMatch ? statusMatch[1] : "published";

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
const csvMatched = new Set();

for (const entry of jsEntries) {
  const csvLayer = inventory.get(entry.key);
  if (!csvLayer) {
    onlyInJS.push(entry);
    continue;
  }

  const csvEntry = csvLayer.get(entry.subSource);
  if (!csvEntry) {
    onlyInJS.push(entry);
    continue;
  }

  const matchKey = `${entry.key}|${entry.subSource}`;
  csvMatched.add(matchKey);
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
  for (const [subSource, csvEntry] of subMap) {
    const matchKey = `${key}|${subSource}`;
    if (!csvMatched.has(matchKey)) {
      onlyInCSV.push({ key, subSource, csvEntry });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log("\n=== Layer Inventory Sync Report ===\n");
console.log(`CSV rows:    ${[...inventory.values()].reduce((n, m) => n + m.size, 0)}`);
console.log(`JS entries:  ${jsEntries.length}`);
console.log(`Matched:     ${matched.length}`);

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

if (idChanges.length === 0) {
  console.log("\n--apply: nothing to change.\n");
  process.exit(0);
}

console.log("\n--apply: writing changes...");

// Group changes by file
const changesByFile = {};
for (const change of idChanges) {
  (changesByFile[change.file] ??= []).push(change);
}

for (const [relPath, changes] of Object.entries(changesByFile)) {
  let src = fileSources[relPath];
  let modified = false;

  for (const c of changes) {
    if (!c.newId) continue;

    // Replace null or old ID for this sub-source within the file.
    // Strategy: find the label string, then patch the nearest id: before it.
    const labelPattern = c.subSource ? `label: "${c.subSource}"` : null;

    if (labelPattern) {
      // Compound: find { id: X, label: "subSource" } or { id: X, ..., label: "subSource" }
      const re = new RegExp(
        `(id:\\s*)(null|"[^"]*")((?:[^}](?!label))*?label:\\s*"${escapeRe(c.subSource)}")`,
        "g",
      );
      const replaced = src.replace(re, (m, pre, _id, post) => {
        modified = true;
        return `${pre}"${c.newId}"${post}`;
      });
      if (replaced !== src) src = replaced;
    } else {
      // Simple layer: id: appears BEFORE key: in the JS object.
      // Find the key: position, then look backward to the enclosing object's id:.
      const keyMatch = new RegExp(`key:\\s*"${escapeRe(c.key)}"`).exec(src);
      if (keyMatch) {
        const before = src.slice(0, keyMatch.index);
        const objStart = before.lastIndexOf("  {\n");
        if (objStart >= 0) {
          const objHead = before.slice(objStart);
          const idMatch = /(id:\s*)(null|"[^"]*")/.exec(objHead);
          if (idMatch) {
            const absPos = objStart + idMatch.index;
            src = src.slice(0, absPos) + idMatch[1] + `"${c.newId}"` + src.slice(absPos + idMatch[0].length);
            modified = true;
          }
        }
      }
    }
  }

  // Apply status changes (disabled ↔ disabled transitions only)
  const fileStatusChanges = (statusChanges || []).filter(
    (c) => c.file === relPath && c.oldStatus !== "published" && c.newStatus !== "published",
  );
  for (const c of fileStatusChanges) {
    const re = new RegExp(`(status:\\s*")${escapeRe(c.oldStatus)}(")`);
    const replaced = src.replace(re, (m, pre, post) => {
      modified = true;
      return `${pre}${c.newStatus}${post}`;
    });
    if (replaced !== src) src = replaced;
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
