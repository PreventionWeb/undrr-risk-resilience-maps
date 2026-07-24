import { describe, expect, it, vi } from "vitest";

import {
  getGeoServerLegendJsonUrl,
  parseGeoServerRasterLegend,
  resolveRasterMapXLegend,
} from "./raster-legends.js";

const earthquakePayload = {
  Legend: [
    {
      layerName: "PGA_250y",
      title: "Peak Ground Acceleration PGA - 250 Years",
      rules: [
        {
          symbolizers: [
            {
              Raster: {
                colormap: {
                  entries: [
                    {
                      label: "0",
                      quantity: "0.1",
                      color: "#808080",
                      opacity: "0.0",
                    },
                    { label: "< 100", quantity: "100", color: "#FFF195" },
                    { label: "100 - 250", quantity: "250", color: "#FFD93D" },
                    { label: "250 - 500", quantity: "500", color: "#FDAE61" },
                    { label: "500 - 1000", quantity: "1000", color: "#D7191C" },
                    { label: "> 1000", quantity: "5000", color: "#5F021F" },
                  ],
                  type: "intervals",
                },
                opacity: "1.0",
              },
            },
          ],
        },
      ],
    },
  ],
};

function rasterView(overrides = {}) {
  return {
    id: "MX-J3YTW-RUQN3-40P87",
    type: "rt",
    data: {
      source: {
        legend:
          "https://giri.unepgrid.ch/geoserver/wms?SERVICE=WMS&REQUEST=GetLegendGraphic&VERSION=1.1.1&LAYER=ingeniar%3APGA_250y&FORMAT=image%2Fpng",
        legendTitles: { en: "cm/s2", fr: "cm/s2" },
      },
    },
    ...overrides,
  };
}

function jsonResponse(payload = earthquakePayload, headers = {}) {
  return {
    ok: true,
    headers: {
      get: (name) =>
        ({
          "content-type": "application/json;charset=UTF-8",
          ...headers,
        })[name.toLowerCase()] ?? null,
    },
    text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

describe("getGeoServerLegendJsonUrl", () => {
  it("preserves the WMS request and replaces a case-insensitive image format", () => {
    const result = new URL(getGeoServerLegendJsonUrl(rasterView().data.source.legend));

    expect(result.searchParams.get("SERVICE")).toBe("WMS");
    expect(result.searchParams.get("REQUEST")).toBe("GetLegendGraphic");
    expect(result.searchParams.get("LAYER")).toBe("ingeniar:PGA_250y");
    expect(result.searchParams.get("FORMAT")).toBeNull();
    expect(result.searchParams.get("format")).toBe("application/json");
  });

  it.each([
    ["static image", "https://example.test/legend.png"],
    ["non-WMS service", "https://example.test/?request=GetLegendGraphic&service=WFS&layer=x"],
    ["missing layer", "https://example.test/?request=GetLegendGraphic&service=WMS"],
    ["unsafe protocol", "javascript:alert(1)"],
  ])("rejects a %s URL", (_name, url) => {
    expect(getGeoServerLegendJsonUrl(url)).toBeNull();
  });
});

describe("parseGeoServerRasterLegend", () => {
  it("normalises the live Earthquake PGA interval schema", () => {
    const legend = parseGeoServerRasterLegend(earthquakePayload, "cm/s2");

    expect(legend.title).toBe("cm/s2");
    expect(legend.entries).toHaveLength(6);
    expect(legend.entries[0]).toEqual({
      color: "#808080",
      label: "0",
      opacity: 0,
      size: null,
      geometry: "polygon",
      borderColor: null,
    });
    expect(legend.entries.at(-1)).toMatchObject({
      color: "#5F021F",
      label: "> 1000",
      opacity: 1,
    });
  });

  it("uses the provider title and quantity labels when MapX labels are absent", () => {
    const payload = structuredClone(earthquakePayload);
    delete payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[1].label;

    const legend = parseGeoServerRasterLegend(payload);

    expect(legend.title).toBe("Peak Ground Acceleration PGA - 250 Years");
    expect(legend.entries[1].label).toBe("100");
  });

  it("composes raster and entry opacity", () => {
    const payload = structuredClone(earthquakePayload);
    const raster = payload.Legend[0].rules[0].symbolizers[0].Raster;
    raster.opacity = "0.5";
    raster.colormap.entries[1].opacity = "0.4";

    expect(parseGeoServerRasterLegend(payload).entries[1].opacity).toBe(0.2);
  });

  it.each([
    [
      "continuous ramps",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.type = "ramp";
      },
    ],
    [
      "unsafe colours",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[0].color =
          "url(javascript:alert(1))";
      },
    ],
    [
      "invalid opacity",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.opacity = "2";
      },
    ],
    [
      "multiple symbolizers",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers.push({ Raster: {} });
      },
    ],
    [
      "excessive entry counts",
      (payload) => {
        payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries = Array.from(
          { length: 501 },
          () => ({ color: "#fff", label: "value" }),
        );
      },
    ],
  ])("rejects %s so MapX's image remains authoritative", (_name, change) => {
    const payload = structuredClone(earthquakePayload);
    change(payload);
    expect(parseGeoServerRasterLegend(payload)).toBeNull();
  });
});

describe("resolveRasterMapXLegend", () => {
  it("requests JSON and uses the localized MapX legend title", async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse());

    const resolution = await resolveRasterMapXLegend(rasterView(), "fr", request);

    expect(resolution.legend).toMatchObject({ title: "cm/s2" });
    expect(resolution.reason).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(new URL(url).searchParams.get("format")).toBe("application/json");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(options.credentials).toBe("omit");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["an HTTP failure", { ok: false, headers: { get: () => null } }, "raster-json-unavailable"],
    [
      "a non-JSON response",
      jsonResponse(earthquakePayload, { "content-type": "image/png" }),
      "raster-json-invalid",
    ],
    [
      "an oversized response",
      jsonResponse(earthquakePayload, { "content-length": String(256 * 1024 + 1) }),
      "raster-json-invalid",
    ],
    ["an unsupported colormap", jsonResponse({ Legend: [] }), "raster-json-unsupported"],
  ])("falls back for %s", async (_name, response, reason) => {
    const resolution = await resolveRasterMapXLegend(rasterView(), "en", vi.fn().mockResolvedValue(response));
    expect(resolution).toEqual({ legend: null, reason });
  });

  it("falls back when CORS or the network blocks the request", async () => {
    const resolution = await resolveRasterMapXLegend(
      rasterView(),
      "en",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    expect(resolution).toEqual({ legend: null, reason: "raster-json-unavailable" });
  });

  it("does not fetch a non-GetLegendGraphic raster source", async () => {
    const request = vi.fn();
    const view = rasterView();
    view.data.source.legend = "https://example.test/legend.png";

    await expect(resolveRasterMapXLegend(view, "en", request)).resolves.toEqual({
      legend: null,
      reason: "raster",
    });
    expect(request).not.toHaveBeenCalled();
  });
});
