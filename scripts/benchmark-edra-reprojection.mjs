/**
 * Offline comparison of the old per-coordinate projection construction with
 * the reusable converter used by src/external/edra-agriculture.js.
 *
 * Usage: node scripts/benchmark-edra-reprojection.mjs /path/to/edra-geometry.json
 * See docs/performance.md for fetching the public boundary file once. This
 * measures coordinate transforms only, not fetching, JSON parsing or MapX.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { deepStrictEqual } from "node:assert";
import proj4 from "proj4";

if (process.argv.length !== 3) {
  console.error("Usage: node scripts/benchmark-edra-reprojection.mjs /path/to/edra-geometry.json");
  process.exit(1);
}
const bytes = readFileSync(process.argv[2]);
const geometry = JSON.parse(bytes);
const points = [];
function collect(coordinates) {
  if (typeof coordinates[0] === "number") points.push(coordinates);
  else coordinates.forEach(collect);
}
geometry.features.forEach((feature) => collect(feature.geometry.coordinates));
const from =
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 " + "+ellps=GRS80 +units=m +no_defs +type=crs";
const original = () => points.map((point) => proj4(from, "EPSG:4326", point));
const reused = () => {
  const projection = proj4(from, "EPSG:4326");
  return points.map((point) => projection.forward(point));
};

// Warm each path and compare every output coordinate outside the timed runs.
deepStrictEqual(original(), reused());
const timings = { perCoordinate: [], reusedConverter: [] };
for (let sample = 0; sample < 5; sample++) {
  const methods = [
    ["perCoordinate", original],
    ["reusedConverter", reused],
  ];
  if (sample % 2) methods.reverse();
  for (const [name, run] of methods) {
    const start = performance.now();
    run();
    timings[name].push(performance.now() - start);
  }
}
const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      features: geometry.features.length,
      vertices: points.length,
      identicalCoordinates: true,
      milliseconds: timings,
      medianMilliseconds: Object.fromEntries(
        Object.entries(timings).map(([key, values]) => [key, median(values)]),
      ),
    },
    null,
    2,
  ),
);
