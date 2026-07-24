import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEDRAGeoJSON, createEDRAView, deleteEDRAView, resetEDRACaches } from "./edra-agriculture.js";

const GEOMETRY_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "XY01", name_eng: "Example region" },
      geometry: {
        type: "Polygon",
        crs: { type: "name", properties: { name: "EPSG:3035" } },
        coordinates: [
          [
            [4321000, 3210000],
            [4322000, 3210000],
            [4321000, 3211000],
            [4321000, 3210000],
          ],
        ],
      },
    },
  ],
};

const VALUES_RESPONSE = [
  {
    region_id: "XY01",
    value_current: "2.345",
    value_15: "3.456",
    value_20: "4.567",
    value_30: "5.678",
    value_his: "1.234",
  },
];

function jsonResponse(data) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(structuredClone(data)),
  });
}

beforeEach(() => {
  resetEDRACaches();
  vi.stubGlobal(
    "fetch",
    vi.fn((url) =>
      String(url).includes("wfsService") ? jsonResponse(GEOMETRY_RESPONSE) : jsonResponse(VALUES_RESPONSE),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildEDRAGeoJSON", () => {
  it("reprojects EPSG:3035 geometry and joins the selected crop scenario", async () => {
    const data = await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "20" });
    const feature = data.features[0];

    expect(feature.geometry.coordinates[0][0][0]).toBeCloseTo(10, 5);
    expect(feature.geometry.coordinates[0][0][1]).toBeCloseTo(52, 5);
    expect(feature.geometry.crs).toBeUndefined();
    expect(feature.properties).toEqual({
      region: "Example region",
      nuts_2_code: "XY01",
      crop: "Wheat",
      climate_scenario: "+2 °C",
      yield_reduction_pct: 4.57,
    });
  });

  it("caches geometry and each crop response across scenario changes", async () => {
    await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
    await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "30" });
    await buildEDRAGeoJSON({ crop: "MAIZE", scenario: "30" });

    const geometryCalls = fetch.mock.calls.filter(([url]) => String(url).includes("wfsService"));
    const valueCalls = fetch.mock.calls.filter(([url]) => String(url).includes("dataByBBox"));
    expect(geometryCalls).toHaveLength(1);
    expect(valueCalls).toHaveLength(2);
    expect(String(valueCalls[1][0])).toContain("subsystem=MAIZE");
    expect(String(valueCalls[1][0])).toContain("bbox=-180%2C-90%2C180%2C90%2CEPSG%3A4326");
  });

  it("omits the styled value property when EDRA has no data for a region", async () => {
    const noDataValues = [{ ...VALUES_RESPONSE[0], value_current: null }];
    fetch.mockImplementation((url) =>
      String(url).includes("wfsService") ? jsonResponse(GEOMETRY_RESPONSE) : jsonResponse(noDataValues),
    );

    const data = await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
    expect(data.features[0].properties).not.toHaveProperty("yield_reduction_pct");
  });

  it("evicts a failed crop request so a later attempt can retry", async () => {
    let valueAttempts = 0;
    fetch.mockImplementation((url) => {
      if (String(url).includes("wfsService")) return jsonResponse(GEOMETRY_RESPONSE);
      valueAttempts++;
      return valueAttempts === 1
        ? Promise.reject(new Error("Temporary EDRA failure"))
        : jsonResponse(VALUES_RESPONSE);
    });

    await expect(buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" })).rejects.toThrow(
      "Temporary EDRA failure",
    );
    await expect(buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" })).resolves.toBeTruthy();
    expect(valueAttempts).toBe(2);
  });

  it("rejects schema drift instead of silently rendering a no-data map", async () => {
    const invalidValues = [{ ...VALUES_RESPONSE[0] }];
    delete invalidValues[0].value_20;
    fetch.mockImplementation((url) =>
      String(url).includes("wfsService") ? jsonResponse(GEOMETRY_RESPONSE) : jsonResponse(invalidValues),
    );

    await expect(buildEDRAGeoJSON({ crop: "WHEAT", scenario: "20" })).rejects.toThrow("is missing value_20");
  });

  it("rejects an implausibly low region join coverage", async () => {
    const features = Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(GEOMETRY_RESPONSE.features[0]),
      properties: { code: `XY${String(index).padStart(2, "0")}`, name_eng: `Region ${index}` },
    }));
    const geometry = { type: "FeatureCollection", features };
    fetch.mockImplementation((url) =>
      String(url).includes("wfsService") ? jsonResponse(geometry) : jsonResponse(VALUES_RESPONSE),
    );

    await expect(buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" })).rejects.toThrow(
      "join coverage is only",
    );
  });

  it("times out stalled upstream requests", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );

    const request = buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
    const rejection = expect(request).rejects.toThrow("timed out after 30 seconds");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });
});

describe("createEDRAView", () => {
  it("creates and styles a temporary MapX GeoJSON view", async () => {
    const sdk = {
      ask: vi.fn().mockResolvedValueOnce({ id: "MX-GJ-EXAMPLE" }).mockResolvedValueOnce(true),
    };

    const result = await createEDRAView({ crop: "BARLEY", scenario: "15" }, sdk);

    expect(result).toEqual({
      idView: "MX-GJ-EXAMPLE",
      settings: { crop: "BARLEY", scenario: "15" },
    });
    expect(sdk.ask).toHaveBeenNthCalledWith(
      1,
      "view_geojson_create",
      expect.objectContaining({
        save: false,
        fileType: "geojson",
        title: expect.stringContaining("Barley"),
      }),
    );
    expect(sdk.ask).toHaveBeenNthCalledWith(
      2,
      "view_geojson_set_style",
      expect.objectContaining({
        idView: "MX-GJ-EXAMPLE",
        paint: expect.objectContaining({ "fill-opacity": 0.82 }),
      }),
    );
  });
});

describe("deleteEDRAView", () => {
  it("falls back to hiding a temporary view when full deletion fails", async () => {
    const sdk = {
      ask: vi.fn().mockRejectedValueOnce(new Error("delete failed")).mockResolvedValueOnce(true),
    };

    await expect(deleteEDRAView("MX-GJ-EXAMPLE", sdk)).resolves.toBe(true);
    expect(sdk.ask).toHaveBeenNthCalledWith(1, "view_geojson_delete", {
      idView: "MX-GJ-EXAMPLE",
    });
    expect(sdk.ask).toHaveBeenNthCalledWith(2, "view_remove", {
      idView: "MX-GJ-EXAMPLE",
    });
  });
});
