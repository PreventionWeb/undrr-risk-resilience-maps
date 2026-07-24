/** Build generic select controls declared by an external layer provider. */
export function buildExternalControls(definition, initialSettings, onChange) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "external-layer-controls";

  const legend = document.createElement("legend");
  legend.textContent = "External data options";
  fieldset.appendChild(legend);

  let current = { ...initialSettings };
  const selects = new Map();

  for (const control of definition.controls) {
    const row = document.createElement("label");
    row.className = "external-layer-control";

    const label = document.createElement("span");
    label.textContent = control.label;
    row.appendChild(label);

    const select = document.createElement("select");
    select.dataset.externalControl = control.key;
    for (const option of control.options) {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.appendChild(optionEl);
    }
    select.value = current[control.key];
    row.appendChild(select);
    fieldset.appendChild(row);
    selects.set(control.key, select);
  }

  const status = document.createElement("p");
  status.className = "external-layer-status";
  status.setAttribute("aria-live", "polite");
  fieldset.appendChild(status);

  for (const [key, select] of selects) {
    select.addEventListener("change", async () => {
      const previous = { ...current };
      const next = { ...current, [key]: select.value };
      for (const input of selects.values()) input.disabled = true;
      status.classList.remove("is-error");
      status.textContent = "Updating external layer…";

      try {
        const result = await onChange(next);
        current = { ...(result?.settings ?? next) };
        for (const [controlKey, input] of selects) {
          input.value = current[controlKey];
        }
        status.textContent = "";
      } catch (error) {
        current = previous;
        for (const [controlKey, input] of selects) {
          input.value = current[controlKey];
        }
        status.classList.add("is-error");
        status.textContent = "Could not update the external layer. Please try again.";
        console.warn("Failed to update external layer:", error);
      } finally {
        for (const input of selects.values()) input.disabled = false;
      }
    });
  }

  return fieldset;
}
