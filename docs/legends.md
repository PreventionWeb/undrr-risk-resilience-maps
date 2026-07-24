# Legend architecture and operations

This guide explains how legends are resolved, rendered, diagnosed, tested, and extended. It is
maintainer documentation, not a release checklist. One-time acceptance status and screenshots
belong in the relevant pull request.

Last contract verification: **2026-07-24**

## Principles

- Prefer a structured HTML legend when the source exposes rules we can reproduce faithfully.
- Fail closed to the MapX image fallback when a rule or upstream response is unfamiliar.
- Keep provider-specific parsing outside the UI and outside other adapters.
- Treat MapX catalogue fields and HTTP routes according to their actual support status.
- Do not parse legend pixels or generic SLD documents.

Use these terms consistently:

- **Provider-owned structured legend:** entries supplied by local/runtime layer configuration.
- **MapX-derived vector legend:** entries validated from a MapX vector view.
- **GeoServer-derived raster legend:** discrete entries validated from GeoServer JSON.
- **MapX image fallback:** the image returned by `get_view_legend_image`.

## Resolution flow

```text
provider-owned structured legend
  └─ otherwise: MapX get_views catalogue
       ├─ vt: validate supported data.style fields
       └─ rt: validate approved data.source.legend URL
              ├─ request GeoServer JSON directly
              └─ on the approved provider's HTTP 403 origin denial, retry through MapX mirror
                    └─ accept discrete intervals/values only
  └─ normalize into LegendDefinition and render structured HTML
       └─ if any step fails: request and display the MapX image fallback
```

`src/ui/layer-controls.js` owns precedence and rendering. `src/sdk/legends.js` owns the MapX
catalogue and vector adapter. `src/sdk/raster-legends.js` owns the approved GeoServer transport and
raster adapter. `src/sdk/legend-model.js` owns the provider-neutral model and shared validation.

The MapX catalogue cache is scoped to the active SDK manager and refreshes once when a requested
view is missing, because `view_add` can introduce a public cross-project view after initialization.
A successful raster resolution is cached for the page session by view revision, legend URL, and
language; failures are not cached, so a later retry can recover.
A DOM ownership marker prevents a late asynchronous result from being appended to a closed layer
or an obsolete compound-layer source.

## Shared model

Every structured adapter returns:

```js
{
  title: "cm/s2",
  entries: [{
    color: "#FFF195",
    label: "< 100",
    opacity: 1,
    size: null,
    geometry: "polygon",
    borderColor: null
  }]
}
```

The renderer understands `point`, `line`, and `polygon` geometry. A zero-opacity raster entry is
shown as a crossed swatch so a transparent/no-data class remains visible and comparable with the
MapX image.

## Upstream contracts

| Interface                         | Fields used                                                                                                                                       | Status and owner                                                                                                                                                                                   | Failure behavior                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| MapX SDK `get_views`              | `id`, `type`, vector `data.geometry.type`, `data.style.rules`, `nulls`, `titleLegend`, `custom.json`; raster `data.source.legend`, `legendTitles` | SDK command is public; detailed view shapes are observed from MapX and not yet confirmed as a stable client contract                                                                               | Strict validation fails to the image                                 |
| MapX SDK `get_view_legend_image`  | Base64/data-URL image                                                                                                                             | Public SDK fallback                                                                                                                                                                                | Missing image is non-fatal                                           |
| GeoServer `GetLegendGraphic` JSON | `Legend[].rules[].symbolizers[].Raster.colormap`                                                                                                  | [Documented GeoServer output](https://docs.geoserver.org/latest/en/user/services/wms/get_legend_graphic/); provider-owned availability/CORS                                                        | Invalid or unsupported JSON fails to the image                       |
| MapX `/get/mirror`                | `url` query parameter                                                                                                                             | Internal, unversioned MapX route inferred from [MapX source](https://github.com/unep-grid/mapx/blob/e618823c3b869efe77842d69f6bfed9d4404f9f2/app/src/js/mirror_util/index.js); not an SDK contract | Direct request remains first; mirror failure falls back to the image |
| MapX `/get/view/item/:id`         | Public view object used by the live contract script                                                                                               | Observed public for eligible public views; not used by the application runtime                                                                                                                     | Live check fails visibly                                             |

The current approved structured-raster provider is:

| Host               | Direct request | MapX mirror retry |
| ------------------ | -------------- | ----------------- |
| `giri.unepgrid.ch` | HTTPS only     | Allowed           |

The allowlist is a security boundary. It pins the HTTPS host, exact WMS path, five approved PGA
layer names, permitted query keys, and mirror permission; duplicate or unknown query parameters
are rejected. A new endpoint or layer must be reviewed before being added to
`APPROVED_RASTER_PROVIDERS`. Do not make the mirror generic: legend URLs come from mutable MapX
metadata, and the mirror performs a server-side request.

MapX's current mirror implementation follows upstream redirects. The exact endpoint/query policy
prevents arbitrary redirect targets from being supplied in view metadata, but production approval
still requires MapX confirmation of its destination/redirect controls and change policy.

## Supported styles and deliberate fallbacks

| Source/style                                    | Structured HTML | Notes                                                                         |
| ----------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| Provider-owned local entries                    | Yes             | Configuration/provider is authoritative                                       |
| MapX vector point/line/polygon rules            | Yes             | Colors, opacity, size, border, localized labels/title, and visible null rules |
| GeoServer raster `intervals`                    | Yes             | Discrete classes                                                              |
| GeoServer raster `values`                       | Yes             | Discrete values                                                               |
| GeoServer raster `ramp`                         | No              | Requires a separately designed continuous-gradient component                  |
| Vector sprites or enabled custom JSON           | No              | Image preserves symbols/custom behavior                                       |
| Static raster images and non-approved providers | No              | No trusted structured contract                                                |
| Unknown, malformed, unsafe, or excessive rules  | No              | Never render a plausible partial legend                                       |

Safety limits are intentional fallback thresholds:

- HTTPS, credential-free, allowlisted raster provider URLs only.
- The approved provider's explicit HTTP 403 origin denial is the only reason to try the mirror.
- Direct requests reject redirects; network/CORS failures go straight to the MapX image fallback.
- One five-second budget covers direct request, optional mirror retry, and body reading.
- Response content type must be JSON.
- Response bodies are streamed and stopped at 256 KiB.
- At most 500 legend entries.
- Labels/titles are at most 200 characters and contain no control characters.
- Colors must match the shared restricted CSS color grammar.
- Requests omit credentials and referrer information.

## Diagnostics and troubleshooting

Stable DOM markers make the path inspectable without changing user-facing copy:

| Marker                                        | Meaning                                     |
| --------------------------------------------- | ------------------------------------------- |
| `data-legend-mode="local-structured"`         | Provider-owned structured legend            |
| `data-legend-mode="mapx-vector-structured"`   | MapX-derived vector legend                  |
| `data-legend-mode="mapx-raster-structured"`   | GeoServer-derived raster legend             |
| `data-legend-mode="mapx-image"`               | MapX image fallback                         |
| `data-legend-reason="…"`                      | Adapter fallback reason                     |
| `data-legend-transport="direct\|mapx-mirror"` | Raster request path                         |
| `data-legend-failure="…"`                     | Non-sensitive transport/parser failure kind |
| `data-legend-status="…"`                      | HTTP status when available                  |
| `data-legend-comparison="mapx-image"`         | Lazy comparison image                       |

| Reason                               | Likely cause                                                                        | Action                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `raster`                             | Static/non-WMS URL, unapproved host, insecure URL, or no structured raster contract | Confirm the image is correct; approve a new provider only after review |
| `raster-json-unavailable`            | Network/CORS, timeout, HTTP failure, or failure of the approved 403 mirror retry    | Inspect transport/failure/status markers; run the live contract check  |
| `raster-json-invalid`                | Wrong content type, excessive/stalled body, invalid JSON                            | Inspect provider response; do not loosen limits to hide upstream drift |
| `raster-json-unsupported`            | Valid JSON with an unsupported schema or colormap such as `ramp`                    | Add a separate, tested adapter/component only if required              |
| `catalog-miss`                       | View absent after one catalogue refresh                                             | Confirm `view_add`, project, and view ID                               |
| `custom-style` / `unsupported-style` | Custom JSON, sprite, unsafe, or unfamiliar vector rule                              | Keep the image unless faithful structured support is designed          |
| `schema-invalid` / `too-many-rules`  | MapX schema drift or safety limit                                                   | Inspect the current view and update tests before changing the adapter  |

“Structured raster legend unavailable” concerns legend metadata only; it does not mean the raster
map data failed.

## Privacy and deployment

Direct GeoServer requests reveal the visitor's IP and ordinary request metadata to the approved
provider. Mirror retries reveal the requested provider URL to MapX, and MapX sees the visitor's
request to its API. The URL must not contain credentials or secrets.

Deployment Content Security Policy must permit connections to the approved provider and
`https://api.mapx.org`. Confirm privacy/CSP acceptance before production use.

## Testing and regression QA

Run the default checks for every legend change:

```bash
yarn test
yarn lint
yarn build
yarn format:check
```

Run the network-dependent contract before legend-related merges and releases, and after a MapX or
provider incident:

```bash
yarn test:mapx-raster-contract
```

The script derives the five Earthquake PGA IDs from product configuration. It verifies the public
MapX view response, GIRI's six JSON classes, the transparent first class, and that a simulated
non-MapX origin exercises the mirror retry. It is not a substitute for a real browser/CORS and
visual test.

For representative structured legends:

1. Record `data-legend-mode` and, for raster, `data-legend-transport`.
2. Expand **Show MapX image legend (comparison)**.
3. Compare title, count/order, labels/ranges, colors, opacity, geometry/size, borders, and no-data.
4. Test at 200% zoom and traverse the scroll region by keyboard.
5. Record any difference as a defect or an intentional presentation decision.

Also test one example of each deliberate fallback: continuous raster ramp, static/non-approved
raster, vector sprite, custom-coded view, catalogue miss, and missing MapX image.

## Extension rules

When adding a new provider or style:

1. Identify a documented or explicitly approved structured contract.
2. Add a provider-specific adapter; do not add provider branches to the renderer.
3. Normalize only fully understood fields into `LegendDefinition`.
4. Add strict fixtures for valid, malformed, oversized, and unsupported responses.
5. Preserve a labelled MapX image fallback.
6. Add or update a live contract check when the dependency is external.
7. Complete browser visual comparison before merge.

Continuous ramps need a dedicated gradient model and renderer. Another raster service needs its
own adapter unless it returns the exact validated GeoServer representation.

## Ownership and retirement

The application maintainer owns adapters, tests, provider approval, and regression checks. MapX
owns the SDK, view schema, image renderer, view API, and mirror service. The raster provider owns
its WMS/GeoServer response.

The comparison disclosure may be removed only after the representative browser matrix in this
guide has been completed, differences have been resolved or explicitly accepted, and the
application owner approves removal.

Publisher-side MapX style or legend changes require a page reload because catalogue and successful
raster resolution caches are page-session scoped.

Revisit this design when any of these occur:

- MapX documents a provider-neutral structured raster legend SDK command.
- MapX changes or withdraws `get_views` fields, `/get/mirror`, or `/get/view/item/:id`.
- The provider changes host, schema, CORS, or colormap behavior.
- Mirror rate limits or latency become operationally significant.
- More than a small number of providers require separate adapters.

If MapX supplies an official structured raster API, migrate the raster resolver to it, remove
direct/mirror permissions and the corresponding live contract, and reassess the comparison UI
separately. If the undocumented contracts cannot be governed, disable structured extraction and
retain the MapX image fallback.
