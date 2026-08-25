/**
 * Sub-tabs widget.
 *
 * Renders a button bar within a layer accordion for switching between
 * data sources (e.g. Depth / Frequency / Exposure).
 */

export function buildSubTabs(sources, initialIndex, onSourceChange, config) {
  const wrapper = document.createElement("div");
  wrapper.className = "widget-sub-tabs";

  if (config.label) {
    const lbl = document.createElement("label");
    lbl.className = "widget-label";
    lbl.textContent = config.label;
    wrapper.appendChild(lbl);
  }

  if (sources.length > 3) {
    wrapper.classList.add("widget-sub-tabs--select");
    const select = document.createElement("select");
    select.className = "widget-source-select";
    select.setAttribute("aria-label", config.label || "Layer option");

    for (let i = 0; i < sources.length; i++) {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = sources[i].label;
      option.selected = i === initialIndex;
      select.appendChild(option);
    }

    select.addEventListener("change", () => onSourceChange(Number(select.value)));
    wrapper.appendChild(select);
    return wrapper;
  }

  const bar = document.createElement("div");
  bar.className = "widget-sub-tabs-bar";
  bar.setAttribute("role", "tablist");

  for (let i = 0; i < sources.length; i++) {
    const btn = document.createElement("button");
    btn.className = "widget-sub-tab";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(i === initialIndex));
    btn.textContent = sources[i].label;
    if (i === initialIndex) btn.classList.add("is-active");

    btn.addEventListener("click", () => {
      for (const b of bar.querySelectorAll(".widget-sub-tab")) {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      }
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");
      onSourceChange(i);
    });

    bar.appendChild(btn);
  }

  wrapper.appendChild(bar);
  return wrapper;
}
