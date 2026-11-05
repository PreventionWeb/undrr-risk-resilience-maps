import { describe, expect, it } from "vitest";
import {
  LARGE_DOWNLOAD_BYTES,
  REGION_CODE_SOURCES,
  isValidCsvDownload,
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
  it("offers a CSV only for a published vector view marked yes", () => {
    expect(isCsvEligible(vector({ csvDownload: "yes" }))).toBe(true);
    // Not reviewed (blank or missing) or refused: no CSV.
    expect(isCsvEligible(vector())).toBe(false);
    expect(isCsvEligible(vector({ csvDownload: "" }))).toBe(false);
    expect(isCsvEligible(vector({ csvDownload: "no: Not region-level." }))).toBe(false);
    // Marked yes, but not a published vector view.
    for (const overrides of [
      { type: "rt" },
      { type: "cc" },
      { status: "disabled-pending-removal" },
      { external: { provider: "x" } },
      { id: null },
    ]) {
      expect(isCsvEligible(vector({ csvDownload: "yes", ...overrides })), JSON.stringify(overrides)).toBe(
        false,
      );
    }
  });

  it("reads a compound layer's decision from the source, not the layer", () => {
    const layer = vector({
      id: null,
      csvDownload: "yes",
      sources: [{ id: "MX-S1" }, { id: "MX-S2", csvDownload: "yes" }],
    });
    expect(isCsvEligible(layer, layer.sources[0])).toBe(false);
    expect(isCsvEligible(layer, layer.sources[1])).toBe(true);
  });

  it("accepts yes, no: <reason> and blank as decisions", () => {
    for (const value of [undefined, "", "yes", "no: Not region-level."])
      expect(isValidCsvDownload(value)).toBe(true);
    for (const value of ["Yes", "no", "no:", "true", 1]) expect(isValidCsvDownload(value)).toBe(false);
  });
});

/**
 * Invariants of the configured downloads, not counts: GRID adding a file or
 * the inventory marking another view must not need a test edit.
 */
describe("the configured downloads", () => {
  it("link only hosted GeoTIFFs, on raster views", () => {
    const withFiles = publishedViews().filter(
      ([layer, source]) => getViewDownloads(layer, source).files.length,
    );
    expect(withFiles.length).toBeGreaterThan(0);
    for (const [layer, source] of withFiles) {
      expect(layer.type).toBe("rt");
      for (const file of getViewDownloads(layer, source).files) {
        expect(file.url).toMatch(/^https:\/\/gar-data\.unepgrid\.ch\/[\w./-]+\.tif$/);
        expect(file.format).toBe("GeoTIFF");
        expect(Number.isSafeInteger(file.bytes) && file.bytes > 0).toBe(true);
      }
    }
  });

  it("never link the misspelt 475-year PGA file from the supplied list", () => {
    const urls = publishedViews().flatMap(([l, s]) => getViewDownloads(l, s).files.map((f) => f.url));
    expect(urls.some((url) => url.includes("PGA_450y"))).toBe(false);
  });

  it("offer CSVs only for vector views, and give every refusal a reason", () => {
    const views = publishedViews();
    expect(views.some(([layer, source]) => getViewDownloads(layer, source).csv)).toBe(true);
    for (const [layer, source] of views) {
      const view = source ?? layer;
      if (view.csvDownload === "yes") expect(layer.type, view.id).toBe("vt");
      if (view.csvDownload?.startsWith("no")) expect(view.csvDownload, view.id).toMatch(/^no: \S/);
    }
  });

  it("borrow region codes only for CSV views", () => {
    const yes = new Set(
      publishedViews()
        .filter(([layer, source]) => getViewDownloads(layer, source).csv)
        .map(([layer, source]) => (source ?? layer).id),
    );
    for (const [view, sibling] of REGION_CODE_SOURCES) {
      expect(view).not.toBe(sibling);
      // A view that is no longer in the config (or no longer yes) simply never
      // asks for codes; only a configured CSV view needs its sibling.
      if (yes.has(view)) expect(typeof sibling).toBe("string");
    }
  });

  it("report whether any view of a layer has a download", () => {
    const layers = TABS.flatMap((tab) => tab.layers);
    expect(layerHasDownloads(layers.find((l) => l.key === "earthquake-pga"))).toBe(true);
    expect(layerHasDownloads(layers.find((l) => l.key === "fatalities-gem"))).toBe(false);
    expect(layerHasDownloads(layers.find((l) => l.key === "drought"))).toBe(false);
  });
});
