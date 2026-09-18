/**
 * Stepped slider widget.
 *
 * Renders a range input with discrete steps for switching between data
 * sources (e.g. earthquake return periods). Each step maps to one source.
 * Debounced to avoid rapid SDK calls when dragging. A rejected switch moves
 * the thumb back to the source actually shown (see source-selection.js).
 */
import { createSourceSelection } from "./source-selection.js";

const DEBOUNCE_MS = 200;

export function buildSteppedSlider(sources, initialIndex, onSourceChange, config, { signal } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "widget-stepped-slider";

  if (config.label) {
    const lbl = document.createElement("label");
    lbl.className = "widget-label mg-form-label";
    lbl.textContent = config.label;
    wrapper.appendChild(lbl);
  }

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "widget-slider-input mg-range";
  slider.min = "0";
  slider.max = String(sources.length - 1);
  slider.step = "1";
  slider.value = String(initialIndex);
  slider.setAttribute("aria-label", config.label || "Source selector");

  // Tick labels
  const ticks = document.createElement("div");
  ticks.className = "widget-slider-ticks mg-range__ticks";
  for (const src of sources) {
    const tick = document.createElement("span");
    tick.textContent = src.label;
    ticks.appendChild(tick);
  }

  // Debounce to prevent rapid SDK calls while dragging
  let debounceTimer = null;
  let lastFired = initialIndex;
  const select = createSourceSelection(initialIndex, onSourceChange);

  // Aborting removes the listener and drops a pick still waiting on the debounce.
  signal?.addEventListener("abort", () => clearTimeout(debounceTimer), { once: true });
  slider.addEventListener(
    "input",
    () => {
      clearTimeout(debounceTimer);
      const idx = Number(slider.value);
      debounceTimer = setTimeout(async () => {
        if (idx === lastFired) return;
        lastFired = idx;
        const shown = await select(idx);
        // Leave the thumb alone if the user has dragged on since this fired.
        if (shown !== idx && Number(slider.value) === idx) {
          lastFired = shown;
          slider.value = String(shown);
        }
      }, DEBOUNCE_MS);
    },
    { signal },
  );

  wrapper.appendChild(slider);
  wrapper.appendChild(ticks);
  return wrapper;
}
