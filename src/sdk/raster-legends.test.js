import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGeoServerLegendJsonUrl,
  getMapXMirrorUrl,
  parseGeoServerRasterLegend,
  resetRasterLegendCache,
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

function streamedResponse(body, { status = 200, headers = {}, chunks = null } = {}) {
  const encodedChunks = chunks ?? [new TextEncoder().encode(body)];
  let index = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) =>
        ({
          "content-type": "application/json;charset=UTF-8",
          ...headers,
        })[name.toLowerCase()] ?? null,
    },
    body: {
      getReader: () => ({
        read: vi
          .fn()
          .mockImplementation(async () =>
            index < encodedChunks.length
              ? { done: false, value: encodedChunks[index++] }
              : { done: true, value: undefined },
          ),
        cancel,
      }),
    },
    cancel,
  };
}

function jsonResponse(payload = earthquakePayload, options = {}) {
  return streamedResponse(JSON.stringify(payload), options);
}

beforeEach(() => {
  resetRasterLegendCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    [
      "unapproved provider",
      "https://example.test/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=x",
    ],
    [
      "insecure approved provider",
      "http://giri.unepgrid.ch/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=x",
    ],
    [
      "provider URL credentials",
      "https://user:secret@giri.unepgrid.ch/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=x",
    ],
    [
      "nonstandard provider port",
      "https://giri.unepgrid.ch:8443/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=x",
    ],
    [
      "unapproved provider path",
      "https://giri.unepgrid.ch/redirect?service=WMS&request=GetLegendGraphic&layer=ingeniar%3APGA_250y",
    ],
    [
      "unknown provider query",
      "https://giri.unepgrid.ch/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=ingeniar%3APGA_250y&redirect=https%3A%2F%2Fexample.test",
    ],
    [
      "duplicate critical query",
      "https://giri.unepgrid.ch/geoserver/wms?service=WMS&request=GetLegendGraphic&REQUEST=GetMap&layer=ingeniar%3APGA_250y",
    ],
    [
      "unapproved provider layer",
      "https://giri.unepgrid.ch/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=other%3Alayer",
    ],
  ])("rejects a %s URL", (_name, url) => {
    expect(getGeoServerLegendJsonUrl(url)).toBeNull();
  });
});

describe("getMapXMirrorUrl", () => {
  it("encodes the complete provider URL as one mirror parameter", () => {
    const providerUrl = getGeoServerLegendJsonUrl(rasterView().data.source.legend);
    const mirrorUrl = new URL(getMapXMirrorUrl(providerUrl));

    expect(mirrorUrl.origin).toBe("https://api.mapx.org");
    expect(mirrorUrl.pathname).toBe("/get/mirror");
    expect(mirrorUrl.searchParams.get("url")).toBe(providerUrl);
  });

  it("rejects unapproved providers and invalid mirror endpoints", () => {
    expect(
      getMapXMirrorUrl("https://example.test/geoserver/wms?service=WMS&request=GetLegendGraphic&layer=x"),
    ).toBeNull();
    expect(
      getMapXMirrorUrl(
        getGeoServerLegendJsonUrl(rasterView().data.source.legend),
        "http://api.mapx.org/get/mirror",
      ),
    ).toBeNull();
    expect(
      getMapXMirrorUrl(
        getGeoServerLegendJsonUrl(rasterView().data.source.legend),
        "https://example.test/get/mirror",
      ),
    ).toBeNull();
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

  it("rejects object quantities instead of rendering an object coercion", () => {
    const payload = structuredClone(earthquakePayload);
    const entry = payload.Legend[0].rules[0].symbolizers[0].Raster.colormap.entries[1];
    delete entry.label;
    entry.quantity = { value: 100 };

    expect(parseGeoServerRasterLegend(payload)).toBeNull();
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
    expect(resolution.transport).toBe("direct");
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(new URL(url).searchParams.get("format")).toBe("application/json");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(options.credentials).toBe("omit");
    expect(options.redirect).toBe("error");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches a successful default-transport resolution for the page session", async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal("fetch", request);

    const first = await resolveRasterMapXLegend(rasterView());
    const second = await resolveRasterMapXLegend(rasterView());

    expect(first.legend).toBeTruthy();
    expect(second).toBe(first);
    expect(request).toHaveBeenCalledOnce();
  });

  it("retries through the MapX mirror when the provider rejects the viewer origin", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403, headers: { get: () => null } })
      .mockResolvedValueOnce(jsonResponse());

    const resolution = await resolveRasterMapXLegend(rasterView(), "en", request);

    expect(resolution.legend).toMatchObject({ title: "cm/s2" });
    expect(resolution.transport).toBe("mapx-mirror");
    expect(request).toHaveBeenCalledTimes(2);
    const directUrl = request.mock.calls[0][0];
    const mirrorUrl = new URL(request.mock.calls[1][0]);
    expect(mirrorUrl.origin).toBe("https://api.mapx.org");
    expect(mirrorUrl.pathname).toBe("/get/mirror");
    expect(mirrorUrl.searchParams.get("url")).toBe(directUrl);
  });

  it.each([
    ["an HTTP failure", streamedResponse("", { status: 500 }), "raster-json-unavailable"],
    [
      "a non-JSON response",
      jsonResponse(earthquakePayload, { headers: { "content-type": "image/png" } }),
      "raster-json-invalid",
    ],
    [
      "an oversized response",
      jsonResponse(earthquakePayload, {
        headers: { "content-length": String(256 * 1024 + 1) },
      }),
      "raster-json-invalid",
    ],
    ["an unsupported colormap", jsonResponse({ Legend: [] }), "raster-json-unsupported"],
  ])("falls back for %s", async (_name, response, reason) => {
    const resolution = await resolveRasterMapXLegend(rasterView(), "en", vi.fn().mockResolvedValue(response));
    expect(resolution).toMatchObject({ legend: null, reason });
  });

  it("falls back when CORS or the network blocks the request", async () => {
    const request = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const resolution = await resolveRasterMapXLegend(rasterView(), "en", request);
    expect(resolution).toMatchObject({
      legend: null,
      reason: "raster-json-unavailable",
      diagnostic: {
        transport: "direct",
        failureKind: "network",
      },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([404, 429, 500])("does not mirror a permanent or rate-limited HTTP %s", async (status) => {
    const request = vi.fn().mockResolvedValue(streamedResponse("", { status }));

    const resolution = await resolveRasterMapXLegend(rasterView(), "en", request);

    expect(resolution).toMatchObject({
      legend: null,
      reason: "raster-json-unavailable",
      diagnostic: { transport: "direct", failureKind: "http", status },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("stops reading an oversized streamed body without relying on Content-Length", async () => {
    const first = new Uint8Array(256 * 1024);
    const response = streamedResponse("", {
      chunks: [first, new Uint8Array([1])],
    });

    const resolution = await resolveRasterMapXLegend(rasterView(), "en", vi.fn().mockResolvedValue(response));

    expect(resolution).toMatchObject({
      legend: null,
      reason: "raster-json-invalid",
      diagnostic: { transport: "direct", failureKind: "body-too-large" },
    });
    expect(response.cancel).toHaveBeenCalledOnce();
  });

  it("keeps the total timeout active while a response body is stalled", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = {
      ok: true,
      status: 200,
      headers: { get: (name) => (name === "content-type" ? "application/json" : null) },
      body: {
        getReader: () => ({
          read: vi.fn(() => new Promise(() => {})),
          cancel,
        }),
      },
    };

    try {
      const resolutionPromise = resolveRasterMapXLegend(
        rasterView(),
        "en",
        vi.fn().mockResolvedValue(response),
      );
      await vi.advanceTimersByTimeAsync(5000);

      await expect(resolutionPromise).resolves.toMatchObject({
        legend: null,
        reason: "raster-json-invalid",
        diagnostic: { transport: "direct", failureKind: "timeout" },
      });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors an already-aborted caller signal before issuing a request", async () => {
    const request = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const resolution = await resolveRasterMapXLegend(rasterView(), "en", request, {
      signal: controller.signal,
    });

    expect(resolution).toMatchObject({
      legend: null,
      reason: "raster-json-unavailable",
      diagnostic: { transport: "direct", failureKind: "aborted", status: null },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not fetch a non-GetLegendGraphic raster source", async () => {
    const request = vi.fn();
    const view = rasterView();
    view.data.source.legend = "https://example.test/legend.png";

    await expect(resolveRasterMapXLegend(view, "en", request)).resolves.toEqual({
      legend: null,
      reason: "raster",
      diagnostic: { transport: "direct", failureKind: "provider-policy", status: null },
    });
    expect(request).not.toHaveBeenCalled();
  });
});
