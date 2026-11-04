import { describe, expect, it } from "vitest";
import {
  CSV_EXCLUDED_VIEWS,
  CSV_VIEWS,
  LARGE_DOWNLOAD_BYTES,
  REGION_NAME_REFERENCE_VIEW,
  formatBytes,
  getViewDownloads,
  isCsvEligible,
  layerHasDownloads,
  normaliseDownload,
} from "./downloads.js";
import { TABS } from "./layers/index.js";
import { isLayerAvailable } from "./layers/status.js";

const vector = (overrides = {}) => ({ id: "MX-AAAAA", key: "v", label: "V", type: "vt", ...overrides });

/** Every published view in the config, as [layer, source|null]. */
function publishedViews() {
  return TABS.flatMap((tab) => tab.layers)
    .filter((layer) => isLayerAvailable(layer) && !layer.external)
    .flatMap((layer) => (layer.sources?.length ? layer.sources.map((s) => [layer, s]) : [[layer, null]]));
}

describe("formatBytes", () => {
  it("uses decimal units with one decimal place from MB up", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(22_000)).toBe("22 KB");
    expect(formatBytes(10_780_516)).toBe("10.8 MB");
    expect(formatBytes(1_392_370_312)).toBe("1.4 GB");
    expect(formatBytes(3_601_777_774)).toBe("3.6 GB");
  });

  it("moves to the next unit when rounding would reach 1000", () => {
    expect(formatBytes(999_999)).toBe("1.0 MB");
    expect(formatBytes(999_960_000)).toBe("1.0 GB");
  });

  it("returns an empty string for nonsense", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});

describe("normaliseDownload", () => {
  it("never throws on a malformed URL or escape", () => {
    expect(normaliseDownload(["https://example.org/bad%E0%A4%A.tif", 1]).filename).toBe("bad%E0%A4%A.tif");
    expect(normaliseDownload(["not a url/file.tif", 1]).filename).toBe("file.tif");
  });

  it("derives the file name, format and large-file flag", () => {
    expect(normaliseDownload(["https://gar-data.unepgrid.ch/2026/PGA_475y.tif", 1_392_370_312])).toEqual({
      url: "https://gar-data.unepgrid.ch/2026/PGA_475y.tif",
      bytes: 1_392_370_312,
      filename: "PGA_475y.tif",
      format: "GeoTIFF",
      large: true,
    });
    expect(normaliseDownload(["https://example.org/x.tif", LARGE_DOWNLOAD_BYTES]).large).toBe(false);
  });
});

describe("isCsvEligible", () => {
  it("offers a CSV only for allowlisted views, and only while they are published vector views", () => {
    const listed = [...CSV_VIEWS][0];
    expect(isCsvEligible(vector({ id: listed }), listed)).toBe(true);
    // A vector view nobody has reviewed gets no CSV.
    expect(isCsvEligible(vector(), "MX-AAAAA")).toBe(false);
    expect(isCsvEligible(vector({ type: "rt" }), listed)).toBe(false);
    expect(isCsvEligible(vector({ status: "disabled-pending-removal" }), listed)).toBe(false);
    expect(isCsvEligible(vector({ external: { provider: "x" } }), listed)).toBe(false);
    expect(isCsvEligible(vector({ type: "rt" }), "MX-AAAAA")).toBe(false);
    expect(isCsvEligible(vector({ type: "cc" }), "MX-AAAAA")).toBe(false);
    expect(isCsvEligible(vector({ status: "disabled-pending-removal" }), "MX-AAAAA")).toBe(false);
    expect(isCsvEligible(vector({ external: { provider: "x" } }), "MX-AAAAA")).toBe(false);
    expect(isCsvEligible(vector(), null)).toBe(false);
  });

  it("refuses the excluded views", () => {
    for (const id of CSV_EXCLUDED_VIEWS.keys()) expect(isCsvEligible(vector({ id }), id)).toBe(false);
  });
});

describe("the configured downloads", () => {
  it("offer a GeoTIFF for the 20 raster views supplied by GRID, two files for the layer group", () => {
    const withFiles = publishedViews().filter(
      ([layer, source]) => getViewDownloads(layer, source).files.length,
    );
    expect(withFiles).toHaveLength(20);
    for (const [layer, source] of withFiles) {
      expect(layer.type).toBe("rt");
      for (const file of getViewDownloads(layer, source).files) {
        expect(file.url).toMatch(/^https:\/\/gar-data\.unepgrid\.ch\/2026\/[\w.-]+\.tif$/);
        expect(file.format).toBe("GeoTIFF");
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
    const group = TABS.flatMap((tab) => tab.layers).find((layer) => layer.key === "sdg-drought");
    expect(getViewDownloads(group).files.map((file) => file.filename)).toEqual([
      "SDG15_3_1.tif",
      "droughtfreq30.tif",
    ]);
  });

  it("use the corrected 475-year PGA file", () => {
    const urls = publishedViews().flatMap(([l, s]) => getViewDownloads(l, s).files.map((f) => f.url));
    expect(urls).toContain("https://gar-data.unepgrid.ch/2026/PGA_475y.tif");
    expect(urls.some((url) => url.includes("PGA_450y"))).toBe(false);
  });

  it("classify every published vector view: on the CSV allowlist or excluded with a reason", () => {
    const vectorIds = publishedViews()
      .filter(([layer]) => layer.type === "vt")
      .map(([layer, source]) => (source ?? layer).id);
    for (const id of vectorIds) {
      expect(CSV_VIEWS.has(id) !== CSV_EXCLUDED_VIEWS.has(id), `${id} must be in exactly one list`).toBe(
        true,
      );
    }
    // No stale entries either.
    for (const id of CSV_VIEWS) expect(vectorIds, id).toContain(id);
  });

  it("offer a CSV for 69 region-level vector views", () => {
    const csv = publishedViews().filter(([layer, source]) => getViewDownloads(layer, source).csv);
    expect(csv).toHaveLength(69);
    // Every exclusion names a view that exists, so a renamed id cannot slip back in.
    const ids = new Set(publishedViews().map(([layer, source]) => (source ?? layer).id));
    for (const id of CSV_EXCLUDED_VIEWS.keys()) expect(ids.has(id)).toBe(true);
  });

  it("take region names from a published, CSV-eligible view", () => {
    const entry = publishedViews().find(
      ([layer, source]) => (source ?? layer).id === REGION_NAME_REFERENCE_VIEW,
    );
    expect(entry).toBeDefined();
    expect(getViewDownloads(...entry).csv).toBe(true);
  });

  it("report whether any view of a layer has a download", () => {
    const layers = TABS.flatMap((tab) => tab.layers);
    expect(layerHasDownloads(layers.find((l) => l.key === "earthquake-pga"))).toBe(true);
    expect(layerHasDownloads(layers.find((l) => l.key === "fatalities-gem"))).toBe(false);
    expect(layerHasDownloads(layers.find((l) => l.key === "drought"))).toBe(false);
  });
});
