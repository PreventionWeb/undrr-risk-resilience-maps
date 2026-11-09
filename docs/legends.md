# Legend architecture and operations

Legends use the public **MapX 1.14.3+** `get_view_legend_json({ idView })` command.
The viewer validates provider data and renders HTML; MapX owns discovery and transport.
Representative production contract verification: **9 November 2026**.

## Resolution and ownership

1. Provider-owned local/runtime legend, when configured.
2. Official SDK JSON envelope, validated before provider dispatch:
   - `vt`, provider `mapx`: computed vector rules as shown in MapX's legend.
   - `rt`, provider `geoserver`: unchanged GeoServer `{ Legend: [...] }` data.
3. The four reviewed custom-code definitions use `get_views` only to hash-check
   `data.methods`. No upstream JavaScript is evaluated. An unknown or changed
   custom-code view falls back to an image.
4. Unsupported, malformed, unavailable or excessive data uses `get_view_legend_image`.
   A failed image is non-fatal. Structured legends retain a lazy comparison image.

`src/ui/layer-controls.js` owns precedence and rendering; `src/sdk/legends.js` owns
SDK requests, envelope validation, caching and the vector adapter.
`src/sdk/raster-legends.js` parses provider data without network access.
`src/sdk/legend-model.js` defines the shared model and validation.

Successful results and concurrent requests are shared by manager, view ID and requested
label language for the page lifetime. A manager change or explicit reset retires the
cache. Failed/unsupported results are evicted so a later `view_add` or retry can recover.
An old request cannot overwrite or evict a replacement manager's result. A DOM ownership
marker prevents late results from appearing in a closed or replaced layer slot.

## Public contracts

```js
const result = await sdk.ask("get_view_legend_json", { idView });
// { idView, type, provider, supported, data, reason? }
```

Supported vector `data` contains `title`, `geometry`, `attribute` and ordered `rules`.
Rules expose `value`, `value_to`, `label`, `labels`, `color`, `opacity`, `size`, `sprite`
and `color_border`. The SDK computes visible null rules and deduplicates the legend.
Use localized `labels`, then the SDK's `label`, then a primitive value; preserve explicit
range text and order instead of inventing scientific class boundaries from `value_to`.
The title is already resolved in the iframe's language (English in this viewer).

GeoServer data retains its documented `Legend[].rules[].symbolizers[].Raster.colormap`
shape. The parser preserves ordered groups, discrete classes, opacity and continuous
numeric ramps. It uses provider titles, because the SDK envelope does not expose
catalogue `legendTitles` overrides. Reviewed source-unit notes in the layer configuration
retain the previous PGA, flood-depth and population unit text; styles still follow the SDK.

Unsupported responses carry `supported: false` and a reason such as `no_legend`,
`unsupported_provider`, `custom_style`, `fetch_failed`, `invalid_response` or
`unsupported_view_type`. A missing view can reject. The viewer also validates the
returned view ID and the type/provider pairing. ArcGIS is not implemented upstream.

Sources: [MapX SDK implementation](https://github.com/unep-grid/mapx/commit/f8ebab16),
[maintainer contract discussion](https://github.com/unep-grid/mapx/issues/288),
[GeoServer legend JSON](https://docs.geoserver.org/latest/en/user/services/wms/get_legend_graphic/).

## Shared model and supported styles

```js
{
  title: "Peak Ground Acceleration",
  entries: [{ color: "#FFF195", label: "< 100", opacity: 1,
    size: null, geometry: "polygon", borderColor: null }]
}
```

Optional `ramp` quantities align with entries and determine value-weighted gradient stops.
Optional `groups` preserve ordered sublayer legends; custom definitions may use `matrix`.
The renderer supports point, line and polygon symbols. Zero-opacity classes retain a
crossed swatch and readable text.

| Source/style                                          | Behavior                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Local/runtime definitions                             | Configuration is authoritative                                            |
| SDK vector point/line/polygon rules                   | Colors, opacity, sizes, borders, localized labels and computed null rules |
| GeoServer `intervals` / `values`                      | Discrete classes                                                          |
| GeoServer `ramp`                                      | Continuous gradient with numeric stop positions and readable labels       |
| GeoServer groups                                      | Ordered sublayer titles and legends                                       |
| Reviewed custom-code definitions                      | Exact view ID and methods SHA-256; image on drift                         |
| Sprite, custom JSON, unknown provider, malformed data | MapX image fallback                                                       |

## Limits and transport

At most two legend SDK calls are in flight per manager, leaving room for layer/camera
commands under the SDK’s shared request limit. Each call has a five-second deadline
including queue time. Expired queued calls are never sent; timed-out active calls keep
their slot until the SDK settles. A timeout stops waiting and allows
fallback; it does **not** cancel the cross-frame request or MapX's upstream HTTP request.
No parent-page GeoServer requests or `/get/mirror` retries remain. MapX chooses provider
URLs and honors each view's mirror setting; its networking policies are upstream-owned.
The old provider allowlist and streamed HTTP-body reader have been removed with that transport.

The delivered envelope is limited to 256 KiB before adapter work; this does not bound
network buffering within MapX. At most 500 entries and 20 raster groups are accepted.
Labels/titles are limited to 200 characters without control characters; colors follow
the shared restricted grammar; opacity, size and ramp quantities must be valid.
Unsupported shapes fall back as a whole rather than presenting a plausible partial legend.

No additional parent-page provider/mirror CSP connections are required for legends.
MapX iframe/SDK permissions and unrelated download/external-data connections remain relevant.
Custom-code source hashes still rely on observed catalogue metadata; the official legend
API does not establish that separate support guarantee.

## Diagnostics

| DOM marker                                  | Meaning                              |
| ------------------------------------------- | ------------------------------------ |
| `data-legend-mode="local-structured"`       | Local/runtime definition             |
| `data-legend-mode="mapx-vector-structured"` | SDK vector rules                     |
| `data-legend-mode="mapx-raster-structured"` | SDK GeoServer data                   |
| `data-legend-mode="mapx-custom-structured"` | Hash-checked local custom definition |
| `data-legend-mode="mapx-image"`             | Image fallback                       |
| `data-legend-transport="mapx-sdk"`          | Official structured SDK command      |
| `data-legend-reason="…"`                    | Adapter/SDK fallback reason          |
| `data-legend-comparison="mapx-image"`       | Lazy comparison image                |

`sdk-unavailable` means rejection or deadline; `schema-invalid` means envelope/size drift;
`unsupported-style` covers symbols or values we cannot render; `raster-json-unsupported`
means the GeoServer parser rejected a shape. SDK reasons use hyphens in DOM diagnostics.
Legend metadata failures do not mean the underlying map layer failed.

## Tests and comparisons

Run `yarn test`, `yarn test:e2e`, `yarn lint`, `yarn build` and `yarn format:check`.
Recorded SDK/provider responses under `tests/fixtures/legends/` keep routine tests offline.
Browser tests inject envelopes; the parent page must not contact a raster provider.
They exercise discrete, continuous, grouped and bivariate rendering plus image fallback.

The opt-in command runs an isolated browser with the production SDK and the application's
actual adapters. Chromium must be installed (`yarn playwright install chromium`).
It defaults to all configured IDs, including unpublished inventory entries:

```bash
yarn test:mapx-raster-contract
# Narrow an investigation or record representative public SDK responses:
yarn test:mapx-raster-contract --view MX-J3YTW-RUQN3-40P87 --record /tmp/mapx-legends.json
```

For an adapter change, compare representative vector, PGA, continuous/grouped and custom
legends with **Show MapX image legend (comparison)**. Check titles, count/order, labels,
colors, opacity, geometry/size, borders and no-data. Check readable text at 200% zoom and
keyboard access. Include deliberate unsupported and missing-image cases. Record results
and limitations in the PR, rather than leaving a general verification backlog open.

## Custom maintenance and extension

The custom magnitude/IDP symbols and water/nutrition matrix remain local reviewed definitions.
Any methods-code edit triggers image fallback, even if unrelated to styling. Review actual
paint/filter expressions, update the local definition and hash, and refresh its recorded
fixture together. Never update a hash merely to silence drift.

Publisher-side changes require a page reload because successful resolutions are cached.
New providers need a documented SDK provider contract and a separate tested adapter.
Schema changes, unsupported styles or custom-code drift should retain image fallback until
faithful structured support is implemented. See ADR 0001 for the migration decision.
