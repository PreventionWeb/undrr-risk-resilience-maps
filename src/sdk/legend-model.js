/**
 * Provider-neutral legend model and validation shared by every adapter.
 *
 * Keeping these limits in one module prevents MapX vector and GeoServer
 * raster legends from drifting into different trust or display rules.
 */

export const MAX_LEGEND_ENTRIES = 500;
export const MAX_LEGEND_TEXT_LENGTH = 200;

const COLOR_PATTERN = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,50}\)|[a-z]{1,30})$/i;
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;

/**
 * @typedef {Object} LegendEntry
 * @property {string} color
 * @property {string} label
 * @property {number} opacity
 * @property {number|null} size
 * @property {"point"|"line"|"polygon"} geometry
 * @property {string|null} borderColor
 */

/**
 * @typedef {Object} LegendDefinition
 * @property {string} title
 * @property {LegendEntry[]} entries
 */

export function isSafeLegendColor(value) {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    COLOR_PATTERN.test(value.trim()) &&
    !hasControlCharacter(value)
  );
}

export function isSafeLegendText(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_LEGEND_TEXT_LENGTH &&
    !hasControlCharacter(value)
  );
}

export function localizedLegendValue(object, language) {
  if (!object || typeof object !== "object") return "";
  const requested = object[language];
  if (isSafeLegendText(requested)) return requested.trim();

  const english = object.en;
  if (isSafeLegendText(english)) return english.trim();

  const fallback = Object.entries(object).find(
    ([candidateKey, value]) => LANGUAGE_KEY_PATTERN.test(candidateKey) && isSafeLegendText(value),
  );
  return fallback?.[1]?.trim() ?? "";
}

export function displayLegendValue(value) {
  if (isSafeLegendText(value)) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function hasControlCharacter(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}
