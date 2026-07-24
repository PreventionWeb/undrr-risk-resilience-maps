import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEDRAGeoJSON, createEDRAView, resetEDRAGeometryCache } from "./edra-agriculture.js";

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
  resetEDRAGeometryCache();
  vi.stubGlobal(
    "fetch",
    vi.fn((url) =>
      String(url).includes("wfsService") ? jsonResponse(GEOMETRY_RESPONSE) : jsonResponse(VALUES_RESPONSE),
    ),
  );
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

  it("caches geometry while fetching fresh values for each variant", async () => {
    await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
    await buildEDRAGeoJSON({ crop: "MAIZE", scenario: "30" });

    const geometryCalls = fetch.mock.calls.filter(([url]) => String(url).includes("wfsService"));
    const valueCalls = fetch.mock.calls.filter(([url]) => String(url).includes("dataByBBox"));
    expect(geometryCalls).toHaveLength(1);
    expect(valueCalls).toHaveLength(2);
    expect(String(valueCalls[1][0])).toContain("subsystem=MAIZE");
    expect(String(valueCalls[1][0])).toContain("EPSG%3A3035");
  });

  it("omits the styled value property when EDRA has no data for a region", async () => {
    fetch.mockImplementation((url) =>
      String(url).includes("wfsService") ? jsonResponse(GEOMETRY_RESPONSE) : jsonResponse([]),
    );

    const data = await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
    expect(data.features[0].properties).not.toHaveProperty("yield_reduction_pct");
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
