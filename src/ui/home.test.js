import { describe, expect, it, vi } from "vitest";
import { buildHomePanel } from "./home.js";
import { TABS } from "../config/layers.js";

// The home page's category cards come from the tab config: id and label from
// the tab, the visual from its `card` field. Adding a tab must be one edit.

const cards = (el) => [...el.querySelectorAll(".info-category-card[data-tab]")];

describe("buildHomePanel", () => {
  it("renders a card per tab from the tab's own card field", () => {
    const tabs = [
      { id: "alpha", label: "Alpha", card: { icon: "01", color: "#004f91", desc: "About alpha." } },
      { id: "beta", label: "Beta", card: { icon: "02", color: "#2d7d46", desc: "About beta." } },
    ];

    const el = buildHomePanel({ tabs });

    expect(cards(el).map((card) => card.dataset.tab)).toEqual(["alpha", "beta"]);
    const [alpha] = cards(el);
    expect(alpha.querySelector(".mg-card__title").textContent).toBe("Alpha");
    expect(alpha.querySelector(".mg-card__summary").textContent).toBe("About alpha.");
    expect(alpha.querySelector(".info-category-card__num").textContent).toBe("01");
    expect(alpha.getAttribute("style")).toContain("#004f91");
    expect(alpha.getAttribute("aria-label")).toBe("Explore Alpha");
  });

  it("skips a tab with no card, so a tab can be left off the home grid", () => {
    const tabs = [
      { id: "alpha", label: "Alpha", card: { icon: "01", color: "#004f91", desc: "About alpha." } },
      { id: "hidden", label: "Hidden" },
    ];

    expect(cards(buildHomePanel({ tabs })).map((card) => card.dataset.tab)).toEqual(["alpha"]);
  });

  it("navigates through the callback when a card is clicked", () => {
    const onNavigate = vi.fn();
    const tabs = [{ id: "alpha", label: "Alpha", card: { icon: "01", color: "#004f91", desc: "A." } }];

    cards(buildHomePanel({ tabs, onNavigate }))[0].click();

    expect(onNavigate).toHaveBeenCalledWith("alpha");
  });

  it("stops listening when the caller's signal aborts", () => {
    const onNavigate = vi.fn();
    const listeners = new AbortController();
    const tabs = [{ id: "alpha", label: "Alpha", card: { icon: "01", color: "#004f91", desc: "A." } }];
    const el = buildHomePanel({ tabs, onNavigate, signal: listeners.signal });

    listeners.abort();
    cards(el)[0].click();

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("defaults to the app's tabs, and every one of them carries a card", () => {
    expect(cards(buildHomePanel()).map((card) => card.dataset.tab)).toEqual(TABS.map((tab) => tab.id));
  });
});
