/** Escape a value for interpolation into HTML text or attribute values. */
export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** MapX internal feature attributes that are not meaningful to users. */
export const HIDDEN_ATTRIBUTE_KEYS = ["gid", "mx_t0", "mx_t1", "geom", "geometry"];

/**
 * True when a clicked feature's attribute holds no value. Vector tiles cannot
 * carry nulls, so MapX fills a missing attribute with the literal string
 * "$NULL" before dispatching `click_attributes`.
 */
export function isEmptyAttributeValue(value) {
  return value == null || value === "" || value === "$NULL";
}
