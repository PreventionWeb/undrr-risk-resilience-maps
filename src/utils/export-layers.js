/**
 * Layer inventory CSV export.
 *
 * Column order matches data/inventory.csv (sourced from the master inventory
 * spreadsheet) so the export can be compared against or re-imported as an
 * updated inventory CSV.
 *
 * One row per MapX view ID — sub-sources of compound layers each get their
 * own row. `source`, `citation`, and `license` are layer-level fields and
 * are not defined on individual sub-sources.
 *
 * Note: `sourceUrl` is intentionally omitted — it has no column in the master
 * spreadsheet. Values are preserved in the JS config and not affected by imports.
 *
 * Inventory status mapping (JS status → human-readable):
 *   published             → "Uploaded"
 *   published + external  → "External runtime"
 *   disabled-awaiting-data → "In development"
 *   disabled-pending-removal → "Pending removal"
 */

import { TABS } from "../config/layers/index.js";
import { isLayerPublished, getLayerStatus } from "../config/layers/status.js";

const TYPE_LABELS = {
  rt: "Raster",
  vt: "Vector",
  cc: "Custom / Live",
};

// Maps the human-readable labels returned by getLayerStatus → inventory CSV values
const INVENTORY_STATUS = {
  Active: "Uploaded",
  Placeholder: "In development",
  "Awaiting data": "In development",
  "Pending removal": "Pending removal",
  Disabled: "In development",
};

function cell(value) {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...values) {
  return values.map(cell).join(",");
}

function inventoryStatus(layer, src) {
  if (layer.external && isLayerPublished(layer)) return "External runtime";
  const raw = getLayerStatus(layer, src);
  return INVENTORY_STATUS[raw] ?? raw;
}

export function generateLayerInventoryCSV() {
  const CRLF = "\r\n";
  const BOM = "﻿";

  const lines = [
    row(
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
    ),
  ];

  for (const tab of TABS) {
    for (const layer of tab.layers) {
      const category = tab.label;
      const baseType = TYPE_LABELS[layer.type] || layer.type || "";
      const type = layer.external ? `${baseType} / external runtime` : baseType;
      const initiative = layer.initiative || "";
      const r2rCat = layer.r2rCategory || "";
      const rrStep = layer.rrStep || "";

      if (
        isLayerPublished(layer) &&
        (layer.id !== null || layer.external) &&
        (!layer.citation || !layer.license)
      ) {
        console.warn(`[layer-inventory] Active layer "${layer.key}" is missing citation or license.`);
      }

      if (layer.sources && layer.sources.length > 0) {
        for (const src of layer.sources) {
          lines.push(
            row(
              initiative,
              category,
              r2rCat,
              rrStep,
              layer.key,
              layer.label,
              src.label,
              type,
              src.desc || layer.desc || "",
              src.id || "",
              src.source || layer.source || "",
              layer.citation || "",
              layer.license || "",
              inventoryStatus(layer, src),
            ),
          );
        }
      } else {
        lines.push(
          row(
            initiative,
            category,
            r2rCat,
            rrStep,
            layer.key,
            layer.label,
            "",
            type,
            layer.desc || "",
            layer.external ? "" : layer.id || "",
            layer.source || "",
            layer.citation || "",
            layer.license || "",
            inventoryStatus(layer),
          ),
        );
      }
    }
  }

  return BOM + lines.join(CRLF);
}

export function buildLayerInventoryFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");

  return `undrr-layer-inventory-${timestamp}.csv`;
}

export function downloadLayerInventory() {
  const csv = generateLayerInventoryCSV();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildLayerInventoryFilename();
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
