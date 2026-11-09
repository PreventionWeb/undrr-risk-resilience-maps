# TODO

Deferred technical items — implementation details, refactors, and infrastructure tasks. For the production work plan (hosting, branding, access control, analytics, etc.) see [docs/resourcing-plan.md](docs/resourcing-plan.md).

> See [LEARNINGS.md](LEARNINGS.md) for design decisions, SDK quirks, and hard-won knowledge.

## GAR 2026 launch content

- Revisit the temporary global inspection default after the info-window design and programme-lead preference are reviewed. The implementation remains available through `?inspect=1` / the `inspectionEnabled` option; `src/config/features.js` controls the central default.

- Add verified metric-specific methodology URLs to the inventory's `Explainer link` column. Coordinate stable anchors in the methodology page generator; the supplied workbook leaves these blank.
- Confirm licences for the 30 supplied GAR2026 maps (`TBD`) and reconcile subsequent map batches.
- Coordinate the GAR landing-page embed replacement after viewer review/release.

## Data downloads (prototype, #64)

- Decide with the programme whether to make downloads public (`MAP_DOWNLOADS_ENABLED` in `src/config/features.js`); until then `?downloads=1` opts in and "Request data" stays the public route.
- Follow up the open questions for UNEP/GRID-Geneva in [docs/downloads.md](docs/downloads.md#limitations-and-open-questions-for-grid): whether GRID are happy with special areas being exported, the view missing region columns, SDK table reads as a supported use, labels/units, and the four views that are not region-level.
- Run `yarn test:downloads-contract` before each release while downloads are behind the flag, and whenever GRID replaces a hosted file or a CSV view changes (see the runbook in [docs/downloads.md](docs/downloads.md#maintenance)).

## State store upgrade

The current store (`src/state/store.js`) is a Set of open view IDs plus an active tab string. This works for basic layer toggling, but will need to grow when we add:

- **Per-layer filter state** -- numeric ranges, text filters, dropdown selections. Currently the only per-layer control is the opacity slider, which reads/writes directly to the SDK. Adding more filters means storing their values locally so we can restore state on tab switch or page reload.
- **Session persistence** -- saving the user's layer selections and filter settings to `localStorage` so they survive a page refresh.
- **URL state encoding** -- active layers and the active tab are already encoded in the URL hash (shareable links, back/forward). What isn't yet encoded: per-layer filter settings (opacity writes directly to the SDK, not to URL state) and sub-tab source index within compound layers. These will need URL encoding when session persistence lands.

The upgrade path: replace the flat Set with a keyed object (`{ [layerId]: { visible, opacity, filters } }`) and add `saveSession()` / `loadSession()` helpers. Do this before adding any filter widgets beyond opacity.

## MapX project consolidation

Create a dedicated UNDRR project in MapX that aggregates all needed data sources, keeping the SDK integration clean (one project, one iframe). Coordinate with the MapX platform contact at GRID-Geneva.

Cross-project `view_add` calls currently work in practice (see [LEARNINGS.md](LEARNINGS.md#mapx-sdk-cross-project-view_add)), so this is not blocking. We've asked MapX whether it's supported, or whether we should share the views into our project with "Manage external views" instead ([unep-grid/mapx#1134](https://github.com/unep-grid/mapx/issues/1134), item 1). Decide on consolidation once they answer.

## Widget event bus

The compound layer system (`src/ui/widgets/`) uses a callback pattern: each widget calls `onSourceChange(index)` which the sidebar routes to `controller.setSource()` (`src/services/layer-controller.js`). Source switching no longer lives in the sidebar, but other SDK calls (opacity, filters) are still wired per widget.

If we add filter widgets that need to call SDK filter methods (e.g. `set_view_layer_filter_text`, `set_view_layer_filter_numeric`), a lightweight event emitter would decouple widgets from specific SDK calls. Each widget would emit `{ type, layerId, value }` events, and a central handler would dispatch to the right SDK method.

Not blocking -- the current callback pattern works fine for source switching and opacity. Revisit when adding SDK filter widgets.

## Dual-panel map view

The GRI Risk Viewer supports side-by-side map panels. Each panel requires its own `mxsdk.Manager` instance (separate iframe). This is explicitly deferred to post-V1 — see [docs/product-spec.md](docs/product-spec.md). No code exists yet. MapX SDK multi-view support should be validated before this is scoped.

## MapX SDK version pinning

The SDK is currently loaded from `https://app.mapx.org/sdk/mxsdk.umd.js` with no version pin. A breaking MapX deployment could silently break the tool. Pin to a stable versioned URL once MapX confirms their versioning approach. See resourcing plan WP-7.

## Structured legend maintenance

Legends now use the official MapX 1.14.3 SDK JSON/image commands. Validate adapter changes
with recorded fixtures and representative image comparisons as described in `docs/legends.md`.
`yarn test:mapx-raster-contract` is an opt-in browser audit of the actual SDK path.
The four custom-code definitions still depend on catalogue `data.methods` for drift detection;
review that remaining metadata contract with MapX. Parent-page direct GeoServer and mirror
transport have been removed from legend resolution.

## External runtime layer production decision

The EDRA integration is intentionally a trial. Before production launch:

- Assign a programme owner and record the external-service review date.
- Complete privacy and CSP review for direct browser requests to CEMS.
- Add error/latency monitoring or explicitly accept console-only diagnostics.
- Test first-load behavior on representative low-power devices and constrained networks.
- Decide whether to keep runtime ingestion, host a preprocessed WGS84 geometry snapshot, or publish
  stable MapX views.

See [docs/external-layers.md](docs/external-layers.md) for measured costs, source-tracker guidance,
operational risks, migration triggers, and the merge-blocking acceptance checklist.

## Country profile click-through

Clicking a country on the map (via site inspection) should link to the UNDRR Risk & Resilience country profile page. Implementation is straightforward (S effort) once the URL pattern is confirmed by the programme team. See resourcing plan WP-4.

## Mangrove follow-ups

- Remove the temporary `eslint/**/minimatch` resolution when ESLint and `@eslint/config-array` adopt a patched minimatch release. The override uses 11.0.4 to address GHSA-g3hv-75wg-m249; ESLint's use of the retained `Minimatch.match()` API and the full project lint were checked. Yarn reports the intentional override of the upstream 10.x ranges.

- Updated to `2.3.0` (previous: `2.2.0`, `2.0.1`, `2.0.0`). CDN CSS and
  vanilla tabs/copy/preview modules are pinned together. The 2.3.0 release's
  runtime translation catalogues apply to React/hydrated components; the viewer
  remains English and uses vanilla modules with explicit labels.
- Continue checking future releases for changes to consumed tokens and classes.
  The 2.3.0 CSS review found no removed tokens used here.
