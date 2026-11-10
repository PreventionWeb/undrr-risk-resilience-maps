import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMetricResourcesDialog } from "./metric-resources-dialog.js";

const layer = { key: "sample", label: "Sample metric", note: "Metric notes", citation: "Provider, 2026" };
let modal;
let opener;
beforeEach(() => {
  document.body.innerHTML = '<button type="button">Resources</button>';
  opener = document.querySelector("button");
  opener.focus();
  history.replaceState(null, "", "/#hazard");
});
afterEach(() => {
  modal?.destroy();
  vi.restoreAllMocks();
});

describe("metric resources modal", () => {
  it.each(["", "?downloads=1"])("preserves effective download opt-out over URL setting %s", (search) => {
    history.replaceState(null, "", `/${search}#hazard`);
    modal = createMetricResourcesDialog({ downloads: null });
    modal.open({ layer, opener });
    const url = new URL(modal.element.querySelector('a[aria-label^="View all sources"]').href);
    expect(url.hash).toBe("#sources");
    expect(url.searchParams.get("downloads")).toBe("0");
  });

  it("waits for the map to settle, then refreshes sharing without replacing the metric or focus", () => {
    let share = { pending: true, url: "https://example.org/#hazard", metrics: [] };
    modal = createMetricResourcesDialog({ getMapShare: () => share });
    modal.open({ layer, opener });
    const heading = modal.element.querySelector("h2");
    expect(modal.element.querySelector('[data-action="copy-map-link"]')).toBeNull();
    expect(modal.element.textContent).toContain("The map is updating");
    share = { pending: false, url: "https://example.org/#hazard?layers=sample:1", metrics: [] };
    modal.refreshShare();
    expect(modal.element.querySelector('[data-action="copy-map-link"]')).not.toBeNull();
    expect(modal.element.textContent).toContain("Metric notes");
    expect(modal.element.querySelector("h2")).toBe(heading);
    expect(document.activeElement).toBe(heading);
    const linkedIn = new URL(modal.element.querySelector('a[aria-label="Share on LinkedIn"]').href);
    expect(linkedIn.searchParams.get("url")).toBe(share.url);
  });

  it("handles Escape without propagating it to tools behind the modal", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    modal = createMetricResourcesDialog();
    modal.open({ layer, opener });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    modal.element.querySelector("h2").dispatchEvent(event);
    expect(modal.element.open).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(behind).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    document.removeEventListener("keydown", behind);
  });
});
