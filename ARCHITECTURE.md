# Architecture

> See [docs/product-spec.md](docs/product-spec.md) for V1 scope. See [research/gri-ux-analysis.md](research/gri-ux-analysis.md) for the GRI interaction model that informed the prototype. See [METHODOLOGY.md](METHODOLOGY.md) for MapX API/SDK discovery approach.
> Runtime external-layer governance, source-tracker instructions, measured performance, and production trade-offs are documented in [docs/external-layers.md](docs/external-layers.md).
> Legend architecture, upstream contracts, troubleshooting, and regression QA are documented in [docs/legends.md](docs/legends.md).

## Overview

Static site, no backend. The app embeds MapX in an iframe via the SDK's postMessage bridge and wraps it in a sidebar UI styled with Mangrove (v1.8.0). See [docs/product-spec.md](docs/product-spec.md) for what we're building; this doc covers how.

## Structure

```
undrr-risk-resilience-maps/
├── index.html                  # Main entry point
├── data/
│   └── inventory.csv           # Master metadata, delivery status, and permanent MapX IDs
├── scripts/
│   └── import-inventory.mjs    # CSV → JS config import tool (dry-run + --apply)
├── src/
│   ├── pin-gate.js             # Preview PIN gate (sessionStorage auth)
│   ├── main.js                 # App bootstrap: validates config, builds UI, inits SDK
│   ├── config/
│   │   ├── layers/             # Per-category layer definitions
│   │   │   ├── index.js        # Assembles TABS array, withR2rGroups() helper
│   │   │   ├── projects.js     # MapX project IDs (ECO_DRR, HOME, CDC)
│   │   │   ├── status.js       # isLayerPublished(), getLayerStatus() helpers
│   │   │   ├── hazard.js
│   │   │   ├── exposure.js
│   │   │   ├── vulnerability.js
│   │   │   ├── risk.js
│   │   │   └── resilience.js
│   │   └── validate.js         # Startup config validation (throws on errors)
│   ├── sdk/                    # MapX SDK wrapper modules
│   │   ├── client.js           # mxsdk.Manager lifecycle + SDK readiness flag
│   │   ├── views.js            # view add/remove/query
│   │   ├── legend-model.js     # Shared structured legend model + safety limits
│   │   ├── legends.js          # MapX catalogue + vector legend adapter/dispatcher
│   │   ├── raster-legends.js   # Approved GeoServer raster legend adapter
│   │   ├── filters.js          # layer transparency, filters
│   │   ├── inspect.js          # click_attributes batch collector, generation guard
│   │   └── map-control.js      # flyTo, zoom, projection
│   ├── external/               # Runtime external-provider boundary
│   │   ├── index.js            # Generic provider contract + temporary-view registry
│   │   └── edra-agriculture.js # EDRA fetch, cache, reprojection, join, and MapX adapter
│   ├── state/
│   │   ├── store.js            # openViews Set, activeTab, activeSourceIndex Map
│   │   └── hash.js             # URL hash encoding/decoding + layer index lookup
│   ├── ui/
│   │   ├── sidebar.js          # Nav routing, layer panel, accordions, clear-all
│   │   ├── layer-controls.js   # Per-layer opacity slider and legend renderer
│   │   ├── external-controls.js # Provider-neutral external-layer controls
│   │   ├── home.js             # Home page cards
│   │   ├── info-panels.js      # Sources and About full-page views
│   │   ├── infobox.js          # Feature click popup (legacy; superseded by site-inspector)
│   │   ├── site-inspector.js   # Inspect mode: click → Site Details panel
│   │   └── widgets/            # Source-switching widgets (registry pattern)
│   │       ├── index.js        # Widget registry + isCompound helper
│   │       ├── sub-tabs.js     # Button bar for metric switching
│   │       └── stepped-slider.js # Range slider for return periods
│   └── styles/
│       ├── shared.css          # CSS entry point (@imports)
│       ├── tokens.css          # Design tokens (custom properties)
│       └── components/         # Per-component CSS files
│           ├── layout.css      # App shell, nav, info-page containers
│           ├── pin-gate.css    # PIN gate overlay
│           ├── layer-panel.css # Floating sidebar panel
│           ├── layer-accordion.css # Layer items + R2R group headings
│           ├── opacity-slider.css
│           ├── legend.css
│           ├── home-panel.css  # Info page hero, sections, cards, Sources table
│           ├── panels.css      # Drag + resize for layer panel and Site Details
│           ├── site-inspector.css
│           ├── widgets.css     # Sub-tabs and stepped-slider
│           └── infobox.css
├── .github/workflows/deploy.yml # GitHub Pages CI
├── vite.config.js
├── server.js                   # Static production server (for previewing dist/)
└── package.json
```

## Architectural decisions

### Startup sequence

The app initialises in two phases to keep the UI responsive even if the MapX SDK is slow to load:

1. **Immediate** — `validateLayers()` runs first and throws on config errors. `buildSidebar()` follows: nav links are wired, info pages are built, and layer accordions are rendered. The user can read the home, Sources, and About pages without waiting for the map.
2. **On SDK ready** — once `mapx.on("ready")` fires, `setSDKReady(true)` unlocks layer toggles, vector highlight is enabled, and any layers in the URL hash are restored.

Layer toggle buttons check `isSDKReady()` before calling SDK methods, so clicking a layer before the map has loaded produces a console warning rather than a silent failure.

### MapX SDK integration (iframe + postMessage)

MapX runs in an iframe. All communication goes through `mxsdk.Manager`, which uses `window.postMessage` RPC under the hood. SDK methods are wrapped in thin facade modules under `src/sdk/` so nothing else in the app touches postMessage directly.

```
Browser tab
  ├── Our app (parent window)
  │     ├── src/sdk/client.js    → mxsdk.Manager lifecycle + readiness flag
  │     ├── src/sdk/views.js     → view add/remove/query
  │     ├── src/sdk/legends.js   → catalogue + validated vector legend extraction
  │     ├── src/sdk/raster-legends.js → approved GeoServer raster legend extraction
  │     ├── src/sdk/filters.js   → layer transparency, filters
  │     ├── src/sdk/map-control.js → flyTo, zoom, projection
  │     └── src/external/        → external data adapters + runtime view registry
  │
  └── MapX iframe (cross-origin)
        └── communicates via postMessage ↕
```

**Single-project constraint:** the SDK connects to one MapX project at a time (`PRIMARY_PROJECT = ECO_DRR`). All enabled, pre-built MapX layers must belong to this project. `validateLayers()` enforces this at startup — any enabled layer with a different `project` value throws an error. Layers that belong to other projects (e.g. `HOME`) are marked `disabled: true` with a TODO comment until data is consolidated. Runtime external layers are exempt because they create temporary views within the connected project.

### Runtime external layers

An external layer has no permanent MapX view ID. Its config uses an `external` definition:

```js
{
  id: null,
  key: "edra-crop-yield-reduction",
  type: "vt",
  geometry: "polygon",
  external: {
    provider: "edra-agriculture",
    defaults: { crop: "WHEAT", scenario: "20" },
  },
}
```

`src/external/index.js` resolves the provider and maintains two runtime indexes: stable layer key → active temporary view, and temporary MapX ID → layer metadata. This lets external views use the same `store.openViews` Set, opacity controls, clear-all behavior, hash restore, and site inspector as pre-built MapX views.

The EDRA adapter reproduces the source explorer's data pipeline:

1. Fetch simplified NUTS-2 polygons from the EDRA WFS-like service.
2. Reproject coordinates from EPSG:3035 to WGS84 GeoJSON.
3. Fetch agriculture values for the selected crop and join on NUTS code.
4. Fetch the source explorer's live configuration and validate the selected crop's style buckets.
5. Generate both the MapX paint expression and HTML legend from that style, then create a
   non-persistent `MX-GJ-*` GeoJSON view.

Changing a crop or scenario creates a candidate replacement before deleting the prior view. The
runtime registry is updated only after MapX confirms that the old view was removed; failed
replacements are cleaned up and the prior registration remains authoritative. The map camera is
captured and restored because MapX automatically fits the extent of each newly created GeoJSON
view. Geometry, values, and the upstream style configuration are cached in the page session, and
failed requests are evicted so they can be retried. The stable layer key plus provider settings are
stored in the URL so shared links and browser history reproduce the selected crop and scenario.

This is an exception path, not the default ingestion model. It adds a direct browser dependency on
the source service plus client-side CPU, memory, and `postMessage` cloning costs. Keep
provider-specific URLs, fields, projections, joins, and styles inside the adapter. See
[docs/external-layers.md](docs/external-layers.md) for the dependency flow, measured EDRA payload,
programme tracker row, operational risks, and migration triggers.

### Navigation and layer panel

Category tabs (Risk & Resilience, Hazard, Exposure, Vulnerability) live in a Mangrove `mg-mega-topbar` navigation bar. Home, Sources, and About provide the remaining informational views.

**Two routing modes driven by `switchTab()`:**

- **Info tabs** — hide the map (`#app-map`), show the full-page `#info-page` container, display the matching info panel.
- **Data tabs** — show the map, show the floating layer panel with the matching tab's layers.

Tabs whose layers span multiple R2R categories (Societies / Economy / Environment) are grouped by the `withR2rGroups()` helper in `src/config/layers/index.js`. Each group renders as a `<details>`/`<summary>` element in the sidebar, open by default, with a collapsible arrow. Tabs with only one category (e.g. Hazard) render flat. The `groups` field is `null` for flat tabs; the sidebar checks it and renders accordingly.

The active tab and open layers are encoded in the URL hash (format: `#tab?layers=key:sourceIdx,...`) so links are shareable and browser back/forward works. On `hashchange`, both the active tab and the open layer set are reconciled against the new URL.

The current repository owns the **map registry** only: tab structure, layer metadata, MapX view IDs, legends, and map interaction. Future resilience indicators or chart-based content are expected to live in a separate system and be cross-linked from this app when appropriate. To keep that future path open, placeholder resilience entries can exist here before their final delivery format is settled.

Layer configs may also be retained in unpublished review states such as **disabled**, **disabled-awaiting-data**, or **disabled-pending-removal**. These layers are hidden from the sidebar by default, but can be revealed with a review toggle in the layer panel header. They still appear in the Sources page and layer inventory export so content decisions remain visible and reversible.

### Simple vs compound layers

A **simple layer** maps to one permanent MapX view ID. A **compound layer** groups multiple related views under a single accordion item with a widget to switch between them. A **runtime external layer** maps a stable config key to a temporary MapX view ID while it is active. Only one source view is active on the map at a time.

```js
{
  id: null,
  label: "Earthquake PGA",
  type: "rt",
  sources: [
    { id: "MX-J3YTW-...", label: "250 yr" },
    { id: "MX-4XSGY-...", label: "475 yr" },
    // ...
  ],
  widget: { type: "stepped-slider", label: "Return period" },
}
```

**Widget types** are registered in `src/ui/widgets/index.js`:

| Type             | UI                           | Use case                                                      |
| ---------------- | ---------------------------- | ------------------------------------------------------------- |
| `sub-tabs`       | Button bar                   | Switching between data metrics (depth / frequency / exposure) |
| `stepped-slider` | Range input with tick labels | Selecting return periods or thresholds                        |

To add a new widget type: create a factory function in `src/ui/widgets/`, register it in the index. No changes to `sidebar.js` needed.

**Duplicate view ID constraint:** each MapX view ID must appear at most once across all layer configs. Reusing the same ID in two layers corrupts `openViews` state (the Set can't tell them apart) and breaks hash serialisation. `validateLayers()` treats duplicates as errors.

### State management

Plain ES module exports with setter functions, no framework.

**Terminology note:** in the MapX SDK, a dataset on the map is called a "view." In our UI and docs, we call them "layers." The code uses both: `openViews` is the SDK-facing set, but UI labels say "layer."

- `openViews` (Set) — MapX view IDs currently active on the map
- `activeTab` (string) — currently selected tab ID
- `activeSourceIndex` (Map) — for compound layers, tracks which source is selected

### UI layer (Mangrove)

All styling builds on the [UNDRR Mangrove component library](https://assets.undrr.org/static/mangrove/1.8.0/css/style.css) (v1.8.0). Components used:

- `mg-page-header` — UNDRR branding bar with Sendai stripe
- `mg-mega-topbar` — category navigation bar (Simple Nav variant)
- `mg-card`, `mg-card__icon--bordered` — interactive category cards on the home page
- `mg-highlight-box` — callout boxes on info pages
- `mg-button` / `mg-tag` — interactive controls and layer type badges
- `mg-container` — centred layout
- `mg-table` — feature attribute table in the infobox

### Layer panel controls

The floating layer panel includes:

- **Per-layer accordions** — expand to reveal opacity slider, legend, and source-switching widget. Built by `buildLayerAccordion()` in `sidebar.js`; returns `{ wrapper, eyeBtn }` so the sidebar can maintain a `layerElementMap` (key → DOM references) without positional DOM queries.
- **Eye toggle** — turns a layer on/off; aria-pressed reflects state
- **Show disabled toggle** — reveals unpublished review-only layer entries in the current category without making them toggleable on the map
- **Clear all button** — appears in the panel header; iterates `layerElementMap` to turn off all active layers across all tabs at once
- **Opacity slider / legend** — rendered by `src/ui/layer-controls.js` after a layer is turned on. The SDK uses "transparency" (0 = opaque, 100 = invisible); the UI presents "opacity" (inverse). Legend priority is: a provider-owned structured legend; validated MapX vector rules from `get_views`; discrete GeoServer raster `intervals`/`values` from an approved provider; then the MapX image fallback. Raster requests first contact the exact approved provider endpoint and retry its explicit HTTP 403 origin denial through the allowlisted MapX mirror within one bounded request budget. Network failures and redirects go directly to the image fallback. Continuous ramps, unapproved providers, sprites, custom code, malformed responses, and excessive rule sets deliberately retain a labelled image rather than risk a misleading approximation. The full security boundary, fallback reasons, operations, and regression procedure are in `docs/legends.md`. While the structured renderer is being validated, its MapX image is also available in a collapsed comparison disclosure, lazy-loaded on first expansion. The catalogue cache is scoped to the active SDK manager and refreshes once on a missing view because `view_add` can introduce public cross-project views after initialisation. Async renders use a DOM ownership marker so a closed layer or superseded compound source cannot append stale legend content.

### Feature popups and click handling

MapX fires `click_attributes` events on vector feature clicks. The SDK emits varying arg shapes depending on view type; `main.js` normalises all payloads to `{ attributes: ... }` before passing them to `showInfobox()`. The infobox uses a single managed `keydown` handler that is removed on every close path (Escape key or close button).

### URL hash and shareability

Format: `#tab?layers=key:sourceIdx,key:sourceIdx,...`

- Simple layers: just the key (e.g. `population`)
- Compound layers: key + source index (e.g. `earthquake-pga:2`); index 0 is omitted for brevity
- On initial load, `restoreLayersFromHash()` validates and clamps source indices before applying them. Source index is always set (including 0) to ensure any prior state is cleared.
- On `hashchange`, `reconcileLayersFromHash()` diffs current state against the new URL: turns layers off if absent, turns them on with correct source if present, and switches source directly (via `switchSource`) if a compound layer stays on but its source index changes.

## Build pipeline

- Vite dev server with hot reload
- Vite/Rollup produces static assets to `dist/`
- Serve with the Node.js static server (`server.js`) or any static host
- No application backend is needed. Runtime data can come from MapX and explicitly approved external providers; some legend requests may use the MapX mirror.

## Testing

Vitest + jsdom is configured in `vite.config.js`. Run tests with `yarn test`.

Test files cover pure and near-pure modules:

| File                                    | What it tests                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/state/hash.test.js`                | `parseHash`/`writeHash` round-trips, `getLayerByKey`, `getTabForLayerKey`                         |
| `src/config/validate.test.js`           | All error conditions (missing IDs, duplicate views, wrong project, legend schema)                 |
| `src/ui/widgets/sub-tabs.test.js`       | DOM construction, initial state, callbacks, aria roles                                            |
| `src/ui/widgets/stepped-slider.test.js` | DOM, initial state, debounce behaviour                                                            |
| `src/ui/infobox.test.js`                | Hide/show, title resolution, SKIP_KEYS, Escape/close, XSS escaping, singleton handler             |
| `src/ui/site-inspector.test.js`         | Panel build, view index, batch collection, generation guard, raster fallback                      |
| `src/ui/layer-controls.test.js`         | Opacity inversion semantics, SDK error fallbacks, legend swatches, SDK image fallback/diagnostic  |
| `src/sdk/legends.test.js`               | MapX style normalisation, localisation, safety limits, unsupported-style fallbacks, request cache |
| `src/sdk/legend-model.test.js`          | Shared color/text/value safety and localization rules                                             |
| `src/sdk/raster-legends.test.js`        | Provider policy, mirror retry, bounded streaming, GeoServer schema, diagnostics, timeout          |
| `src/sdk/inspect.test.js`               | `click_attributes` batching, generation counter, discard of stale events                          |
| `src/utils/export-layers.test.js`       | BOM, CRLF, headers, compound layer expansion, project labels, disabled status, CSV quoting        |

`sidebar.js` integration tests (hash restore, reconcile, clear-all) are not yet written — testing them requires a full DOM with `buildSidebar()` and mocked SDK modules.

`yarn test:mapx-raster-contract` is a manual, network-dependent check of the configured Earthquake
PGA views, GIRI GeoServer JSON, and the MapX mirror. See `docs/legends.md` for cadence and browser
visual regression steps.

## What this is not

- Not a full geospatial analysis platform (no draw-box queries, spatial mining)
- Not a data viz tool beyond risk and resilience scope
- Not an SPA. If multiple pages are needed, use Vite MPA (one HTML entry per page).
