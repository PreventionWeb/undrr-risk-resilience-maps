/**
 * Stepped slider widget.
 *
 * Renders a range input with discrete steps for switching between data
 * sources (e.g. earthquake return periods). Each step maps to one source.
 * Debounced to avoid rapid SDK calls when dragging.
 */

const DEBOUNCE_MS = 200;

export function buildSteppedSlider(sources, initialIndex, onSourceChange, config) {
  const wrapper = document.createElement("div");
  wrapper.className = "widget-stepped-slider";

  if (config.label) {
    const lbl = document.createElement("label");
    lbl.className = "widget-label";
    lbl.textContent = config.label;
    wrapper.appendChild(lbl);
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "widget-slider-input";
  slider.min = "0";
  slider.max = String(sources.length - 1);
  slider.step = "1";
  slider.value = String(initialIndex);
  slider.setAttribute("aria-label", config.label || "Source selector");

  // Tick labels
  const ticks = document.createElement("div");
  ticks.className = "widget-slider-ticks";
  for (const src of sources) {
    const tick = document.createElement("span");
    tick.textContent = src.label;
    ticks.appendChild(tick);
  }

  // Debounce to prevent rapid SDK calls while dragging
  let debounceTimer = null;
  let lastFired = initialIndex;

  slider.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const idx = Number(slider.value);
    debounceTimer = setTimeout(() => {
      if (idx !== lastFired) {
        lastFired = idx;
        onSourceChange(idx);
      }
    }, DEBOUNCE_MS);
  });

  wrapper.appendChild(slider);
  wrapper.appendChild(ticks);
  return wrapper;
}
