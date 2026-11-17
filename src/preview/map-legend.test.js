import { describe, expect, it, vi } from "vitest";
import { readPreviewLegend } from "./map-legend.js";

const entry = { id: "MX-PREVIEW", source: null, layer: {} };

describe("preview legend adapter", () => {
  it("uses the current structured contract on the supplied map manager", async () => {
    const manager = {
      ask: vi.fn().mockResolvedValue({
        idView: entry.id,
        type: "vt",
        provider: "mapx",
        supported: true,
        data: { geometry: "polygon", title: "% of GDP", rules: [{ color: "#123456", label: "0–1" }] },
      }),
    };
    const legend = await readPreviewLegend(manager, entry);
    expect(legend.title).toBe("% of GDP");
    expect(legend.entries[0]).toMatchObject({ color: "#123456", label: "0–1" });
    expect(manager.ask).toHaveBeenCalledExactlyOnceWith("get_view_legend_json", { idView: entry.id });
  });

  it("keeps image fallback when structured data is unsupported", async () => {
    const manager = {
      ask: vi
        .fn()
        .mockResolvedValueOnce({
          idView: entry.id,
          type: "cc",
          supported: false,
          reason: "unsupported_provider",
        })
        .mockResolvedValueOnce("data:image/png;base64,preview"),
    };
    await expect(readPreviewLegend(manager, entry)).resolves.toEqual({
      image: "data:image/png;base64,preview",
    });
    expect(manager.ask).toHaveBeenLastCalledWith("get_view_legend_image", { idView: entry.id });
  });

  it("preserves explicit local legend definitions without a remote request", async () => {
    const manager = { ask: vi.fn() };
    const entries = [{ color: "#123456", label: "Reviewed class" }];
    await expect(readPreviewLegend(manager, { ...entry, source: { legend: entries } })).resolves.toEqual({
      entries,
    });
    expect(manager.ask).not.toHaveBeenCalled();
  });
});
