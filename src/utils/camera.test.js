import { describe, expect, it } from "vitest";
import {
  extentToBounds,
  geojsonBounds,
  MAX_LATITUDE,
  parseAreaCode,
  parseBounds,
  parseCenter,
  parseZoom,
  ZOOM_MAX,
} from "./camera.js";

describe("parseCenter", () => {
  it("accepts an object, a pair and the URL's lng,lat string", () => {
    expect(parseCenter({ lng: 36.8, lat: -1.3 })).toEqual({ lng: 36.8, lat: -1.3 });
    expect(parseCenter([36.8, -1.3])).toEqual({ lng: 36.8, lat: -1.3 });
    expect(parseCenter(" 36.8 , -1.3 ")).toEqual({ lng: 36.8, lat: -1.3 });
  });

  it("clamps a polar latitude to the Mercator limit", () => {
    expect(parseCenter({ lng: 0, lat: 90 })).toEqual({ lng: 0, lat: MAX_LATITUDE });
    expect(parseCenter({ lng: 0, lat: -88 })).toEqual({ lng: 0, lat: -MAX_LATITUDE });
  });

  it("refuses anything that is not a coordinate", () => {
    for (const value of [
      null,
      undefined,
      "",
      "10",
      "10,",
      ",10",
      "a,b",
      [1, 2, 3],
      { lng: 181, lat: 0 },
      { lng: 0, lat: 91 },
      { lng: "", lat: 0 },
      { lng: Infinity, lat: 0 },
      { lat: 0 },
      42,
    ]) {
      expect(parseCenter(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe("parseZoom", () => {
  it("clamps to MapLibre's range", () => {
    expect(parseZoom("4.5")).toBe(4.5);
    expect(parseZoom(99)).toBe(ZOOM_MAX);
    expect(parseZoom(-1)).toBe(0);
  });

  it("refuses what is not a number", () => {
    for (const value of [null, undefined, "", "far", NaN, {}, [4]]) expect(parseZoom(value)).toBeNull();
  });
});

describe("parseBounds", () => {
  it("accepts west,south,east,north as an array or a string", () => {
    expect(parseBounds([-20, -35, 52, 38])).toEqual([-20, -35, 52, 38]);
    expect(parseBounds("-20,-35,52,38")).toEqual([-20, -35, 52, 38]);
  });

  it("clamps latitudes to the Mercator limit", () => {
    expect(parseBounds([-180, -90, 180, 90])).toEqual([-180, -MAX_LATITUDE, 180, MAX_LATITUDE]);
  });

  it("refuses inverted, antimeridian-crossing, out-of-range and short boxes", () => {
    for (const value of [
      [10, 0, -10, 5], // west > east (crosses the antimeridian)
      [0, 5, 10, 0], // south > north
      [0, 0, 0, 10], // no width
      [-181, 0, 10, 10],
      [0, -91, 10, 10],
      [0, 0, 10],
      "0,0,10",
      "a,b,c,d",
      null,
      { west: 0 },
    ]) {
      expect(parseBounds(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe("extentToBounds", () => {
  it("reads MapX's extent_sp", () => {
    expect(extentToBounds({ lng1: -10, lat1: -5, lng2: 30, lat2: 25 })).toEqual([-10, -5, 30, 25]);
  });

  it("orders each axis, as MapX's raster fallback can report north as lat1", () => {
    expect(extentToBounds({ lng1: -10, lat1: 25, lng2: 30, lat2: -5 })).toEqual([-10, -5, 30, 25]);
    expect(extentToBounds({ lng1: 30, lat1: 25, lng2: -10, lat2: -5 })).toEqual([-10, -5, 30, 25]);
  });

  it("is null for a missing or degenerate extent", () => {
    expect(extentToBounds(undefined)).toBeNull();
    expect(extentToBounds({})).toBeNull();
    expect(extentToBounds({ lng1: 5, lat1: 5, lng2: 5, lat2: 5 })).toBeNull();
  });
});

describe("geojsonBounds", () => {
  it("spans every coordinate of every geometry", () => {
    const collection = {
      features: [
        { geometry: { type: "Point", coordinates: [10, 50] } },
        {
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [
                [
                  [-5, 40],
                  [2, 41],
                  [-5, 40],
                ],
              ],
            ],
          },
        },
        { geometry: null },
      ],
    };
    expect(geojsonBounds(collection)).toEqual([-5, 40, 10, 50]);
  });

  it("is null for a collection with no coordinates", () => {
    expect(geojsonBounds({ features: [] })).toBeNull();
    expect(geojsonBounds(undefined)).toBeNull();
  });
});

describe("parseAreaCode", () => {
  it("normalises ISO3 to upper case and M49 to lower case", () => {
    expect(parseAreaCode("ken")).toBe("KEN");
    expect(parseAreaCode(" KEN ")).toBe("KEN");
    expect(parseAreaCode("M49_029")).toBe("m49_029");
  });

  it("refuses anything else", () => {
    for (const value of ["", "KE", "KENY", "Kenya", "m49_29", "m49_0290", "404", "K3N", null, 3]) {
      expect(parseAreaCode(value), String(value)).toBeNull();
    }
  });
});
