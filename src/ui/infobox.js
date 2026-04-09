/**
 * Feature click popup.
 *
 * Displays attribute data when a user clicks a vector feature on the map.
 * The MapX SDK fires "click_attributes" events with the feature properties;
 * this module renders them as a key-value table in a floating infobox.
 */

// MapX internal fields that shouldn't be shown to users
const SKIP_KEYS = ["gid", "mx_t0", "mx_t1", "geom", "geometry"];

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Single managed Escape handler — replaced on every show, cleaned up on every close
let _escHandler = null;

export function showInfobox(data) {
  const box = document.getElementById("infobox");
  if (!box) return;

  if (!data || typeof data !== "object") {
    box.style.display = "none";
    return;
  }

  // The SDK sends attributes as either an array (vector views) or a plain
  // object (custom coded views). Normalise to a single object.
  let props = null;
  if (
    data.attributes &&
    Array.isArray(data.attributes) &&
    data.attributes.length > 0
  ) {
    props = data.attributes[0];
  } else if (
    data.attributes &&
    typeof data.attributes === "object" &&
    !Array.isArray(data.attributes)
  ) {
    props = data.attributes;
  }

  if (!props || typeof props !== "object") {
    box.style.display = "none";
    return;
  }

  const entries = Object.entries(props).filter(
    ([k, v]) => !SKIP_KEYS.includes(k.toLowerCase()) && v != null && v !== "",
  );

  if (entries.length === 0) {
    box.style.display = "none";
    return;
  }

  const nameEntry = entries.find(([k]) =>
    ["name", "title", "label"].includes(k.toLowerCase()),
  );
  const featureName = nameEntry ? String(nameEntry[1]) : "Feature";

  const title = box.querySelector(".infobox-title");
  const body = box.querySelector(".infobox-body");
  const closeBtn = box.querySelector(".infobox-close");

  if (title) title.textContent = featureName;

  if (body) {
    let html = '<table class="mg-table mg-table--small">';
    for (const [key, value] of entries) {
      const label = key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      html += `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`;
    }
    html += "</table>";
    body.innerHTML = html;
  }

  box.style.display = "block";

  // Remove any previous Escape handler before registering a new one
  if (_escHandler) {
    document.removeEventListener("keydown", _escHandler);
    _escHandler = null;
  }

  const close = () => {
    box.style.display = "none";
    if (_escHandler) {
      document.removeEventListener("keydown", _escHandler);
      _escHandler = null;
    }
  };

  if (closeBtn) closeBtn.onclick = close;

  _escHandler = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", _escHandler);
}
