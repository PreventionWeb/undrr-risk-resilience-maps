import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/export-layers.js", () => ({ downloadLayerInventory: vi.fn() }));

import { buildSourcesPanel } from "./info-panels.js";

describe("buildSourcesPanel", () => {
  it("gives each GAR2026 map its own note, ID and data-request context", () => {
    const panel = buildSourcesPanel();
    const rows = [...panel.querySelectorAll("tbody tr")].filter((row) =>
      row.querySelector('a[href^="mailto:"]'),
    );
    expect(rows).toHaveLength(30);
    const rice = rows.find((row) => row.textContent.includes("Rice AAL (%) – Warming level +2°C"));
    expect(rice.textContent).toContain("MX-KU5ID-GHTH8-C2WG3");
    expect(rice.textContent).toContain("under a +2°C warming level");
    const request = new URL(rice.querySelector('a[href^="mailto:"]').href);
    expect(request.searchParams.get("body")).toContain("Map title: Rice AAL (%) – Warming level +2°C");
    expect(request.searchParams.get("body")).toContain("#gar?layers=gar26-aal-crops:7");
  });
  it("hides metrics under development by default, shows them via the toggle", () => {
    const panel = buildSourcesPanel();
    const firstCategory = panel.querySelector(".sources-category-section");
    const planned = firstCategory.querySelector("details.sources-planned");
    const toggle = panel.querySelector("[data-action='toggle-planned']");

    expect(planned).not.toBeNull();
    expect(toggle).not.toBeNull();
    // Hidden by default (CSS class absent).
    expect(panel.classList.contains("show-planned")).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    expect(panel.classList.contains("show-planned")).toBe(true);

    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(panel.classList.contains("show-planned")).toBe(false);
  });

  it("renders a Mangrove on-this-page-nav that links to each category section", () => {
    const panel = buildSourcesPanel();
    const ids = [...panel.querySelectorAll(".sources-category-section")].map((section) => section.id);
    const hrefs = [...panel.querySelectorAll(".mg-on-this-page-nav__link")].map((link) =>
      link.getAttribute("href").slice(1),
    );
    expect(hrefs).toEqual(ids);
    // Uses the correct Mangrove container hook for the JS module to enhance.
    expect(panel.querySelector("[data-mg-on-this-page-nav]")).not.toBeNull();
    expect(panel.querySelector("[data-mg-on-this-page-nav-skip-auto-init]")).not.toBeNull();
  });

  it("preserves native modified-click behavior for category links", () => {
    const panel = buildSourcesPanel();
    const link = panel.querySelector(".mg-on-this-page-nav__link");
    const enhancedHandler = vi.fn();
    panel.querySelector("[data-mg-on-this-page-nav]").addEventListener("click", enhancedHandler);
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(enhancedHandler).not.toHaveBeenCalled();
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
    // Scenario-specific notes expand compound layers into individual source rows.
    const floodDepth = idCells.find((cell) => cell.textContent === "MX-V07LO-829XA-4BIZ8");
    expect(floodDepth.closest("tr").textContent).toContain("modelled river flood depth");
    expect(floodDepth.querySelector("br")).toBeNull();
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

  it("keeps download controls out of Sources even when supplied a download handler", () => {
    const panel = buildSourcesPanel({ downloads: { handleClick: vi.fn() } });
    expect(
      panel.querySelector(".data-table__downloads, .layer-downloads, [data-action='download-csv']"),
    ).toBeNull();
    expect([...panel.querySelectorAll("thead th")].map((th) => th.textContent)).not.toContain("Download");
    expect(panel.querySelectorAll('a[href^="mailto:"]')).toHaveLength(30);
    expect(panel.querySelector('[data-action="download-inventory"]')).not.toBeNull();
  });

  it("links published dataset names to the correct viewer tab and source", () => {
    const panel = buildSourcesPanel();
    const links = [...panel.querySelectorAll("a.sources-map-link")];
    expect(links.length).toBeGreaterThan(30);
    expect(
      panel.querySelector('#sources-hazard a[href="#hazard?layers=landslides"]')?.getAttribute("href"),
    ).toBe("#hazard?layers=landslides");
    expect(links.find((link) => link.textContent === "Poorest: Earthquake").getAttribute("href")).toBe(
      "#risk-resilience?layers=recovery-speed",
    );
    expect(
      links.find((link) => link.textContent === "Rice AAL (%) – Warming level +2°C").getAttribute("href"),
    ).toBe("#gar?layers=gar26-aal-crops:7");
    expect(panel.querySelector(".sources-planned .sources-map-link")).toBeNull();
  });
});
