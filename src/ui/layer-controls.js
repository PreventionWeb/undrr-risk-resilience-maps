/**
 * Per-layer UI controls: opacity slider and legend renderer.
 *
 * These are used inside layer accordions after a layer is activated.
 * Extracted here so sidebar.js doesn't own SDK + DOM concerns at once.
 */
import { getViewLayerTransparency, setViewLayerTransparency } from "../sdk/filters.js";
import { getViewLegendImage } from "../sdk/views.js";

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
 * If the layer config has a local `legend` array, renders HTML colour swatches.
 * The SDK legend image (server-rendered PNG) is also fetched:
 *   - When no local legend exists: shown as the primary legend.
 *   - When a local legend exists: shown as a collapsed diagnostic toggle.
 *
 * @param {{ id: string, legend?: Array<{color: string, label: string}> }} layer
 * @param {HTMLElement} container - element to append the legend into
 */
export async function addLegend(layer, container) {
  const hasLocalLegend = Array.isArray(layer.legend) && layer.legend.length > 0;
  if (hasLocalLegend) {
    const el = document.createElement("div");
    el.className = "html-legend";
    for (const item of layer.legend) {
      const row = document.createElement("div");
      row.className = "html-legend-row";

      const swatch = document.createElement("span");
      swatch.className = "html-legend-swatch";
      swatch.style.background = item.color || "#ccc";
      row.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "html-legend-label";
      label.textContent = item.label || "";
      row.appendChild(label);

      el.appendChild(row);
    }
    container.appendChild(el);
  }

  // Fetch SDK legend image
  try {
    const legendData = await getViewLegendImage(layer.id);
    if (!legendData) return;

    const img = document.createElement("img");
    img.className = "layer-legend-img";
    img.src = legendData.startsWith("data:")
      ? legendData
      : `data:image/png;base64,${legendData}`;
    img.alt = "SDK legend";

    if (hasLocalLegend) {
      // Show as collapsed diagnostic
      const details = document.createElement("details");
      details.className = "legend-diagnostic";
      const summary = document.createElement("summary");
      summary.textContent = "SDK legend (diagnostic)";
      details.appendChild(summary);
      details.appendChild(img);
      container.appendChild(details);
    } else {
      // No local override -- show SDK image directly
      container.appendChild(img);
    }
  } catch {
    // Not all layers have SDK legends
  }
}
