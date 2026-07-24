# MapX legend acceptance matrix

This matrix is the pre-merge visual contract for native legends introduced in
[PR #2](https://github.com/PreventionWeb/undrr-risk-resilience-maps/pull/2). It separates
supported native rendering from intentional image fallback so the latter is not reported as a
failed conversion.

## Observable modes

Each rendered legend exposes a stable diagnostic marker:

| DOM marker                                                          | Meaning                                             |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| `data-legend-mode="local-structured"`                               | Provider/local configuration owns the native legend |
| `data-legend-mode="mapx-vector-structured"`                         | Native legend was derived from MapX vector rules    |
| `data-legend-mode="mapx-image" data-legend-reason="raster"`         | Authoritative raster image fallback                 |
| `data-legend-mode="mapx-image" data-legend-reason="<other-reason>"` | Labelled unsupported-style/catalogue fallback       |
| `data-legend-comparison="mapx-image"`                               | Lazy comparison image under a structured legend     |

Fallback reasons are adapter output, not strings inferred by the acceptance tester.

## Representative matrix

| Case                          | Candidate layer/view                                  | Expected mode                                          | Comparison focus                                                        | Status                                                               |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Provider-owned polygon        | EDRA crop-yield reduction                             | `local-structured`                                     | Live EDRA colours, thresholds, no-data, crop/scenario changes           | Pending connected-browser rerun                                      |
| Provider-owned raster classes | River Flooding → Depth                                | `local-structured`                                     | Local labels/order/colours versus collapsed MapX image                  | Pending connected-browser rerun                                      |
| MapX point vector             | AAL — Public Assets                                   | `mapx-vector-structured`                               | Title, order, labels, point sizes, opacity, no-data                     | Pending connected-browser rerun                                      |
| MapX polygon vector           | Intact Forest Landscapes or Water Stress              | Structured if schema supported                         | Confirm actual MapX geometry first; then colour, border, order, no-data | Pending connected-browser rerun                                      |
| Long categorical vector       | Select a current project view with >20 rules          | `mapx-vector-structured` or labelled fallback          | Scrolling, keyboard focus, order, truncation, comparison image          | Pending suitable live view                                           |
| Raster                        | Earthquake PGA → 250 yr                               | `mapx-image` / `raster`                                | Explicit raster label; image remains legible and authoritative          | Upstream image observed 2026-07-24; new fallback label needs recheck |
| Sprite vector                 | Select a current sprite-styled view                   | `mapx-image` / `unsupported-style`                     | Reason label and authoritative symbol image                             | Pending suitable live view                                           |
| Custom-coded view             | Earthquakes (live)                                    | No structured legend; image only if MapX supplies one  | No misleading empty/native legend                                       | Pending connected-browser rerun                                      |
| Missing/late catalogue view   | Public cross-project vector added after another layer | Structured after one refresh, otherwise `catalog-miss` | Cache refresh and label correctness                                     | Automated regression covered                                         |
| Rapid compound source change  | Any AAL/PML compound layer                            | Latest source only                                     | No stale title/rules after switching before the first legend resolves   | Automated regression covered                                         |

## Pass criteria for native-versus-image comparison

For every structured row:

1. Open the layer and record the `data-legend-mode`.
2. Expand **Show MapX image legend (comparison)**.
3. Compare title, rule count and order, labels/ranges, colours, opacity, symbol geometry and size,
   borders, and no-data display.
4. Test the legend at 200% browser zoom and traverse the scroll region by keyboard.
5. Capture a screenshot and record any difference as either a defect or a documented intentional
   presentation change.

For every fallback row:

1. Confirm the visible label explains raster or unsupported-style behavior.
2. Confirm no native legend is presented as equivalent.
3. Confirm a missing MapX image fails without breaking opacity, source switching, or layer removal.

## Upstream dependency

MapX already tracks structured raster legends in
[unep-grid/mapx#288](https://github.com/unep-grid/mapx/issues/288). The viewer has added its SDK
use case and questions in
[this follow-up](https://github.com/unep-grid/mapx/issues/288#issuecomment-5072297282).

Do not add pixel parsing or generic WMS SLD parsing to the vector adapter. Revisit raster-native
support only through a separate adapter backed by a supported structured MapX/provider contract.
