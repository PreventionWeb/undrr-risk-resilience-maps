/**
 * European Drought Risk Atlas (EDRA) agriculture adapter.
 *
 * EDRA does not publish these scenario layers through its public WMS. Its
 * explorer combines EPSG:3035 NUTS-2 polygons from a WFS-like endpoint with
 * crop values from a REST endpoint. This adapter performs the same join,
 * reprojects the geometry to WGS84 GeoJSON, and creates a temporary MapX view.
 */
import proj4 from "proj4";
import { getSDK } from "../sdk/client.js";

const EDRA_ORIGIN = "https://drought.emergency.copernicus.eu";
const GEOMETRY_URL =
  `${EDRA_ORIGIN}/gis/gapk/wfsService?MAP=EDRA&SERVICE=WFS&VERSION=1.0.0` +
  "&REQUEST=GetFeature&TYPENAME=nuts2_simplified&outputFormat=application/json";
const VALUES_URL = `${EDRA_ORIGIN}/edra/rest/dataByBBox`;
// Query every value record. The previous continental EPSG:3035 extent omitted
// the Azores and Madeira even though their polygons are part of the WFS layer.
const VALUES_BBOX = "-180,-90,180,90,EPSG:4326";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_GEOMETRY_FEATURES = 1_000;
const MAX_GEOMETRY_VERTICES = 1_000_000;
const MAX_VALUE_RECORDS = 5_000;
const MIN_JOIN_COVERAGE = 0.9;

const EPSG_3035 =
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 " + "+ellps=GRS80 +units=m +no_defs +type=crs";

export const EDRA_CROPS = [
  { value: "BARLEY", label: "Barley" },
  { value: "MAIZE", label: "Maize" },
  { value: "WHEAT", label: "Wheat" },
];

export const EDRA_SCENARIOS = [
  { value: "BASELINE", label: "Historical (1981–2010)", property: "value_his" },
  { value: "CURRENT", label: "Current climate", property: "value_current" },
  { value: "15", label: "+1.5 °C", property: "value_15" },
  { value: "20", label: "+2 °C", property: "value_20" },
  { value: "30", label: "+3 °C", property: "value_30" },
];

export const EDRA_LEGEND = [
  { color: "#FCEDD3", label: "0–2.5%" },
  { color: "#FAD194", label: "2.5–5%" },
  { color: "#F7AC70", label: "5–7.5%" },
  { color: "#F27739", label: "7.5–10%" },
  { color: "#DA3B30", label: "10–12.5%" },
  { color: "#B10200", label: ">12.5%" },
  { color: "#d1d5db", label: "No data" },
];

export const EDRA_CONTROLS = [
  { key: "crop", label: "Crop", options: EDRA_CROPS },
  { key: "scenario", label: "Climate scenario", options: EDRA_SCENARIOS },
];

let geometryPromise = null;
const valuesPromises = new Map();

function optionFor(options, value, name) {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`Unsupported EDRA ${name}: ${value}`);
  return option;
}

function reprojectCoordinates(coordinates, count) {
  if (
    Array.isArray(coordinates) &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
      throw new Error("EDRA geometry contains non-finite coordinates");
    }
    count.vertices++;
    if (count.vertices > MAX_GEOMETRY_VERTICES) {
      throw new Error(`EDRA geometry exceeds the ${MAX_GEOMETRY_VERTICES} vertex safety limit`);
    }
    return proj4(EPSG_3035, "EPSG:4326", coordinates);
  }
  if (!Array.isArray(coordinates)) {
    throw new Error("EDRA geometry contains invalid coordinates");
  }
  return coordinates.map((child) => reprojectCoordinates(child, count));
}

function reprojectFeatureCollection(data) {
  const count = { vertices: 0 };
  return {
    type: "FeatureCollection",
    features: data.features.map((feature) => ({
      type: "Feature",
      properties: { ...feature.properties },
      geometry: {
        type: feature.geometry.type,
        coordinates: reprojectCoordinates(feature.geometry.coordinates, count),
      },
    })),
  };
}

function validateGeometry(data) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("EDRA geometry response is not a GeoJSON FeatureCollection");
  }
  if (data.features.length === 0 || data.features.length > MAX_GEOMETRY_FEATURES) {
    throw new Error(`EDRA geometry feature count ${data.features.length} is outside the supported range`);
  }

  const codes = new Set();
  for (const feature of data.features) {
    const code = feature?.properties?.code;
    if (typeof code !== "string" || !code) {
      throw new Error("EDRA geometry feature is missing properties.code");
    }
    if (codes.has(code)) throw new Error(`EDRA geometry contains duplicate region code "${code}"`);
    codes.add(code);
    if (
      !feature.geometry ||
      !["Polygon", "MultiPolygon"].includes(feature.geometry.type) ||
      !Array.isArray(feature.geometry.coordinates)
    ) {
      throw new Error(`EDRA geometry for region "${code}" is not a polygon`);
    }
  }
}

function validateValues(values) {
  if (!Array.isArray(values)) throw new Error("EDRA values response is not an array");
  if (values.length === 0 || values.length > MAX_VALUE_RECORDS) {
    throw new Error(`EDRA value record count ${values.length} is outside the supported range`);
  }

  const ids = new Set();
  const scenarioProperties = EDRA_SCENARIOS.map((scenario) => scenario.property);
  for (const record of values) {
    if (typeof record?.region_id !== "string" || !record.region_id) {
      throw new Error("EDRA value record is missing region_id");
    }
    if (ids.has(record.region_id)) {
      throw new Error(`EDRA values contain duplicate region_id "${record.region_id}"`);
    }
    ids.add(record.region_id);
    for (const property of scenarioProperties) {
      if (!Object.prototype.hasOwnProperty.call(record, property)) {
        throw new Error(`EDRA value record "${record.region_id}" is missing ${property}`);
      }
      const value = record[property];
      if (value != null && value !== "" && !Number.isFinite(Number(value))) {
        throw new Error(`EDRA value record "${record.region_id}" has invalid ${property}`);
      }
    }
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`EDRA request failed (${response.status} ${response.statusText})`);
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`EDRA request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getGeometry() {
  if (!geometryPromise) {
    geometryPromise = fetchJson(GEOMETRY_URL)
      .then((data) => {
        validateGeometry(data);
        return reprojectFeatureCollection(data);
      })
      .catch((error) => {
        geometryPromise = null;
        throw error;
      });
  }
  return geometryPromise;
}

function valuesRequestUrl(crop) {
  const params = new URLSearchParams({
    system: "AGRICULTURE",
    subsystem: crop,
    bbox: VALUES_BBOX,
  });
  return `${VALUES_URL}?${params}`;
}

async function getValues(crop) {
  if (!valuesPromises.has(crop)) {
    const request = fetchJson(valuesRequestUrl(crop))
      .then((values) => {
        validateValues(values);
        return values;
      })
      .catch((error) => {
        valuesPromises.delete(crop);
        throw error;
      });
    valuesPromises.set(crop, request);
  }
  return valuesPromises.get(crop);
}

export async function buildEDRAGeoJSON(settings) {
  const crop = optionFor(EDRA_CROPS, settings.crop, "crop");
  const scenario = optionFor(EDRA_SCENARIOS, settings.scenario, "scenario");
  const [geometry, values] = await Promise.all([getGeometry(), getValues(crop.value)]);

  const valuesByRegion = new Map(values.map((record) => [record.region_id, record]));
  const matchedRegions = geometry.features.reduce(
    (count, feature) => count + Number(valuesByRegion.has(feature.properties.code)),
    0,
  );
  const joinCoverage = matchedRegions / geometry.features.length;
  if (joinCoverage < MIN_JOIN_COVERAGE) {
    throw new Error(
      `EDRA region join coverage is only ${(joinCoverage * 100).toFixed(1)}% ` +
        `(minimum ${(MIN_JOIN_COVERAGE * 100).toFixed(0)}%)`,
    );
  }

  return {
    type: "FeatureCollection",
    features: geometry.features.map((feature) => {
      const code = feature.properties.code;
      const rawValue = valuesByRegion.get(code)?.[scenario.property];
      const numericValue = rawValue == null || rawValue === "" ? null : Number(rawValue);
      const properties = {
        region: feature.properties.name_eng || feature.properties.name_latn || code,
        nuts_2_code: code,
        crop: crop.label,
        climate_scenario: scenario.label,
      };
      if (Number.isFinite(numericValue)) {
        properties.yield_reduction_pct = Math.round(numericValue * 100) / 100;
      }
      return {
        ...feature,
        properties,
      };
    }),
  };
}

const FILL_COLOR = [
  "case",
  ["has", "yield_reduction_pct"],
  [
    "step",
    ["to-number", ["get", "yield_reduction_pct"]],
    "#FCEDD3",
    2.5001,
    "#FAD194",
    5.0001,
    "#F7AC70",
    7.5001,
    "#F27739",
    10.0001,
    "#DA3B30",
    12.5001,
    "#B10200",
  ],
  "#d1d5db",
];

export async function createEDRAView(settings, sdk = getSDK()) {
  const crop = optionFor(EDRA_CROPS, settings.crop, "crop");
  const scenario = optionFor(EDRA_SCENARIOS, settings.scenario, "scenario");
  const data = await buildEDRAGeoJSON(settings);
  const view = await sdk.ask("view_geojson_create", {
    data,
    save: false,
    fileType: "geojson",
    title: `EDRA crop yield reduction — ${crop.label}, ${scenario.label}`,
    abstract: "Average annual crop yield reduction due to drought, from the European Drought Risk Atlas.",
  });
  const idView = view?.id;
  if (!idView) throw new Error("MapX did not return an ID for the temporary EDRA view");

  try {
    await sdk.ask("view_geojson_set_style", {
      idView,
      paint: {
        "fill-color": FILL_COLOR,
        "fill-opacity": 0.82,
        "fill-outline-color": "rgba(91, 33, 24, 0.45)",
      },
    });
  } catch (error) {
    await sdk.ask("view_geojson_delete", { idView }).catch(() => {});
    throw error;
  }

  return { idView, settings: { crop: crop.value, scenario: scenario.value } };
}

export async function deleteEDRAView(idView, sdk = getSDK()) {
  try {
    return await sdk.ask("view_geojson_delete", { idView });
  } catch (deleteError) {
    try {
      // Hiding the temporary view is an acceptable session-level fallback if
      // MapX cannot fully delete it. This prevents an uncontrolled visible
      // layer even though the iframe may retain the hidden object until reload.
      return await sdk.ask("view_remove", { idView });
    } catch (removeError) {
      console.warn(`MapX failed to delete temporary view ${idView}:`, deleteError);
      throw new Error(`MapX could not delete or hide temporary view ${idView}`, {
        cause: removeError,
      });
    }
  }
}

/** Test helper: clear shared request caches between isolated test cases. */
export function resetEDRACaches() {
  geometryPromise = null;
  valuesPromises.clear();
}
