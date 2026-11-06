# Map and download performance

## EDRA first activation: reuse the coordinate converter

The EDRA boundary file contains 242 features and 194,716 vertices. Previously,
`reprojectCoordinates()` constructed the EPSG:3035 and WGS84 projections for
every vertex. It now constructs one Proj4 converter per feature collection and
calls its `forward()` method for every point. This is the [documented reusable
Proj4 API](https://github.com/proj4js/proj4js#using).

An offline Node 24.18.0 benchmark on macOS arm64, using the live file fetched
on 6 November 2026, measured a median **1,403.49 ms → 95.85 ms** for the coordinate
transforms (five timed samples after warming both paths, alternating order).
Every output coordinate was exactly equal. The file was 7,442,494 bytes, SHA-256
`0e5f46fb618c4f6be9449cdd0bce5bdc524693bfe1b902835591418a741117dc`.

These are local CPU timings, not an end-to-end map speed claim. Network transfer,
JSON parsing, joining values, the cross-frame GeoJSON copy and MapX rendering are
outside this benchmark. Geometry is still fetched and projected only on first
activation in a page session. Schema checks, vertex and feature limits, and the
coordinate reference systems are unchanged.

A separate live Chrome DevTools trace of the first EDRA activation in each
checkout found the longest task in the viewer's parent renderer decreased from
1,193.52 ms to 181.92 ms. These were unthrottled development builds in the same
browser session, one trace per version. Cache, JIT and network variation make
this indicative browser CPU evidence rather than a repeatable total-load-time
benchmark. MapX's own cross-origin renderer still performs separate work.

To reproduce the repeated CPU comparison, fetch the public boundary file once,
then run the offline benchmark:

```sh
curl -fsSL 'https://drought.emergency.copernicus.eu/gis/gapk/wfsService?MAP=EDRA&SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&TYPENAME=nuts2_simplified&outputFormat=application/json' -o /tmp/edra-geometry.json
node scripts/benchmark-edra-reprojection.mjs /tmp/edra-geometry.json
```

The script prints the input hash and size, all sample timings and medians, and
asserts that both strategies produce identical coordinates. It does not contact
CEMS or MapX. Timing varies with the device and other running work; no wall-clock
threshold is asserted in CI.

## Concurrent legends: share catalogue refreshes

Several visible rows can ask for legends concurrently, including the home and
cross-tab rows of the same layer. When those views were missing from the cached
MapX catalogue, each request independently cleared the cache and issued another
`get_views` call. All misses against one catalogue snapshot now share its refresh.

For three concurrent misses, the regression test verifies **four catalogue RPCs
→ two** (the original catalogue plus one refresh). A later `view_add` can still
cause another refresh against the new snapshot; missing views retain their image
fallback and a failed refresh remains retryable. Cache state belongs to its SDK
manager so a late failure from a retired manager cannot evict the replacement's
catalogue. These are deterministic request counts, not measured service latency.

## Downloads: where the wait remains

- Hosted GeoTIFFs go straight from the provider to the browser. The viewer reads
  stored size metadata to render their links and does not fetch, buffer or build
  blobs for these large files. Their transfer speed depends on the provider and
  connection; this change does not claim to increase it.
- CSVs read region-level attribute tables through MapX, not raster files or
  geometries. The earlier live table measurements are recorded in
  [LEARNINGS.md](../LEARNINGS.md#mapx-sdk-attribute-tables-for-downloads-4-november-2026):
  typically 130–260 rows, about 22 KB, with reads around 0.55 seconds median and
  1 second at p95 in that spike. These are historical measurements, not new ones.
- Region names are already cached in memory/localStorage, and matched sibling
  region-code tables in memory. Previously loaded views skip temporary adds.
  Repeated CSV exports deliberately reread their value table so a fresh download
  does not silently reuse old values. No speculative prefetch or persistent
  value-table cache is introduced.
- A view without names/codes may require reference-table reads. Unloaded
  reference views need a temporary add/read/remove, with the map masked until
  cleanup finishes because MapX paints a view before the add answers. Keep the
  per-view read/cleanup lock and cancellation checks; bypassing them would trade
  correctness for speed. See [downloads.md](downloads.md#views-that-are-not-on-the-map).

The first map load also depends on the cross-origin MapX iframe. This change
does not alter its initialization, ready budget, warm-up gates or layer lifecycle.
An upstream-side improvement (for example, a hosted WGS84 EDRA boundary file or
supported attribute-table requests without adding views) would address remaining
network/iframe costs more directly than client caching of values.
