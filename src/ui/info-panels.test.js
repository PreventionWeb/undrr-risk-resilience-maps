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
});
