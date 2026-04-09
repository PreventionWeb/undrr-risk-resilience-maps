/**
 * Layer inventory CSV export.
 *
 * Generates a CSV from the layer config TABS array so the file always
 * reflects the current state of the application. Includes one row per
 * MapX view ID (sub-sources of compound layers each get their own row).
 *
 * `citation` and `license` are layer-level fields only — not defined on
 * individual sub-sources of compound layers.
 */

import { TABS } from "../config/layers/index.js";
import { PROJECT_LABELS } from "../config/layers/projects.js";

const TYPE_LABELS = {
  rt: "Raster",
  vt: "Vector",
  cc: "Custom / Live",
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

export function generateLayerInventoryCSV() {
  const CRLF = "\r\n";
  const BOM = "\uFEFF";

  const lines = [
    row(
      "Category", "Layer key", "Layer name", "Sub-source",
      "Type", "Description", "MapX view ID", "MapX project",
      "Status", "Source attribution", "Source URL", "Citation", "License", "Notes"
    ),
  ];

  for (const tab of TABS) {
    for (const layer of tab.layers) {
      const category = tab.label;
      const type = TYPE_LABELS[layer.type] || layer.type;
      const project = PROJECT_LABELS[layer.project] || layer.project || "";

      // Warn in dev if an active layer is missing citation or license
      if (!layer.disabled && layer.id !== null && (!layer.citation || !layer.license)) {
        console.warn(`[layer-inventory] Active layer "${layer.key}" is missing citation or license.`);
      }

      if (layer.sources && layer.sources.length > 0) {
        // Compound layer: one row per sub-source; citation/license from parent
        for (const src of layer.sources) {
          const status = layer.disabled ? "Disabled" : (src.id ? "Active" : "Placeholder");
          lines.push(row(
            category,
            layer.key,
            layer.label,
            src.label,
            type,
            src.desc || layer.desc || "",
            src.id || "",
            project,
            status,
            src.source || layer.source || "",
            src.sourceUrl || layer.sourceUrl || "",
            layer.citation || "",
            layer.license || "",
            src.note || layer.note || "",
          ));
        }
      } else {
        // Simple layer
        const status = layer.disabled ? "Disabled" : (layer.id ? "Active" : "Placeholder");
        lines.push(row(
          category,
          layer.key,
          layer.label,
          "",
          type,
          layer.desc || "",
          layer.id || "",
          project,
          status,
          layer.source || "",
          layer.sourceUrl || "",
          layer.citation || "",
          layer.license || "",
          layer.note || "",
        ));
      }
    }
  }

  return BOM + lines.join(CRLF);
}

export function downloadLayerInventory() {
  const csv = generateLayerInventoryCSV();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "undrr-layer-inventory.csv";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

