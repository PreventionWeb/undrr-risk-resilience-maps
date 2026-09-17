import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/export-layers.js", () => ({ downloadLayerInventory: vi.fn() }));

import { buildSourcesPanel } from "./info-panels.js";

describe("buildSourcesPanel", () => {
  it("shows published data before collapsed metrics under development", () => {
    const panel = buildSourcesPanel();
    const firstCategory = panel.querySelector(".info-page-section--wide");
    const availableHeading = firstCategory.querySelector(".info-source-subtitle");
    const planned = firstCategory.querySelector("details.sources-planned");

    expect(availableHeading.textContent).toBe("Available data");
    expect(planned).not.toBeNull();
    expect(planned.open).toBe(false);
    expect(firstCategory.compareDocumentPosition(planned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps source URLs clickable for published datasets", () => {
    const panel = buildSourcesPanel();
    const sourceLink = panel.querySelector(
      'a[href="https://drought.emergency.copernicus.eu/tumbo/edra/explore"]',
    );
    expect(sourceLink).not.toBeNull();
    expect(sourceLink.target).toBe("_blank");
  });

  it("marks planned rows with a Mangrove status label", () => {
    const panel = buildSourcesPanel();
    const labels = [...panel.querySelectorAll(".data-table__row--planned .mg-status-label")];

    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.querySelector(".mg-status-label__indicator")).not.toBeNull();
      expect(label.className).toMatch(/mg-status-label--(waiting-information|negative|draft)/);
    }
    const awaiting = labels.find((label) => label.textContent.trim() === "Awaiting data");
    expect(awaiting.classList.contains("mg-status-label--waiting-information")).toBe(true);
  });

  it("renders MapX IDs as plain code, not badge chips", () => {
    const panel = buildSourcesPanel();
    const codes = panel.querySelectorAll(".data-table__mapx-id code");

    expect(codes.length).toBeGreaterThan(0);
    expect(panel.querySelector(".data-table__mapx-id .mg-badge")).toBeNull();
  });
});
