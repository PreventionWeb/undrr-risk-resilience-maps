/**
 * Widget registry.
 *
 * Maps widget type strings (from layer config) to factory functions.
 * To add a new widget type, create a module in this directory and
 * register it here -- no sidebar.js changes needed.
 */
import { buildSubTabs } from "./sub-tabs.js";
import { buildSteppedSlider } from "./stepped-slider.js";

const REGISTRY = {
  "sub-tabs": buildSubTabs,
  "stepped-slider": buildSteppedSlider,
};

/**
 * Build a widget element from config.
 * @param {object} widgetConfig - { type, label } from layer.widget
 * @param {Array} sources - layer.sources array
 * @param {number} initialIndex - currently active source index
 * @param {function} onSourceChange - callback(newIndex) when user switches
 * @returns {HTMLElement|null}
 */
export function buildWidget(widgetConfig, sources, initialIndex, onSourceChange) {
  const factory = REGISTRY[widgetConfig.type];
  if (!factory) {
    console.warn(`Unknown widget type: "${widgetConfig.type}"`);
    return null;
  }
  return factory(sources, initialIndex, onSourceChange, widgetConfig);
}

/** True if a layer has multiple switchable sources. */
export function isCompound(layer) {
  return Array.isArray(layer.sources) && layer.sources.length > 0;
}

/** Stable key for a compound layer (for state tracking). */
export function compoundKey(layer) {
  return layer.key || layer.label;
}
