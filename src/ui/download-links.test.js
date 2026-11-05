import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSV_VIEWS } from "../config/downloads.js";
import { downloadListHtml, sourcesRowDownloadsHtml } from "./download-links.js";

function render(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** What the control shows: its text without the visually hidden part. */
function visibleText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll(".mg-u-sr-only").forEach((hidden) => hidden.remove());
  return copy.textContent.trim();
}

const group = {
  id: "MX-GROUP",
  key: "group",
  label: "Group",
  type: "rt",
  downloads: [
    ["https://gar-data.unepgrid.ch/2026/first.tif", 333_771_240],
    ["https://gar-data.unepgrid.ch/2026/second.tif", 1_444_824_306],
  ],
};

const compound = {
  id: null,
  key: "compound",
  label: "Compound",
  type: "vt",
  sources: [
    { id: "MX-S1", label: "First" },
    { id: "MX-S2", label: "Second" },
  ],
};

beforeAll(() => {
  CSV_VIEWS.add("MX-S1");
  CSV_VIEWS.add("MX-S2");
});
afterAll(() => {
  CSV_VIEWS.delete("MX-S1");
  CSV_VIEWS.delete("MX-S2");
});

describe("downloadListHtml", () => {
  it("lists every hosted file of a view with its own name, format and size", () => {
    const links = [...render(downloadListHtml(group)).querySelectorAll("a")];
    expect(links.map((link) => [link.getAttribute("download"), visibleText(link)])).toEqual([
      ["first.tif", "Download first.tif (GeoTIFF, 333.8 MB)"],
      ["second.tif", "Download second.tif (GeoTIFF, 1.4 GB)"],
    ]);
  });

  it("names each control after its view, starting with the visible words", () => {
    const host = render(downloadListHtml(compound, compound.sources[1]));
    const button = host.querySelector("button");
    expect(visibleText(button)).toBe("Download CSV (values per region)");
    expect(button.getAttribute("aria-label")).toBe("Download CSV: Compound – Second (values per region)");
    const link = render(downloadListHtml(group)).querySelector("a");
    expect(link.getAttribute("aria-label")).toBe("Download first.tif: Group (GeoTIFF, 333.8 MB)");
  });

  it("marks a file over 1 GB for confirmation, with no inline warning", () => {
    const host = render(downloadListHtml(group));
    const [small, large] = host.querySelectorAll("a");
    expect(small.hasAttribute("data-large")).toBe(false);
    expect(large.hasAttribute("data-large")).toBe(true);
    expect(large.hasAttribute("aria-describedby")).toBe(false);
    expect(host.textContent).not.toContain("Over 1 GB");
  });

  it("draws nothing for a view without downloads or an unpublished layer", () => {
    expect(downloadListHtml({ id: "MX-1", key: "k", label: "L", type: "cc" })).toBe("");
    expect(downloadListHtml({ ...group, status: "disabled-pending-removal" })).toBe("");
  });

  it("escapes what it writes", () => {
    const html = downloadListHtml({
      ...group,
      label: "<b>Group</b>",
      downloads: [['https://example.org/a"b.tif', 10]],
    });
    expect(html).not.toContain('a"b');
    expect(html).not.toContain("<b>");
    expect(render(html).querySelector("a").getAttribute("download")).toBe('a"b.tif');
  });
});

describe("sourcesRowDownloadsHtml", () => {
  it("names each compound source before its controls", () => {
    const host = render(sourcesRowDownloadsHtml(compound));
    expect([...host.querySelectorAll(".layer-downloads__source")].map((el) => el.textContent)).toEqual([
      "First:",
      "Second:",
    ]);
    expect([...host.querySelectorAll("[data-action='download-csv']")].map((el) => el.dataset.viewId)).toEqual(
      ["MX-S1", "MX-S2"],
    );
  });
});
