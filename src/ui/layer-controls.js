/**
 * Per-layer UI controls: opacity slider and legend renderer.
 *
 * These are used inside layer accordions after a layer is activated.
 * Extracted here so sidebar.js doesn't own SDK + DOM concerns at once.
 */
import { getViewLayerTransparency, setViewLayerTransparency } from "../sdk/filters.js";
import { getViewLegendImage } from "../sdk/views.js";
import { resolveMapXLegend } from "../sdk/legends.js";

const IMAGE_FALLBACK_LABELS = {
  raster: "Structured raster legend not supported — showing MapX image",
  "raster-json-unavailable": "Structured raster legend unavailable — showing MapX image",
  "raster-json-invalid": "Structured raster legend invalid — showing MapX image",
  "raster-json-unsupported": "Raster style not supported — showing MapX image",
  "catalog-miss": "MapX image legend (view not in project catalogue)",
  "custom-style": "MapX image legend (custom style)",
  "unsupported-view-type": "MapX image legend",
  "schema-invalid": "MapX image legend (unsupported style schema)",
  "too-many-rules": "MapX image legend (large rule set)",
  "unsupported-style": "MapX image legend (unsupported style)",
};

/**
 * The latest opacity a user set per view, with a count of changes. A slider
 * whose transparency read was in flight while the user dragged another slider
 * for the same view takes that value instead of the (now stale) read.
 * @type {Map<string, { changes: number, opacity: number }>}
 */
const userOpacity = new Map();

/**
 * Build an opacity slider for a view and append it to container.
 *
 * Reads the current transparency from the SDK (inverted to opacity for the
 * UI) and updates it on slider input. SDK uses transparency (0=opaque,
 * 100=invisible); UI shows opacity (0=invisible, 100=opaque).
 *
 * @param {string} idView - MapX view ID
 * @param {HTMLElement} container - element to append the slider row into
 */
export async function addOpacitySlider(idView, container) {
  // Same ownership marker as addLegend: if the slot is cleared while the
  // transparency request is pending, the late slider is dropped.
  const requestMarker = document.createComment(`opacity:${idView}`);
  container.appendChild(requestMarker);

  const row = document.createElement("div");
  row.className = "opacity-row";

  // Mangrove's Range pairs `mg-range` with an `mg-form-label` carrying `for`,
  // which needs an id. The same layer can show a slider in its home tab and in
  // another tab's cross-tab section at the same time, so a fixed id would be
  // duplicated; the visible "Opacity" text is therefore decorative and the name
  // comes from aria-label, matching it word for word (WCAG 2.5.3).
  const lbl = document.createElement("span");
  lbl.className = "opacity-label";
  lbl.setAttribute("aria-hidden", "true");
  lbl.textContent = "Opacity";
  row.appendChild(lbl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "mg-range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "100";
  slider.setAttribute("aria-label", "Opacity");
  // The native value announces as a bare number, so spell out the unit. Kept in
  // step with `value` on every input event below.
  slider.setAttribute("aria-valuetext", "100%");
  slider.dataset.viewId = idView;

  const valueDisplay = document.createElement("span");
  valueDisplay.className = "opacity-value";
  valueDisplay.setAttribute("aria-hidden", "true");
  valueDisplay.textContent = "100%";

  // SDK uses "transparency" (0=opaque, 100=invisible); UI shows "opacity"
  // (0=invisible, 100=opaque). Convert: opacity = 100 - transparency.
  const changesBefore = userOpacity.get(idView)?.changes ?? 0;
  let opacity = null;
  try {
    const current = await getViewLayerTransparency(idView);
    if (typeof current === "number") opacity = 100 - current;
  } catch {
    // Default to 100% opacity
  }
  // A slider for the same view was moved during the read: its value is newer.
  const moved = userOpacity.get(idView);
  if (moved && moved.changes !== changesBefore) opacity = moved.opacity;
  if (opacity !== null) {
    slider.value = String(opacity);
    slider.setAttribute("aria-valuetext", `${opacity}%`);
    valueDisplay.textContent = `${opacity}%`;
  }

  slider.addEventListener("input", async () => {
    const opacity = Number(slider.value);
    slider.setAttribute("aria-valuetext", `${opacity}%`);
    valueDisplay.textContent = `${opacity}%`;
    userOpacity.set(idView, { changes: (userOpacity.get(idView)?.changes ?? 0) + 1, opacity });
    syncOpacitySliders(idView, slider);
    try {
      await setViewLayerTransparency(idView, 100 - opacity);
    } catch {
      // Transparency errors are non-fatal
    }
  });

  if (requestMarker.parentNode !== container) return;
  row.appendChild(slider);
  row.appendChild(valueDisplay);
  requestMarker.replaceWith(row);
}

/**
 * Mirror a slider's value onto other sliders for the same view (a layer can
 * show controls in both its home tab and a cross-tab row).
 */
function syncOpacitySliders(idView, source) {
  for (const other of document.querySelectorAll("input.mg-range[data-view-id]")) {
    if (other === source || other.dataset.viewId !== idView) continue;
    other.value = source.value;
    other.setAttribute("aria-valuetext", `${source.value}%`);
    const display = other.closest(".opacity-row")?.querySelector(".opacity-value");
    if (display) display.textContent = `${source.value}%`;
  }
}

/**
 * Render the legend for a layer and append it to container.
 *
 * Priority:
 *   1. A local legend declared by the layer/provider.
 *   2. Structured vector rules or supported GeoServer raster colour maps.
 *   3. The MapX image fallback for unsupported or malformed views.
 *
 * @param {{ id: string, type?: string, geometry?: string, legend?: Array<{color: string, label: string, geometry?: string}> }} layer
 * @param {HTMLElement} container - element to append the legend into
 */
export async function addLegend(layer, container) {
  // This marker gives the async render ownership of its slot. Clearing the
  // slot (layer close/source switch) detaches it, preventing stale commits.
  const requestMarker = document.createComment(`legend:${layer.id ?? "local"}`);
  container.appendChild(requestMarker);
  const isCurrentRequest = () => requestMarker.parentNode === container;

  const hasLocalLegend = Array.isArray(layer.legend) && layer.legend.length > 0;
  let structuredLegend = null;
  let structuredMode = null;
  let structuredTransport = null;
  let fallbackDiagnostic = null;
  let fallbackReason = layer.type === "rt" ? "raster" : "unsupported-view-type";
  if (hasLocalLegend) {
    structuredMode = "local-structured";
    structuredLegend = {
      title: "",
      entries: layer.legend.map((item) => ({
        ...item,
        geometry: item.geometry ?? layer.geometry ?? "polygon",
      })),
    };
  } else if (layer.type === "vt" || layer.type === "rt") {
    try {
      const resolution = await resolveMapXLegend(layer.id);
      if (!isCurrentRequest()) return;
      structuredLegend = resolution.legend;
      structuredTransport = resolution.transport ?? null;
      structuredMode = structuredLegend
        ? layer.type === "rt"
          ? "mapx-raster-structured"
          : "mapx-vector-structured"
        : null;
      fallbackReason = resolution.reason;
      fallbackDiagnostic = resolution.diagnostic ?? null;
    } catch {
      if (!isCurrentRequest()) return;
      fallbackReason = "catalog-miss";
      // Catalogue errors fall through to the MapX image fallback.
    }
  }

  if (structuredLegend) {
    requestMarker.remove();
    renderStructuredLegend(structuredLegend, container, structuredMode, structuredTransport);
    addLegendNote(layer, container);
    addImageLegendComparison(layer.id, container);
    return;
  }

  if (!isCurrentRequest()) return;

  // Unsupported styles use the SDK image as their primary legend.
  try {
    const legendData = await getViewLegendImage(layer.id);
    if (!isCurrentRequest()) return;
    if (!legendData) {
      requestMarker.remove();
      return;
    }
    const fallback = createImageLegendFallback(legendData, fallbackReason, fallbackDiagnostic);
    addLegendNote(layer, fallback);
    requestMarker.replaceWith(fallback);
  } catch {
    if (isCurrentRequest()) requestMarker.remove();
    // Not all layers have SDK legends
  }
}

function addLegendNote(layer, container) {
  if (!layer.legendNote) return;
  const note = document.createElement("p");
  note.className = "legend-note";
  note.textContent = layer.legendNote;
  container.appendChild(note);
}

function displayLegendLabel(value) {
  const label = String(value ?? "").trim();
  return /^(?:absent|null|no[ _-]?data)$/i.test(label) ? "No data" : label;
}

function createImageLegendFallback(legendData, reason, diagnostic) {
  const wrapper = document.createElement("div");
  wrapper.className = "legend-image-fallback";
  wrapper.dataset.legendMode = "mapx-image";
  wrapper.dataset.legendReason = reason ?? "unknown";
  if (diagnostic?.transport) wrapper.dataset.legendTransport = diagnostic.transport;
  if (diagnostic?.failureKind) wrapper.dataset.legendFailure = diagnostic.failureKind;
  if (Number.isInteger(diagnostic?.status)) wrapper.dataset.legendStatus = String(diagnostic.status);

  const caption = document.createElement("div");
  caption.className = "legend-image-fallback-label";
  caption.textContent = IMAGE_FALLBACK_LABELS[reason] ?? "MapX image legend";
  wrapper.appendChild(caption);
  wrapper.appendChild(createLegendImage(legendData, "MapX image legend"));
  return wrapper;
}

function createLegendImage(legendData, alt) {
  const img = document.createElement("img");
  img.className = "layer-legend-img";
  img.src = legendData.startsWith("data:") ? legendData : `data:image/png;base64,${legendData}`;
  img.alt = alt;
  return img;
}

function addImageLegendComparison(idView, container) {
  const details = document.createElement("details");
  details.className = "legend-diagnostic";
  details.dataset.legendComparison = "mapx-image";

  const summary = document.createElement("summary");
  summary.textContent = "Show MapX image legend (comparison)";
  details.appendChild(summary);

  let requested = false;
  let status = null;
  details.addEventListener("toggle", async () => {
    if (!details.open || requested) return;
    requested = true;

    status?.remove();
    status = document.createElement("span");
    status.className = "legend-diagnostic-status";
    status.textContent = "Loading MapX image legend…";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    details.appendChild(status);

    try {
      const legendData = await getViewLegendImage(idView);
      if (!legendData) {
        status.textContent = "MapX image legend is not available.";
        return;
      }
      status.replaceWith(createLegendImage(legendData, "MapX image legend for comparison"));
    } catch {
      status.textContent = "MapX image legend could not be loaded.";
      requested = false;
    }
  });

  container.appendChild(details);
}

function renderStructuredLegend(definition, container, mode, transport) {
  const el = document.createElement("div");
  el.className = "html-legend";
  el.dataset.legendMode = mode;
  if (transport) el.dataset.legendTransport = transport;

  if (definition.title) {
    const title = document.createElement("div");
    title.className = "html-legend-title";
    title.textContent = definition.title;
    el.appendChild(title);
  }

  const rules = document.createElement("div");
  rules.className = "html-legend-rules";
  rules.setAttribute("role", "list");
  rules.setAttribute("aria-label", definition.title || "Legend");
  rules.tabIndex = 0;

  for (const item of definition.entries) {
    const row = document.createElement("div");
    row.className = "html-legend-row";
    row.setAttribute("role", "listitem");

    const symbol = document.createElement("span");
    symbol.className = "html-legend-symbol";
    symbol.setAttribute("aria-hidden", "true");

    const swatch = document.createElement("span");
    const geometry = ["point", "line", "polygon"].includes(item.geometry) ? item.geometry : "polygon";
    swatch.className = `html-legend-swatch html-legend-swatch--${geometry}`;
    swatch.style.backgroundColor = item.color || "#ccc";
    if (item.opacity === 0) {
      swatch.classList.add("html-legend-swatch--transparent");
    } else if (Number.isFinite(item.opacity)) {
      swatch.style.opacity = String(item.opacity);
    }
    if (item.borderColor) swatch.style.borderColor = item.borderColor;
    if (Number.isFinite(item.size)) {
      const size = Math.min(14, Math.max(5, item.size));
      swatch.style.setProperty("--legend-symbol-size", `${size}px`);
    }
    symbol.appendChild(swatch);
    row.appendChild(symbol);

    const label = document.createElement("span");
    label.className = "html-legend-label";
    label.textContent = displayLegendLabel(item.label);
    row.appendChild(label);

    rules.appendChild(row);
  }

  el.appendChild(rules);
  container.appendChild(el);
}
