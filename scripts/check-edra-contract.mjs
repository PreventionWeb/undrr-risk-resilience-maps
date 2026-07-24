/**
 * Live EDRA contract check.
 *
 * This intentionally does not run in the default unit-test suite because it
 * depends on a third-party service. Run it before merging or whenever EDRA
 * changes. It exercises every crop/scenario combination through the real
 * validation, reprojection, and join pipeline.
 */
import {
  buildEDRAGeoJSON,
  EDRA_CROPS,
  EDRA_SCENARIOS,
  getEDRAStyle,
  resetEDRACaches,
} from "../src/external/edra-agriculture.js";

resetEDRACaches();

const results = [];
for (const crop of EDRA_CROPS) {
  const style = await getEDRAStyle(crop.value);
  if (style.legend.length < 2 || style.legend.at(-1)?.label !== "No data") {
    throw new Error(`${crop.label}: live style produced an invalid legend`);
  }
  for (const scenario of EDRA_SCENARIOS) {
    const data = await buildEDRAGeoJSON({
      crop: crop.value,
      scenario: scenario.value,
    });
    const values = data.features.filter((feature) => Number.isFinite(feature.properties.yield_reduction_pct));
    if (data.features.length < 200) {
      throw new Error(`${crop.label} / ${scenario.label}: unexpectedly few geometry features`);
    }
    if (values.length < 50) {
      throw new Error(`${crop.label} / ${scenario.label}: unexpectedly few joined values`);
    }
    results.push({
      crop: crop.label,
      scenario: scenario.label,
      features: data.features.length,
      values: values.length,
    });
  }
}

const wheatCurrent = await buildEDRAGeoJSON({ crop: "WHEAT", scenario: "CURRENT" });
for (const code of ["PT20", "PT30"]) {
  const feature = wheatCurrent.features.find((candidate) => candidate.properties.nuts_2_code === code);
  if (!Number.isFinite(feature?.properties?.yield_reduction_pct)) {
    throw new Error(`Wheat / Current: ${code} is missing, indicating incomplete request coverage`);
  }
}

console.table(results);
console.log("EDRA live contract check passed for all 15 crop/scenario variants and 3 live styles.");
