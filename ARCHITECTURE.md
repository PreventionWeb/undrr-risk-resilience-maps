# Architecture

> Keep this document updated as the project evolves.
>
> Based on patterns proven in [mapx-demo-embed](../mapx-demo-embed/) (documented in [research/implementation-patterns.md](research/implementation-patterns.md)). Adapted for the requirements in [PRD.md](PRD.md). See [research/gri-ux-analysis.md](research/gri-ux-analysis.md) for the GRI interaction model this architecture targets. See [METHODOLOGY.md](METHODOLOGY.md) for MapX API/SDK discovery approach.

## Overview

Static site, no backend. The app embeds MapX in an iframe via the SDK's postMessage bridge and wraps it in a sidebar UI styled with Mangrove. See the [PRD](PRD.md) for what we're building; this doc covers how.

## Proposed structure

```
undrr-risk-resilience-maps/
├── index.html                  # Landing / main entry
├── src/
│   ├── config/                 # Layer definitions, tab structure, regions
│   ├── sdk/                    # MapX SDK wrapper modules
│   ├── state/                  # Global state (open views, registries)
│   ├── ui/                     # UI components (sidebar, popups, metadata)
│   ├── lib/                    # Pure utility functions
│   └── styles/                 # CSS (shared + page-specific)
├── tests/
│   ├── unit/                   # Vitest
│   └── e2e/                    # Playwright
├── vite.config.js
├── server.js                   # Static production server
└── package.json
```

## Architectural decisions

### MapX SDK integration (iframe + postMessage)

MapX runs in an iframe. All communication goes through `mxsdk.Manager`, which uses `window.postMessage` RPC under the hood. SDK methods are wrapped in thin facade modules under `src/sdk/` so nothing else in the app touches postMessage directly.

```
Browser tab
  ├── Our app (parent window)
  │     ├── src/sdk/client.js    → mxsdk.Manager lifecycle
  │     ├── src/sdk/views.js     → view add/remove/query
  │     ├── src/sdk/filters.js   → layer transparency, filters
  │     └── src/sdk/map-control.js → flyTo, zoom, projection
  │
  └── MapX iframe (cross-origin)
        └── communicates via postMessage ↕
```

### Tabbed layer model

Layers are organised into sidebar tabs matching the Risk & Resilience framework categories (Hazard, Exposure, Vulnerability, Risk). Each tab renders a list of toggleable layers with per-layer controls (sliders, dropdowns, opacity). See [research/gri-ux-analysis.md](research/gri-ux-analysis.md) for the full breakdown of control widget types. Layer definitions live in `src/config/`.

### State management

Plain ES module exports with setter functions, no framework. Lightweight enough for this class of app, proven in mapx-demo-embed.

**Terminology note:** in the MapX SDK, a dataset on the map is called a "view." In our UI and docs, we call them "layers" (what the user sees). The code uses both: `openViews` is the SDK-facing set, but UI labels say "layer."

- `openViews` (Set) -- tracks which MapX views (layers) are currently active
- Per-tab state: visibility, opacity, filter values

### UI layer (Mangrove)

All styling builds on the [UNDRR Mangrove component library](https://assets.undrr.org/testing/static/mangrove/) (CSS only, no JS framework). Components used:

- `mg-page-header` — UNDRR branding bar
- `mg-button` / `mg-tag` — interactive controls and layer type badges
- `mg-card` — metadata panels
- `mg-container` / `mg-grid` — responsive layout
- Utility classes (`mg-u-*`) for spacing, colour, typography

### Feature popups and click handling

MapX fires `click_attributes` events on vector feature clicks. For passthrough Mapbox GL layers (custom GeoJSON), features are cached in a local registry and matched via spatial lookup (ray casting for polygons, proximity for points).

### Country page linking

Clicking a country opens the external Risk & Resilience country page. Just a URL template, not a deep SDK integration.

### Dual map views

The GRI model allows up to two simultaneous map panels. Each panel needs its own `mxsdk.Manager` instance (its own iframe). We did this in mapx-demo-embed's metrics demo (scrollytelling map + country deep-dive map).

## Build pipeline

- Vite dev server with hot reload
- Vite/Rollup produces static assets to `dist/`
- Serve with the Node.js static server (`server.js`) or any static host
- No backend needed. All data comes from MapX.

## Testing

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest (jsdom) | Pure functions, config validation, state mutations |
| E2E | Playwright (Chromium) | SDK connection, layer toggles, click interactions, navigation |

## What this is not

- Not a full geospatial analysis platform (no draw-box queries, spatial mining)
- Not a data viz tool beyond risk-to-resilience scope
- Not an SPA. If multiple pages are needed, use Vite MPA (one HTML entry per page).
