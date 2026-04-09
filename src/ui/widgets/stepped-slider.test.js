import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildSteppedSlider } from "./stepped-slider.js";

const SOURCES = [
  { id: "a", label: "250 yr" },
  { id: "b", label: "475 yr" },
  { id: "c", label: "975 yr" },
];
const CONFIG = { type: "stepped-slider", label: "Return period" };
const DEBOUNCE_MS = 200;

describe("buildSteppedSlider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a range input with correct min/max/step", () => {
    const el = buildSteppedSlider(SOURCES, 0, () => {}, CONFIG);
    const slider = el.querySelector("input[type=range]");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("2"); // sources.length - 1
    expect(slider.step).toBe("1");
  });

  it("sets the slider to the initial index", () => {
    const el = buildSteppedSlider(SOURCES, 1, () => {}, CONFIG);
    expect(el.querySelector("input[type=range]").value).toBe("1");
  });

  it("renders a tick label for each source", () => {
    const el = buildSteppedSlider(SOURCES, 0, () => {}, CONFIG);
    const ticks = el.querySelectorAll(".widget-slider-ticks span");
    expect(ticks.length).toBe(3);
    expect(ticks[0].textContent).toBe("250 yr");
    expect(ticks[1].textContent).toBe("475 yr");
    expect(ticks[2].textContent).toBe("975 yr");
  });

  it("fires the callback with the correct index after debounce", () => {
    const onChange = vi.fn();
    const el = buildSteppedSlider(SOURCES, 0, onChange, CONFIG);
    const slider = el.querySelector("input[type=range]");

    slider.value = "2";
    slider.dispatchEvent(new Event("input"));

    expect(onChange).not.toHaveBeenCalled(); // not fired yet
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);
    expect(onChange).toHaveBeenCalledWith(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not fire callback when value is unchanged from initial", () => {
    const onChange = vi.fn();
    const el = buildSteppedSlider(SOURCES, 0, onChange, CONFIG);
    const slider = el.querySelector("input[type=range]");

    slider.value = "0"; // same as initialIndex
    slider.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("debounces rapid events — fires only once for multiple quick inputs", () => {
    const onChange = vi.fn();
    const el = buildSteppedSlider(SOURCES, 0, onChange, CONFIG);
    const slider = el.querySelector("input[type=range]");

    slider.value = "1";
    slider.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(50);

    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(50);

    slider.value = "2";
    slider.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(DEBOUNCE_MS + 1);

    // Only one call, with the final value
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("renders the config label", () => {
    const el = buildSteppedSlider(SOURCES, 0, () => {}, CONFIG);
    expect(el.querySelector(".widget-label")?.textContent).toBe("Return period");
  });

  it("omits the label element when config has no label", () => {
    const el = buildSteppedSlider(SOURCES, 0, () => {}, { type: "stepped-slider" });
    expect(el.querySelector(".widget-label")).toBeNull();
  });

  it("sets aria-label on the range input", () => {
    const el = buildSteppedSlider(SOURCES, 0, () => {}, CONFIG);
    const slider = el.querySelector("input[type=range]");
    expect(slider.getAttribute("aria-label")).toBeTruthy();
  });
});
