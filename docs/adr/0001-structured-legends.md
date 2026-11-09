# ADR 0001: Guarded structured legends with image fallback

- Status: Accepted; transport decision superseded by the 2026-11-09 extension
- Date: 2026-07-24

## Context

MapX reliably exposes a rendered legend image, but images are difficult to style, inspect,
localize, and compare in the parent viewer. MapX vector view objects contain style rules that can
produce accessible HTML legends. Some MapX raster views point to GeoServer
`GetLegendGraphic` endpoints that expose documented JSON colormaps.

The detailed MapX vector/raster fields and MapX mirror HTTP route are not confirmed stable SDK
contracts. Providers can also change schema, CORS, availability, or styling independently.

## Decision

Use small, strict adapters to normalize fully understood sources into one provider-neutral
`LegendDefinition`:

- provider-owned local definitions;
- a conservative subset of MapX vector rules;
- discrete GeoServer raster `intervals` and `values` from explicitly approved HTTPS providers.

For an approved provider, request GeoServer JSON directly and reject redirects. Retry through the
MapX mirror only for the provider's explicit HTTP 403 origin denial, within one bounded request
budget. Treat the exact provider host/path/query allowlist as a security boundary.

Any unsupported, unavailable, unsafe, malformed, or excessive input falls back to
`get_view_legend_image`. Keep a lazy image comparison while structured rendering is being
validated.

## Alternatives considered

- **Always use MapX images:** safest compatibility, but preserves inaccessible and inflexible
  legend presentation.
- **Parse image pixels:** rejected because labels, semantics, and provider intent cannot be
  recovered reliably.
- **Parse generic SLD/GetStyles:** rejected because it introduces broad WMS/provider complexity.
- **Wait for an upstream MapX raster API:** remains the preferred long-term destination, but does
  not validate the current product need.
- **Use a generic open proxy:** rejected. Only explicitly approved provider destinations may use
  the MapX mirror.

## Consequences

- The viewer gains accessible structured legends for supported sources.
- Unsupported cases remain correct through the image fallback.
- New providers and style forms require explicit adapters, tests, review, and documentation.
- Runtime behavior depends partly on observed MapX fields and an internal mirror route.
- Direct requests disclose the visitor's IP to the approved provider; mirror requests disclose the
  requested URL to MapX.
- Live contract and browser visual checks are required in addition to unit tests.

## Review and retirement triggers

Review this decision if MapX offers an official structured legend API, upstream schemas/routes
change, provider approval changes, the adapter count grows materially, or mirror reliability/rate
limits become significant.

Prefer migration to an official MapX API. If these dependencies cannot be governed, remove
structured extraction and retain the MapX image fallback.

## 2026-10-23 extension: full configured catalogue

Extend the guarded raster adapter to the reviewed datacore layers, grouped raster
legends and numeric continuous ramps. GeoServer documents value-weighted linear
interpolation; retain stop quantities and text alongside the gradient. Keep exact
host/path/layer/query approval and existing bounded transport limits.

For the four configured custom-code views, use reviewed local legend definitions
pinned to SHA-256 of the upstream methods. Never evaluate upstream JavaScript.
Fall back on drift; the live catalogue audit makes that drift visible before release.
This adds current catalogue coverage without a generic custom-code or SLD interpreter.

## 2026-11-09 extension: official SDK contract

MapX 1.14.3 now supplies `get_view_legend_json({ idView })`, with an explicit
provider and support status. This supersedes the vector catalogue extraction and
parent-page direct/mirror raster transport decisions above. Use computed `mapx`
vector rules and unchanged `geoserver` JSON through strict adapters. Preserve
continuous ramps, groups, local definitions and `get_view_legend_image` fallback.
ArcGIS is not implemented upstream.

SDK requests have a five-second consumer deadline, manager/view/language-scoped
success caching and shared in-flight requests. Failures are evicted for retry.
The envelope is limited to 256 KiB after delivery, entries to 500 and groups to 20.
This delivery limit bounds adapter work, not network buffering inside MapX.
MapX owns discovery, HTTP requests, credentials, redirects and mirror policy;
the parent no longer needs raster provider or mirror connection permissions.

Only the four hash-pinned custom-code definitions still read catalogue metadata,
solely to compare `data.methods`. Do not evaluate upstream code or treat successful
catalogue reads as a guarantee of that remaining metadata contract.
