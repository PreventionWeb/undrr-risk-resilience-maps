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
