/**
 * Layer config validation.
 *
 * Run at startup to catch typos and structural errors in config/layers.js
 * before the app tries to talk to the SDK. Throws on the first batch of
 * errors so they show up immediately in the console.
 */

import { isLayerPublished } from "./layers/status.js";

const VALID_TYPES = ["rt", "vt", "cc"];

export function validateLayers(tabs, primaryProject) {
  const errors = [];
  const seenIds = new Set();
  const seenKeys = new Set();

  for (const tab of tabs) {
    if (!tab.id || !tab.label || !Array.isArray(tab.layers)) {
      errors.push(`Tab missing id, label, or layers: ${JSON.stringify(tab)}`);
      continue;
    }

    for (const layer of tab.layers) {
      const ctx = `[${tab.id}] "${layer.label || "(no label)"}"`;
      const compound = Array.isArray(layer.sources) && layer.sources.length > 0;
      const published = isLayerPublished(layer);

      if (!layer.label) {
        errors.push(`${ctx} -- missing label`);
      }

      if (!VALID_TYPES.includes(layer.type)) {
        errors.push(`${ctx} -- invalid type "${layer.type}" (expected: ${VALID_TYPES.join(", ")})`);
      }

      if (layer.key) {
        if (seenKeys.has(layer.key)) {
          errors.push(`${ctx} -- duplicate key "${layer.key}" (breaks hash routing and layerElementMap)`);
        }
        seenKeys.add(layer.key);
      }

      // Enabled layers must belong to the primary project (SDK is single-project)
      if (published && primaryProject && layer.project && layer.project !== primaryProject) {
        errors.push(`${ctx} -- enabled layer belongs to project "${layer.project}" but SDK only loads "${primaryProject}". Set status to an unpublished value until data is consolidated.`);
      }

      if (compound) {
        if (!layer.widget || !layer.widget.type) {
          errors.push(`${ctx} -- compound layer missing widget.type`);
        }
        for (let s = 0; s < layer.sources.length; s++) {
          const src = layer.sources[s];
          if (!src.label) {
            errors.push(`${ctx} -- sources[${s}] missing label`);
          }
          if (published) {
            // Published compound layers require valid string IDs on every source
            if (!src.id || typeof src.id !== "string") {
              errors.push(`${ctx} -- sources[${s}] missing id`);
            }
          } else if (src.id != null && typeof src.id !== "string") {
            // Unpublished layers may have null IDs; any non-null ID must be a string
            errors.push(`${ctx} -- sources[${s}] id must be a string or null`);
          }
          if (src.id && seenIds.has(src.id)) {
            errors.push(`${ctx} -- sources[${s}] reuses view id "${src.id}" (already used by another layer -- breaks toggle state)`);
          }
          if (src.id) seenIds.add(src.id);
        }
      } else {
        // Simple layer: must have a string ID (unless disabled)
        if (isLayerPublished(layer) && (typeof layer.id !== "string" || !layer.id)) {
          errors.push(`${ctx} -- enabled layer missing id`);
        }
      }

      // Duplicate IDs across layers corrupt toggle state -- treat as an error
      if (layer.id && seenIds.has(layer.id)) {
        errors.push(`${ctx} -- reuses view id "${layer.id}" (already used by another layer -- breaks toggle state)`);
      }
      if (layer.id) seenIds.add(layer.id);

      // Legend entries should have color + label
      if (Array.isArray(layer.legend)) {
        for (let i = 0; i < layer.legend.length; i++) {
          const item = layer.legend[i];
          if (!item.color) {
            errors.push(`${ctx} -- legend[${i}] missing color`);
          }
          if (!item.label) {
            errors.push(`${ctx} -- legend[${i}] missing label`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("Layer config validation failed:");
    for (const err of errors) console.error(`  - ${err}`);
    throw new Error(`${errors.length} layer config error(s) -- see console`);
  }
}
