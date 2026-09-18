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

  it("renders MapX IDs in Mangrove's code cell, not badge chips or a <code> element", () => {
    const panel = buildSourcesPanel();
    const idCells = [...panel.querySelectorAll("td.data-table__mapx-id")];

    expect(idCells.length).toBeGreaterThan(0);
    for (const cell of idCells) expect(cell.classList.contains("mg-table__td--code")).toBe(true);
    // The utility styles the cell, so the ids carry no element of their own.
    expect(panel.querySelector(".data-table__mapx-id code")).toBeNull();
    expect(panel.querySelector(".data-table__mapx-id .mg-badge")).toBeNull();
    // A compound layer still lists one id per line.
    expect(idCells.some((cell) => cell.querySelector("br"))).toBe(true);
    expect(idCells.some((cell) => /^MX-/.test(cell.textContent.trim()))).toBe(true);
  });

  it("builds the sources table from Mangrove's data-table utilities", () => {
    const panel = buildSourcesPanel();
    const region = panel.querySelector(".data-table-wrap");

    // The scroll region keeps its accessible contract.
    expect(region.classList.contains("mg-table-scroll-region")).toBe(true);
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("aria-label")).toBe("Dataset sources table");

    const table = region.querySelector("table");
    expect(table.classList.contains("mg-table")).toBe(true);
    expect(table.classList.contains("mg-table--data")).toBe(true);

    // Every header cell is a sticky column header. Sorting is not adopted: the
    // utility's sortable header needs a script we do not ship.
    const headers = [...table.querySelectorAll("thead th")];
    expect(headers).toHaveLength(6);
    for (const th of headers) {
      expect(th.getAttribute("scope")).toBe("col");
      expect(th.classList.contains("mg-table__th--sticky")).toBe(true);
    }
    expect(table.querySelector(".mg-table__th--sortable")).toBeNull();
    expect(table.querySelector("[aria-sort]")).toBeNull();
  });
});
