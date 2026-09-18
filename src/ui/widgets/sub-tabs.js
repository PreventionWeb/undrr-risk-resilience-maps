/**
 * Sub-tabs widget.
 *
 * Renders a button bar within a layer accordion for switching between
 * data sources (e.g. Depth / Frequency / Exposure).
 *
 * The selection is shown immediately and corrected if the switch is rejected
 * (see source-selection.js).
 */
import { createSourceSelection } from "./source-selection.js";

export function buildSubTabs(sources, initialIndex, onSourceChange, config, { signal } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "widget-sub-tabs";

  if (config.label) {
    // Decorative, as on the opacity slider: a bare <label> with no `for` names
    // nothing, and the control below carries the same words in `aria-label`
    // (WCAG 2.5.3). See ARCHITECTURE.md, "Labelling controls".
    const lbl = document.createElement("span");
    lbl.className = "widget-label mg-form-label";
    lbl.setAttribute("aria-hidden", "true");
    lbl.textContent = config.label;
    wrapper.appendChild(lbl);
  }

  const select = createSourceSelection(initialIndex, onSourceChange);

  if (sources.length > 3) {
    wrapper.classList.add("widget-sub-tabs--select");
    const dropdown = document.createElement("select");
    dropdown.className = "widget-source-select mg-form-select";
    dropdown.setAttribute("aria-label", config.label || "Layer option");

    for (let i = 0; i < sources.length; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = sources[i].label;
      option.selected = i === initialIndex;
      dropdown.appendChild(option);
    }

    dropdown.addEventListener(
      "change",
      async () => {
        dropdown.value = String(await select(Number(dropdown.value)));
      },
      { signal },
    );
    wrapper.appendChild(dropdown);
    return wrapper;
  }

  const bar = document.createElement("div");
  bar.className = "widget-sub-tabs-bar";
  bar.setAttribute("role", "tablist");
  // The visible label above is decorative, so the tablist carries the name.
  bar.setAttribute("aria-label", config.label || "Layer option");

  const setActive = (index) => {
    bar.querySelectorAll(".widget-sub-tab").forEach((b, i) => {
      b.classList.toggle("is-active", i === index);
      b.setAttribute("aria-selected", String(i === index));
    });
  };

  for (let i = 0; i < sources.length; i++) {
    const btn = document.createElement("button");
    btn.className = "widget-sub-tab";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(i === initialIndex));
    btn.textContent = sources[i].label;
    if (i === initialIndex) btn.classList.add("is-active");

    btn.addEventListener(
      "click",
      async () => {
        setActive(i);
        setActive(await select(i));
      },
      { signal },
    );

    bar.appendChild(btn);
  }

  wrapper.appendChild(bar);
  return wrapper;
}
