# ADR 0001: Guarded structured legends with image fallback

- Status: Proposed
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
