# Implementation patterns

> Reference patterns for building MapX SDK embed apps. See [ARCHITECTURE.md](../ARCHITECTURE.md) for how these patterns are applied and [PRD.md](../PRD.md) for what we're building.

## 1. Project scaffolding

### Vite MPA setup

Vite handles multi-page apps by listing HTML entry points in `rollupOptions.input`. Each page gets its own JS chunk; shared modules are deduped automatically.

```js
// vite.config.js
export default defineConfig({
  root: ".",
  base: "/your-project/",       // deploy path
  server: { port: 3001 },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        landing: "index.html",
        "kitchen-sink": "demos/kitchen-sink/index.html",
        // ... one entry per page
      },
    },
  },
  test: { environment: "jsdom" },
});
```

For our project, we likely need fewer pages (maybe just a landing page and the main map viewer), but the pattern stays the same.

### Dependencies

The demo repo has zero runtime dependencies. Everything is dev:

- `vite@^6.0.0` -- build + dev server
- `vitest@^2.1.0` + `@vitest/coverage-v8` -- unit tests (jsdom)
- `@playwright/test@^1.49.0` -- E2E tests
- `jsdom@^29.0.0` -- DOM for tests

MapX SDK is loaded as a UMD script from CDN, not installed via npm.

### Production server

`server.js` is a plain Node HTTP server (~50 lines) that serves `dist/` if it exists, otherwise falls back to the project root. It has MIME type mapping and path traversal protection. No Express, no framework. We can reuse this directly.

### HTML boilerplate

Every page follows this order:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Page Title</title>
  <!-- Mangrove CSS from CDN -->
  <link rel="stylesheet" href="https://assets.undrr.org/static/mangrove/1.4.0/css/style.css" />
</head>
<body>
  <!-- UNDRR page header -->
  <!-- Page content (sidebar + map container) -->
  
  <!-- CRITICAL: UMD must load BEFORE module script -->
  <script src="https://app.mapx.org/sdk/mxsdk.umd.js"></script>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

The SDK UMD script sets `window.mxsdk` as a global. The module script runs second and can reference it.

## 2. Mangrove integration

### Loading

Single CSS link from UNDRR assets CDN. No JS component library, no npm package -- just the stylesheet.

```html
<link rel="stylesheet" href="https://assets.undrr.org/static/mangrove/1.4.0/css/style.css" />
```

### Font sizing

Mangrove 1.4.0 sets `html { font-size: 16px }` and uses `rem` throughout. All custom CSS in the demo repo uses `rem` accordingly (0.75rem = 12px, 1rem = 16px, etc.).

### Components we use

**Page header** (UNDRR black bar with Sendai 4-colour stripe):
```html
<header class="mg-page-header mg-page-header--default">
  <div class="mg-page-header__decoration">
    <div></div><div></div><div></div><div></div>
  </div>
  <div class="mg-page-header__toolbar-wrapper">
    <div class="mg-page-header__container mg-container">
      <div class="mg-page-header__region mg-page-header__region--toolbar">
        <section class="mg-page-header__block mg-page-header__block--logo">
          <a href="https://www.undrr.org">
            <img src="https://assets.undrr.org/static/logos/undrr/undrr-logo-horizontal.svg"
                 alt="UNDRR Logo" class="mg-page-header__logo-img" />
          </a>
        </section>
      </div>
    </div>
  </div>
</header>
```

**Buttons**: `mg-button`, `mg-button-primary`, `mg-button-secondary`. Active state via `is-active` class (custom override turns it blue #004f91).

**Tags/badges**: `mg-tag`, `mg-tag--accent` (orange, raster layers), `mg-tag--secondary` (grey, vector layers).

**Cards**: `mg-card mg-card__vc` for vertical cards, `mg-card__icon` for icon cards. Content in `mg-card__content`, heading in `mg-card__title`, body in `mg-card__summary`.

**Grid**: `mg-grid mg-grid__col-4` (4-column responsive grid).

**Layout**: `mg-container` (centered max-width), `mg-container--padded` (vertical padding).

**Utilities**: `mg-u-background-color--blue-900`, `mg-u-color--white`, `mg-u-font-size-500`, `mg-u-sr-only` (screen reader only).

### Custom overrides

The demo's `shared.css` (760 lines) overrides Mangrove for:

- Button active state (`.mg-button.is-active` → blue background)
- Smaller tag sizing for layer type badges
- Sidebar + map flexbox layout (not a Mangrove component)
- Floating panels (legends, analysis tools, coordinate bar)
- Disabled button state (opacity 0.4, no pointer events)

### Colour palette (from Mangrove)

| Token | Hex | Use |
|---|---|---|
| Blue-900 | #004f91 | Primary interactive, active states |
| Blue-700 | #3372a7 | Hover states |
| Neutral-800 | #1a1a1a | Text, dark backgrounds |
| Neutral-100 | #ccc | Borders |
| Sendai Red | #c10920 | Danger, alerts |
| Sendai Orange | #eb752a | Accent, raster tags |
| Sendai Purple | #962987 | Story maps |
| Sendai Turquoise | #00afae | Explorer highlights |

## 3. MapX SDK integration

### Manager creation

Single global instance, stored in a module-scoped variable.

```js
// src/sdk/client.js
let _mapx = null;

export function initSDK(container) {
  _mapx = new mxsdk.Manager({
    container,                          // DOM element for iframe
    url: "https://app.mapx.org/?project=MX-PROJECT-ID",
    params: {
      closePanels: true,                // hide MapX's own sidebar
      language: "en",
      theme: "color_light",
    },
    style: {
      width: "100%",
      height: "100%",
      border: "none",
    },
  });
  return _mapx;
}

export function getSDK() {
  if (!_mapx) throw new Error("SDK not initialised");
  return _mapx;
}
```

Other modules call `getSDK().ask(...)` to send commands. The Manager creates an iframe inside the container element.

### Initialization sequence

```js
// src/main.js
initPinGate();                              // 1. PIN overlay (if needed)
const mapx = initSDK(document.getElementById("mapx"));  // 2. Create iframe

mapx.on("ready", async () => {              // 3. Wait for MapX to load
  buildViewButtons();                       // 4. Build sidebar UI
  enableActionButtons();                    // 5. Wire toolbar
  await mapx.ask("set_vector_highlight", { enable: true }); // 6. Enable clicks
  initCoordinateDisplay(2000);              // 7. Start polling
});

mapx.on("click_attributes", (...args) => {  // 8. Listen for feature clicks
  showInfobox(args.length === 1 ? args[0] : args);
});
```

Everything after `initSDK` must wait for `ready`. The map isn't interactive until then.

### SDK wrapper modules

Each area of SDK functionality is wrapped in a thin module under `src/sdk/`:

| Module | What it wraps |
|---|---|
| `client.js` | Manager lifecycle (initSDK, getSDK) |
| `views.js` | view_add, view_remove, view_geojson_create, getViewMeta, getViewLegendImage |
| `filters.js` | setViewLayerTransparency, getViewLayerTransparency, setViewLayerFilterText, setViewLayerFilterNumeric |
| `map-control.js` | mapFlyTo, mapGetZoom, commonLocFitBbox, setProjection, set3dTerrain, setModeAerial |
| `ui.js` | setVectorHighlight, setLanguage, setTheme |
| `data-query.js` | getViewSourceGeojson, getViewTableAttribute, getViewSourceSummary |
| `map-layers.js` | Mapbox GL passthrough (addSource, addLayer, removeSource, removeLayer, queryRenderedFeatures) |

Each is a one-liner wrapper around `getSDK().ask("method_name", params)`. The point is to centralize SDK calls so nothing else in the app touches `ask()` directly.

## 4. Parent page and MapX iframe coordination

### Page layout

```
┌────────────────────────────────────────────────────────┐
│ mg-page-header (UNDRR black bar + Sendai stripe)       │
├──────────────┬─────────────────────────────────────────┤
│ .app-sidebar │ .app-map                                │
│ (320px,      │ (flex: 1, position: relative)           │
│  overflow-y: │                                         │
│  auto)       │  ┌─ map toolbar (absolute, top-left)    │
│              │  │                                      │
│ [View btns]  │  │  MapX iframe (100% x 100%)          │
│ [Controls]   │  │                                      │
│              │  └─ legend panel (absolute, bottom-right)│
│              │     coord bar (absolute, bottom)         │
├──────────────┴─────────────────────────────────────────┤
│ (optional footer)                                       │
└────────────────────────────────────────────────────────┘
```

CSS is flexbox: sidebar has fixed width, map fills remaining space. Floating panels (legend, toolbar, coordinates) are positioned absolutely within `.app-map`.

### View toggle pattern

The core interaction: user clicks a button in the sidebar, a layer appears/disappears on the map.

```js
// src/ui/view-buttons.js
async function toggleView(idView, btn, wrapper) {
  if (store.openViews.has(idView)) {
    await viewRemove(idView);           // SDK call
    store.openViews.delete(idView);     // Update local state
    btn.classList.remove("is-active");  // Update button visual
    removeTransparencySlider(wrapper);  // Remove slider
    removeLegend(idView);              // Remove legend entry
  } else {
    await viewAdd(idView);
    store.openViews.add(idView);
    btn.classList.add("is-active");
    addTransparencySlider(idView, wrapper);
    addLegend(idView, label);
  }
}
```

`store.openViews` (a Set) is the source of truth for what's active. There's no synchronous "is this view open?" SDK method, so the parent page tracks it locally.

### Transparency/opacity inversion

The SDK uses **transparency** (0 = opaque, 100 = invisible). The UI shows **opacity** (0 = invisible, 100 = fully visible). Conversion: `transparency = 100 - opacity`.

```js
// Reading from SDK → UI
const transparency = await getViewLayerTransparency(idView);
slider.value = String(100 - transparency);  // invert for display

// Writing from UI → SDK
slider.addEventListener("input", async () => {
  const opacity = Number(slider.value);
  await setViewLayerTransparency(idView, 100 - opacity);  // invert for SDK
});
```

### Click event flow

1. User clicks a feature on the map (inside the iframe)
2. MapX fires `click_attributes` via postMessage
3. Parent page receives the event with feature properties
4. If properties are present (MapX-managed view), display them directly
5. If properties are empty (passthrough layer), search the local GeoJSON registry by coordinates
6. Render an infobox popup with the properties as a table

The GeoJSON registry (`store.customGeoJSONRegistry`) stores data for layers added via `map.addSource/addLayer` or `view_geojson_create`, since MapX doesn't track click data for those.

### Legend panel

When a view is toggled on, the parent page fetches the legend image:

```js
const legendData = await getViewLegendImage(idView);
// Returns base64 PNG string or data URL
```

The image is appended to a floating panel positioned at bottom-right of the map. Multiple legends stack vertically. Panel hides when no legends are active.

### Country/region navigation

The SDK provides `commonLocGetListCodes()` which returns available country (ISO 3166) and region (M49) codes. These populate a dropdown. On selection:

```js
await commonLocFitBbox(code, { duration: 2000 });  // fly to country bbox
```

### For the GRI Risk Viewer clone

The patterns above map directly to what we need:

| GRI feature | Demo pattern to reuse |
|---|---|
| Tabbed sidebar with layer toggles | `view-buttons.js` toggle pattern, but organized by tab (risk/resilience/hazard/exposure/vulnerability) instead of flat list |
| Per-layer controls (sliders, dropdowns) | Extend the transparency slider pattern with additional control types per layer |
| Show/hide eye toggle | Same as `toggleView()` with `is-active` class |
| Legend panel | `legends.js` as-is |
| Site inspection / feature popup | `infobox.js` click handler |
| URL state encoding | New -- GRI encodes layer state in URL query params. Not in the demo. |
| Cross-tab layer persistence | New -- other tabs' layers stay collapsed but accessible. Not in the demo. |
| Basemap toggle | `setModeAerial("toggle")` already in demo |
| Country click-through | New -- click feature → open external country page URL |

### What we need to build fresh

- **Accordion sidebar** with category → layer → controls hierarchy (the demo uses a flat button list)
- **Per-layer control widgets** that vary by layer type (sliders, dropdowns, toggles) -- the demo only has transparency sliders
- **URL state encoding** for deep-linkable layer configurations
- **Metadata panels** per layer (source attribution, download links)
- **Resilience review category** with disabled layer entries and eventual cross-links to external indicator content
