import { describe, expect, it, vi } from "vitest";
import { buildExternalControls } from "./external-controls.js";

const definition = {
  controls: [
    {
      key: "scenario",
      label: "Scenario",
      options: [
        { value: "CURRENT", label: "Current" },
        { value: "20", label: "+2 °C" },
      ],
    },
  ],
};

function change(select, value) {
  select.value = value;
  select.dispatchEvent(new Event("change"));
}

describe("buildExternalControls", () => {
  it("renders provider-defined options and the selected setting", () => {
    const controls = buildExternalControls(definition, { scenario: "CURRENT" }, vi.fn());
    const select = controls.querySelector("select");

    expect(select.value).toBe("CURRENT");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Current", "+2 °C"]);
  });

  it("locks controls while an external replacement is pending", async () => {
    let resolveChange;
    const onChange = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveChange = resolve;
        }),
    );
    const controls = buildExternalControls(definition, { scenario: "CURRENT" }, onChange);
    const select = controls.querySelector("select");

    change(select, "20");
    expect(select.disabled).toBe(true);
    expect(controls.querySelector(".external-layer-status").textContent).toBe("Updating external layer…");

    resolveChange({ settings: { scenario: "20" } });
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe("20");
  });

  it("restores the prior setting and shows a provider-neutral error", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("upstream unavailable"));
    const controls = buildExternalControls(definition, { scenario: "CURRENT" }, onChange);
    const select = controls.querySelector("select");

    change(select, "20");
    await vi.waitFor(() => expect(select.disabled).toBe(false));

    expect(select.value).toBe("CURRENT");
    expect(controls.querySelector(".external-layer-status").textContent).toBe(
      "Could not update the external layer. Please try again.",
    );
  });
});
