/** Representative recorded contracts, 2026-10-23. No network access.
 * Full/current catalogue coverage belongs to the opt-in live audit, not this snapshot. */
import views from "../../tests/fixtures/legends/representative-mapx-views.json";
import rasters from "../../tests/fixtures/legends/representative-geoserver.json";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { resolveCustomMapXLegend } from "./custom-legends.js";
import { getGeoServerLegendJsonUrl, parseGeoServerRasterLegend } from "./raster-legends.js";

describe("representative upstream legend contracts", () => {
  it("accepts recorded discrete, continuous and grouped raster styles", () => {
    for (const view of views.filter((view) => view.type === "rt")) {
      expect(getGeoServerLegendJsonUrl(view.data.source.legend), view.id).toBeTruthy();
      expect(parseGeoServerRasterLegend(rasters[view.id]), view.id).toBeTruthy();
    }
  });
  it("matches the four manually reviewed custom definitions to their recorded source code", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const custom = views.filter((view) => view.type === "cc");
      expect(custom).toHaveLength(4);
      for (const view of custom) expect((await resolveCustomMapXLegend(view)).legend, view.id).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("falls back when a reviewed custom style changes", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      for (const view of views.filter((view) => view.type === "cc")) {
        expect(
          (await resolveCustomMapXLegend({ ...view, data: { methods: view.data.methods + "\n" } })).legend,
        ).toBeNull();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
