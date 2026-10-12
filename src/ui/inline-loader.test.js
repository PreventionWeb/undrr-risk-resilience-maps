import { describe, expect, it } from "vitest";
import { createInlineLoader, setLoadingText } from "./inline-loader.js";

describe("createInlineLoader", () => {
  it("is Mangrove's decorative inline spinner", () => {
    const spinner = createInlineLoader();
    expect(spinner.tagName).toBe("SPAN");
    expect(spinner.className).toBe("mg-loader mg-loader--inline");
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.getAttribute("role")).toBeNull();
    expect(spinner.textContent).toBe("");
  });
});

describe("setLoadingText", () => {
  it("puts a spinner before the text and leaves textContent as the message", () => {
    const el = document.createElement("p");
    el.textContent = "old";
    setLoadingText(el, "Loading Crops…");
    expect(el.firstChild.classList.contains("mg-loader--inline")).toBe(true);
    expect(el.textContent).toBe("Loading Crops…");
    expect(el.querySelectorAll(".mg-loader")).toHaveLength(1);
  });

  it("does not stack spinners when called again", () => {
    const el = document.createElement("p");
    setLoadingText(el, "Loading…");
    setLoadingText(el, "Updating…");
    expect(el.querySelectorAll(".mg-loader")).toHaveLength(1);
    expect(el.textContent).toBe("Updating…");
  });

  it("loses the spinner when the outcome is written with textContent", () => {
    const el = document.createElement("p");
    setLoadingText(el, "Loading…");
    el.textContent = "Could not load.";
    expect(el.querySelector(".mg-loader")).toBeNull();
    el.textContent = "";
    expect(el.childNodes).toHaveLength(0);
  });
});
