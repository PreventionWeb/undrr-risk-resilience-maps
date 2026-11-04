import { describe, expect, it } from "vitest";
import { downloadListHtml, sourcesRowDownloadsHtml } from "./download-links.js";

function render(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

const group = {
  id: "MX-GROUP",
  key: "group",
  label: "Group",
  type: "rt",
  downloads: [
    ["https://gar-data.unepgrid.ch/2026/first.tif", 333_771_240],
    ["https://gar-data.unepgrid.ch/2026/second.tif", 44_824_306],
  ],
};

describe("downloadListHtml", () => {
  it("lists every hosted file of a view with its own name, format and size", () => {
    const links = [...render(downloadListHtml(group)).querySelectorAll("a")];
    expect(links.map((link) => [link.getAttribute("download"), link.textContent.trim()])).toEqual([
      ["first.tif", "Download first.tif (GeoTIFF, 333.8 MB)"],
      ["second.tif", "Download second.tif (GeoTIFF, 44.8 MB)"],
    ]);
    // Under 1 GB: no warning.
    expect(render(downloadListHtml(group)).querySelector(".layer-downloads__warning")).toBeNull();
  });

  it("draws nothing for a view without downloads or an unpublished layer", () => {
    expect(downloadListHtml({ id: "MX-1", key: "k", label: "L", type: "cc" })).toBe("");
    expect(downloadListHtml({ ...group, status: "disabled-pending-removal" })).toBe("");
  });

  it("escapes what it writes", () => {
    const html = downloadListHtml({
      ...group,
      downloads: [['https://example.org/a"b.tif', 10]],
    });
    expect(html).not.toContain('a"b');
    expect(render(html).querySelector("a").getAttribute("download")).toBe('a"b.tif');
  });
});

describe("sourcesRowDownloadsHtml", () => {
  it("names each compound source before its controls", () => {
    const layer = {
      id: null,
      key: "compound",
      label: "Compound",
      type: "vt",
      sources: [
        { id: "MX-S1", label: "First" },
        { id: "MX-S2", label: "Second" },
      ],
    };
    const host = render(sourcesRowDownloadsHtml(layer));
    expect([...host.querySelectorAll(".layer-downloads__source")].map((el) => el.textContent)).toEqual([
      "First:",
      "Second:",
    ]);
    expect([...host.querySelectorAll("[data-action='download-csv']")].map((el) => el.dataset.viewId)).toEqual(
      ["MX-S1", "MX-S2"],
    );
  });
});
