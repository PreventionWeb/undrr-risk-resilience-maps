import { describe, it, expect, vi } from "vitest";
import { buildSubTabs } from "./sub-tabs.js";

const SOURCES = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
];
const CONFIG = { type: "sub-tabs", label: "Metric" };

describe("buildSubTabs", () => {
  it("renders one button per source", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    const buttons = el.querySelectorAll(".widget-sub-tab");
    expect(buttons.length).toBe(3);
    expect(buttons[0].textContent).toBe("Alpha");
    expect(buttons[1].textContent).toBe("Beta");
    expect(buttons[2].textContent).toBe("Gamma");
  });

  it("marks only the initial index as active", () => {
    const el = buildSubTabs(SOURCES, 1, () => {}, CONFIG);
    const buttons = el.querySelectorAll(".widget-sub-tab");
    expect(buttons[0].classList.contains("is-active")).toBe(false);
    expect(buttons[1].classList.contains("is-active")).toBe(true);
    expect(buttons[2].classList.contains("is-active")).toBe(false);
  });

  it("sets aria-selected on the initial active button", () => {
    const el = buildSubTabs(SOURCES, 1, () => {}, CONFIG);
    const buttons = el.querySelectorAll(".widget-sub-tab");
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");
    expect(buttons[0].getAttribute("aria-selected")).toBe("false");
  });

  it("fires the callback with the correct index on click", () => {
    const onChange = vi.fn();
    const el = buildSubTabs(SOURCES, 0, onChange, CONFIG);
    el.querySelectorAll(".widget-sub-tab")[2].click();
    expect(onChange).toHaveBeenCalledWith(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("moves is-active class to the clicked button", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    const buttons = el.querySelectorAll(".widget-sub-tab");
    buttons[1].click();
    expect(buttons[0].classList.contains("is-active")).toBe(false);
    expect(buttons[1].classList.contains("is-active")).toBe(true);
  });

  it("updates aria-selected when a button is clicked", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    const buttons = el.querySelectorAll(".widget-sub-tab");
    buttons[2].click();
    expect(buttons[2].getAttribute("aria-selected")).toBe("true");
    expect(buttons[0].getAttribute("aria-selected")).toBe("false");
  });

  it("renders the config label", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    expect(el.querySelector(".widget-label")?.textContent).toBe("Metric");
  });

  it("omits the label element when config has no label", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, { type: "sub-tabs" });
    expect(el.querySelector(".widget-label")).toBeNull();
  });

  it("has the tablist role on the button bar", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    expect(el.querySelector(".widget-sub-tabs-bar")?.getAttribute("role")).toBe("tablist");
  });

  it("has the tab role on each button", () => {
    const el = buildSubTabs(SOURCES, 0, () => {}, CONFIG);
    for (const btn of el.querySelectorAll(".widget-sub-tab")) {
      expect(btn.getAttribute("role")).toBe("tab");
    }
  });
});
