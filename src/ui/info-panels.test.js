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

  describe("prototype downloads", () => {
    it("adds nothing without the flag: no Download column, no download links, every request link kept", () => {
      const panel = buildSourcesPanel();
      expect(panel.querySelector(".data-table__downloads")).toBeNull();
      expect(panel.querySelector(".layer-downloads")).toBeNull();
      expect([...panel.querySelectorAll("thead th")].map((th) => th.textContent)).not.toContain("Download");
      expect(panel.querySelectorAll('a[href^="mailto:"]')).toHaveLength(30);
    });

    it("adds a Download column with the hosted files and CSV buttons", () => {
      const downloads = { handleClick: vi.fn() };
      const panel = buildSourcesPanel({ downloads });
      const headers = [...panel.querySelector("table").querySelectorAll("thead th")];
      expect(headers.at(-1).textContent).toBe("Download");

      // A compound raster layer lists each source's file, named by the source.
      const pga = [...panel.querySelectorAll("tbody tr")].find((row) =>
        row.textContent.includes("Earthquake PGA"),
      );
      const links = [...pga.querySelectorAll("a.layer-downloads__link")];
      expect(links.map((link) => link.getAttribute("download"))).toEqual([
        "PGA_250y.tif",
        "PGA_475y.tif",
        "PGA_975y.tif",
        "PGA_1500y.tif",
        "PGA_2475y.tif",
      ]);
      expect(pga.querySelector(".layer-downloads__source").textContent).toBe("250 yr:");
      expect(pga.querySelectorAll("a[data-large]")).toHaveLength(5);

      // GAR2026 vector maps get a CSV instead of the request email.
      const rice = [...panel.querySelectorAll("tbody tr")].find((row) =>
        row.textContent.includes("Rice AAL (%) – Warming level +2°C"),
      );
      const csv = rice.querySelector("[data-action='download-csv']");
      expect(csv.dataset.viewId).toBe("MX-KU5ID-GHTH8-C2WG3");
      expect(rice.querySelector('a[href^="mailto:"]')).toBeNull();

      csv.click();
      expect(downloads.handleClick).toHaveBeenCalledTimes(1);
    });

    it("gives every download control on the page its own accessible name", () => {
      const panel = buildSourcesPanel({ downloads: { handleClick: vi.fn() } });
      const names = [...panel.querySelectorAll("[data-action='download-csv'], a.layer-downloads__link")].map(
        (el) => el.getAttribute("aria-label"),
      );
      expect(names.length).toBeGreaterThan(80);
      expect(new Set(names).size).toBe(names.length);
      expect(names).toContain("Download CSV: Rice AAL (%) – Warming level +2°C (values per region)");
    });

    it("replaces each GAR2026 request link with that map's CSV", () => {
      // Every GAR2026 map is a region-level vector view today, so none falls
      // back to the email; layer-links.test.js covers the fallback itself.
      const idsOf = (rows) => rows.map((row) => row.querySelector(".data-table__mapx-id").textContent.trim());
      const requested = idsOf(
        [...buildSourcesPanel().querySelectorAll("tbody tr")].filter((row) =>
          row.querySelector('a[href^="mailto:"]'),
        ),
      );
      const panel = buildSourcesPanel({ downloads: { handleClick: vi.fn() } });
      expect(panel.querySelectorAll('a[href^="mailto:"]')).toHaveLength(0);
      const withCsv = idsOf(
        [...panel.querySelectorAll("tbody tr")].filter((row) =>
          row.querySelector("[data-action='download-csv']"),
        ),
      );
      expect(requested).toHaveLength(30);
      for (const id of requested) expect(withCsv).toContain(id);
    });
  });
});
