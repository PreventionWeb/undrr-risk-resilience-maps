import { describe, expect, it } from "vitest";

import {
  displayLegendValue,
  isSafeLegendColor,
  isSafeLegendText,
  localizedLegendValue,
} from "./legend-model.js";

describe("legend model validation", () => {
  it.each(["#fff", "#12345678", "rgb(1, 2, 3)", "hsl(120, 50%, 50%)", "transparent"])(
    "accepts supported color %s",
    (color) => {
      expect(isSafeLegendColor(color)).toBe(true);
    },
  );

  it.each(["url(javascript:alert(1))", "var(--secret)", "red\nblue", "x".repeat(65)])(
    "rejects unsafe color %s",
    (color) => {
      expect(isSafeLegendColor(color)).toBe(false);
    },
  );

  it("bounds visible text and rejects control characters", () => {
    expect(isSafeLegendText("Valid label")).toBe(true);
    expect(isSafeLegendText("x".repeat(201))).toBe(false);
    expect(isSafeLegendText("line\nbreak")).toBe(false);
  });

  it("localizes only language-keyed safe values", () => {
    expect(
      localizedLegendValue({ description: "metadata", en: "", fr: "Niveau", de: "x".repeat(201) }, "de"),
    ).toBe("Niveau");
  });

  it("displays finite primitives without coercing objects", () => {
    expect(displayLegendValue(100)).toBe("100");
    expect(displayLegendValue(false)).toBe("false");
    expect(displayLegendValue({ value: 100 })).toBe("");
    expect(displayLegendValue(Number.NaN)).toBe("");
  });
});
