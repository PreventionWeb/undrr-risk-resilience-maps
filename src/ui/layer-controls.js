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
  raster: "MapX image legend (raster)",
  "catalog-miss": "MapX image legend (view not in project catalogue)",
  "custom-style": "MapX image legend (custom style)",
  "unsupported-view-type": "MapX image legend",
  "schema-invalid": "MapX image legend (unsupported style schema)",
  "too-many-rules": "MapX image legend (large rule set)",
  "unsupported-style": "MapX image legend (unsupported style)",
};

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
  const row = document.createElement("div");
  row.className = "opacity-row";

  const lbl = document.createElement("label");
  lbl.textContent = "Opacity";
  row.appendChild(lbl);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "100";

  const valueDisplay = document.createElement("span");
  valueDisplay.className = "opacity-value";
  valueDisplay.textContent = "100%";

  // SDK uses "transparency" (0=opaque, 100=invisible); UI shows "opacity"
  // (0=invisible, 100=opaque). Convert: opacity = 100 - transparency.
  try {
    const current = await getViewLayerTransparency(idView);
    if (typeof current === "number") {
      slider.value = String(100 - current);
      valueDisplay.textContent = `${100 - current}%`;
    }
  } catch {
    // Default to 100% opacity
  }

  slider.addEventListener("input", async () => {
    const opacity = Number(slider.value);
    valueDisplay.textContent = `${opacity}%`;
    try {
      await setViewLayerTransparency(idView, 100 - opacity);
    } catch {
      // Transparency errors are non-fatal
    }
  });

  row.appendChild(slider);
  row.appendChild(valueDisplay);
  container.appendChild(row);
}

/**
 * Render the legend for a layer and append it to container.
 *
 * Priority:
 *   1. A local legend declared by the layer/provider.
 *   2. Structured vector style rules from the MapX project catalogue.
 *   3. The server-rendered MapX PNG for unsupported or malformed views.
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
  } else if (layer.type === "vt") {
    try {
      const resolution = await resolveMapXLegend(layer.id);
      if (!isCurrentRequest()) return;
      structuredLegend = resolution.legend;
      structuredMode = structuredLegend ? "mapx-vector-structured" : null;
      fallbackReason = resolution.reason;
    } catch {
      if (!isCurrentRequest()) return;
      fallbackReason = "catalog-miss";
      // Catalogue errors fall through to the authoritative image.
    }
  }

  if (structuredLegend) {
    requestMarker.remove();
    renderStructuredLegend(structuredLegend, container, structuredMode);
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
    requestMarker.replaceWith(createImageLegendFallback(legendData, fallbackReason));
  } catch {
    if (isCurrentRequest()) requestMarker.remove();
    // Not all layers have SDK legends
  }
}

function createImageLegendFallback(legendData, reason) {
  const wrapper = document.createElement("div");
  wrapper.className = "legend-image-fallback";
  wrapper.dataset.legendMode = "mapx-image";
  wrapper.dataset.legendReason = reason ?? "unknown";

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

function renderStructuredLegend(definition, container, mode) {
  const el = document.createElement("div");
  el.className = "html-legend";
  el.dataset.legendMode = mode;

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
    if (Number.isFinite(item.opacity)) swatch.style.opacity = String(item.opacity);
    if (item.borderColor) swatch.style.borderColor = item.borderColor;
    if (Number.isFinite(item.size)) {
      const size = Math.min(14, Math.max(5, item.size));
      swatch.style.setProperty("--legend-symbol-size", `${size}px`);
    }
    symbol.appendChild(swatch);
    row.appendChild(symbol);

    const label = document.createElement("span");
    label.className = "html-legend-label";
    label.textContent = item.label || "";
    row.appendChild(label);

    rules.appendChild(row);
  }

  el.appendChild(rules);
  container.appendChild(el);
}
