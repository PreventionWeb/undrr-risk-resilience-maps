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
  vi.unstubAllGlobals();
});

describe("metric resources modal", () => {
  it("copies the supplied citation with the current settled map URL and refreshes that URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let share = { url: "https://example.org/#hazard?layers=sample:1", pending: false };
    modal = createMetricResourcesDialog({ getMapShare: () => share });
    modal.open({ layer, opener });
    const button = modal.element.querySelector('[data-action="copy-citation-map"]');
    button.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${layer.citation}\n\nMap link: ${share.url}`),
    );
    share = { url: "https://example.org/#hazard?layers=sample:2,other", pending: true };
    modal.refreshShare();
    expect(button.disabled).toBe(true);
    const link = modal.element.querySelector('[data-part="citation-map-link"]');
    expect(link.hidden).toBe(true);
    share = { ...share, pending: false };
    modal.refreshShare();
    expect(button.disabled).toBe(false);
    expect(link.href).toBe(share.url);
    button.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(`${layer.citation}\n\nMap link: ${share.url}`),
    );
  });

  it("supplies the approved dataset citation without page fallback or invented export fields", () => {
    modal = createMetricResourcesDialog();
    modal.open({ layer, opener });
    const cite = modal.element.querySelector("[data-mg-cite-this]");
    expect(cite.dataset.mgCiteThisCitation).toBe(layer.citation);
    expect(cite.dataset.mgCiteThisCopyUrl).toBe("false");
    expect(cite.dataset.mgCiteThisExport).toBe("none");
    expect(cite.querySelector("[data-mg-cite-this-text]").textContent).toBe(layer.citation);
    modal.open({ layer: { ...layer, citation: "Source to be confirmed." }, opener });
    expect(modal.element.querySelector("[data-mg-cite-this]")).toBeNull();
    expect(modal.element.textContent).toContain("Source to be confirmed.");
  });

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
