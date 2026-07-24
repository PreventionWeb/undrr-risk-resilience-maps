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
const VALUES_BBOX = "2000000,1000000,7000000,6000000,EPSG:3035";

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

function optionFor(options, value, name) {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`Unsupported EDRA ${name}: ${value}`);
  return option;
}

function reprojectCoordinates(coordinates) {
  if (
    Array.isArray(coordinates) &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return proj4(EPSG_3035, "EPSG:4326", coordinates);
  }
  return coordinates.map(reprojectCoordinates);
}

function reprojectFeatureCollection(data) {
  return {
    type: "FeatureCollection",
    features: data.features.map((feature) => ({
      type: "Feature",
      properties: { ...feature.properties },
      geometry: {
        type: feature.geometry.type,
        coordinates: reprojectCoordinates(feature.geometry.coordinates),
      },
    })),
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`EDRA request failed (${response.status} ${response.statusText})`);
  }
  return response.json();
}

async function getGeometry() {
  if (!geometryPromise) {
    geometryPromise = fetchJson(GEOMETRY_URL)
      .then((data) => {
        if (!Array.isArray(data?.features)) {
          throw new Error("EDRA geometry response is not a GeoJSON FeatureCollection");
        }
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

export async function buildEDRAGeoJSON(settings) {
  const crop = optionFor(EDRA_CROPS, settings.crop, "crop");
  const scenario = optionFor(EDRA_SCENARIOS, settings.scenario, "scenario");
  const [geometry, values] = await Promise.all([getGeometry(), fetchJson(valuesRequestUrl(crop.value))]);

  if (!Array.isArray(values)) {
    throw new Error("EDRA values response is not an array");
  }

  const valuesByRegion = new Map(values.map((record) => [record.region_id, record]));

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

export function deleteEDRAView(idView, sdk = getSDK()) {
  return sdk.ask("view_geojson_delete", { idView });
}

/** Test helper: clear the shared geometry cache between isolated test cases. */
export function resetEDRAGeometryCache() {
  geometryPromise = null;
}
