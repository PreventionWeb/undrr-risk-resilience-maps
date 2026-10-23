/** Recorded public provider contracts, 2026-10-23. No network access. */
import views from "../../tests/fixtures/legends/mapx-views.json";
import rasters from "../../tests/fixtures/legends/geoserver.json";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TABS } from "../config/layers.js";
import { resolveParsedMapXLegend } from "./legends.js";
import { resolveCustomMapXLegend } from "./custom-legends.js";
import { getGeoServerLegendJsonUrl, parseGeoServerRasterLegend } from "./raster-legends.js";

describe("configured legend coverage", () => {
  it("renders every configured MapX source from recorded authoritative styles", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const sources = TABS.flatMap((tab) => tab.layers.flatMap((layer) => layer.sources ?? [layer])).filter(
        (source) => source.id,
      );
      expect(sources).toHaveLength(68);
      for (const source of sources) {
        const view = views.find((candidate) => candidate.id === source.id);
        expect(view, source.id).toBeDefined();
        let legend;
        if (view.type === "rt") {
          expect(getGeoServerLegendJsonUrl(view.data.source.legend), source.id).toBeTruthy();
          legend = parseGeoServerRasterLegend(rasters[source.id]);
        } else if (view.type === "cc") {
          legend = (await resolveCustomMapXLegend(view)).legend;
        } else legend = resolveParsedMapXLegend(view).legend;
        expect(legend, source.id).toBeTruthy();
        expect(legend.entries.length || legend.groups?.length || legend.matrix, source.id).toBeTruthy();
      }
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
