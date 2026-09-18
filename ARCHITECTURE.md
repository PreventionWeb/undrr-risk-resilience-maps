# Architecture

> See [docs/product-spec.md](docs/product-spec.md) for V1 scope. See [research/gri-ux-analysis.md](research/gri-ux-analysis.md) for the GRI interaction model that informed the prototype. See [METHODOLOGY.md](METHODOLOGY.md) for MapX API/SDK discovery approach.
> Runtime external-layer governance, source-tracker instructions, measured performance, and production trade-offs are documented in [docs/external-layers.md](docs/external-layers.md).
> Legend architecture, upstream contracts, troubleshooting, and regression QA are documented in [docs/legends.md](docs/legends.md).

## Overview

Static site, no backend. The app embeds MapX in an iframe via the SDK's postMessage bridge and wraps it in a sidebar UI styled with Mangrove (v2.0.0-rc.2). See [docs/product-spec.md](docs/product-spec.md) for what we're building; this doc covers how.

## Structure

```
undrr-risk-resilience-maps/
├── index.html                  # Main entry point
├── data/
│   └── inventory.csv           # Master metadata, delivery status, and permanent MapX IDs
├── scripts/
│   └── import-inventory.mjs    # CSV → JS config import tool (dry-run + --apply)
├── src/
│   ├── main.js                 # Standalone entry: validates config, creates the sidebar on document.body, inits SDK
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
│   │   ├── registry.js         # createLayerRegistry(): byKey / byViewId / urlKeyOrder
│   │   └── validate.js         # Startup config validation (throws on errors)
│   ├── sdk/                    # MapX SDK wrapper modules
│   │   ├── client.js           # mxsdk.Manager lifecycle + SDK readiness flag
│   │   ├── views.js            # view add/remove, cached legend images
│   │   ├── legend-model.js     # Shared structured legend model + safety limits
│   │   ├── legends.js          # MapX catalogue + vector legend adapter/dispatcher
│   │   ├── raster-legends.js   # Approved GeoServer raster legend adapter
│   │   ├── filters.js          # layer transparency, filters
│   │   └── inspect.js          # click_attributes batch collector, generation guard
│   ├── external/               # Runtime external-provider boundary
│   │   ├── index.js            # Generic provider contract + temporary-view registry (adapters lazy-loaded)
│   │   ├── edra-agriculture-controls.js # EDRA crop/scenario options (loaded eagerly)
│   │   └── edra-agriculture.js # EDRA fetch, cache, reprojection, join, and MapX adapter
│   ├── services/
│   │   ├── layer-controller.js # createLayerController(): reconciles layer intent to MapX, latest intent wins
│   │   └── router.js           # createRouter(): active tab, URL state through the adapter, one history entry per action
│   ├── state/
│   │   ├── store.js            # openViews Set (derived from the layers store)
│   │   ├── layers-store.js     # createLayersStore(): per-layer intent + applied records, subscribers
│   │   ├── hash-adapter.js     # createHashAdapter(): read/write/subscribe/destroy over hash.js
│   │   └── hash.js             # URL hash encoding/decoding + layer index lookup
│   ├── ui/
│   │   ├── sidebar.js          # createSidebar(root, options): composes store, controller, router, nav and panels; one instance
│   │   ├── map-warming.js      # createMapWarming(): the map's warm / hidden states behind an info page, the gating, and the observer that holds it out of reach
│   │   ├── nav.js              # createNav(): generates data tab links from TABS, wires nav clicks and active state within a root
│   │   ├── layer-panel.js      # Data tab panels (intro, groups, empty state, Show disabled) and cross-tab sections, both stacks in an mg-accordion
│   │   ├── layer-row.js        # createLayerRow(): one row component, full (home tab) or compact (cross-tab)
│   │   ├── announcer.js        # createLayerAnnouncer(): the instance's one polite live region for layer events
│   │   ├── layer-controls.js   # Per-layer opacity slider and legend renderer
│   │   ├── external-controls.js # Provider-neutral external-layer controls
│   │   ├── mangrove-tabs.js    # Loads Mangrove's js/tabs.js from the CDN and applies it to a scope (with mgTabsDestroy on abort)
│   │   ├── mangrove-copy-button.js # Loads Mangrove's js/copy-button.js from the CDN and applies it to a scope
│   │   ├── home.js             # Home page cards from each tab's `card` field (navigate through an onNavigate callback)
│   │   ├── info-panels.js      # Sources and About full-page views
│   │   ├── infobox.js          # Feature click popup (legacy; superseded by site-inspector)
│   │   ├── site-inspector.js   # Inspect mode: click → Site Details panel (coordinates copied by Mangrove's CopyButton)
│   │   └── widgets/            # Source-switching widgets (registry pattern)
│   │       ├── index.js        # Widget registry + isCompound helper
│   │       ├── source-selection.js # Shared selection state; shows the source the layer ends up on
│   │       ├── sub-tabs.js     # Button bar for metric switching
│   │       └── stepped-slider.js # Range slider for return periods
│   └── styles/
│       ├── shared.css          # CSS entry point (@imports)
│       ├── tokens.css          # Design tokens (custom properties)
│       └── components/         # Per-component CSS files
│           ├── layout.css      # App shell, nav, info-page containers
│           ├── layer-panel.css # Floating sidebar panel
│           ├── layer-accordion.css # Layer items + R2R group headings
│           ├── opacity-slider.css
│           ├── legend.css
│           ├── home-panel.css  # Info page hero, sections, cards, Sources table
│           ├── panels.css      # Drag + resize for layer panel and Site Details
│           ├── site-inspector.css
│           ├── widgets.css     # Sub-tabs and stepped-slider
│           └── infobox.css
├── tests/
│   └── e2e/                    # Playwright smoke suite (unit tests live beside their modules)
│       ├── fixtures/
│       │   ├── app.js          # The shared test fixture: MapX stub routing, preview-gate unlock, selectors
│       │   └── mapx-stub.js    # Served as mxsdk.umd.js; the only fake MapX in the suite
│       ├── dev-server.js       # Port, reuse policy and identity path, shared with both configs
│       ├── global-setup.js     # Refuses the run if the port serves another checkout
│       └── *.spec.js
├── .github/workflows/deploy.yml # GitHub Pages CI
├── playwright.config.js        # E2E suite: chromium, its own Vite server on port 3040
├── vite.config.js
├── server.js                   # Static production server (for previewing dist/)
└── package.json
```

## Architectural decisions

### Startup sequence

The app initialises in three phases to keep the UI responsive even if the MapX SDK is slow to load:

1. **Immediate** — `validateLayers()` runs first and throws on config errors. `createSidebar(document.body, { onViewsChanged })` follows: nav links are generated and wired, info pages are built, and layer accordions are rendered. The user can read the home, Sources, and About pages without waiting for the map.
2. **SDK availability** — `src/sdk/availability.js` loads the remote SDK with a 15-second limit. After the manager starts, MapX gets 30 seconds of _loading time_ to fire its `ready` event. A failed request, invalid SDK response, manager-construction error, or stalled MapX iframe reveals an in-page service notice with manual retry and MapX availability links; the non-map pages remain usable. A visible 60-second countdown then reloads the current URL automatically, preserving its tab and layer hash while checking whether the service has recovered. Both the ready budget and the countdown run only while `isMapOnScreen()` (the map is the view the user is on); `canMapLoad()` is the wider question — can the iframe make progress at all — and is what tells the warm-up apart from a hidden map. So a healthy service is never reported as failed and nobody is reloaded out of an information page they are reading.

   **Why the ready budget is spent rather than elapsed.** MapX renders in a cross-origin iframe, and browsers throttle rendering in an iframe that is not being painted — which halts MapX's own start-up, not just its drawing. Two states do this: the Mangrove preview gate (`visibility: hidden` on the body's children until the PIN is entered) and the tab being in the background. Measured against the live service, MapX makes literally no progress in either and then reaches `ready` ~1.1s (warm) to ~3.5s (cold profile) after the iframe becomes renderable. A wall-clock timer therefore reported a false "MapX is unavailable" for anyone who sat at the PIN gate or backgrounded the tab for 30 seconds. `watchForMapReady()` ticks its budget down only while `isMapOnScreen()` holds, which keeps 30s as a ~10x margin over a real cold load instead of a limit on the user's reading speed. It is spent on being _on screen_, not merely on being able to load, because the warm-up below can load for as long as someone reads: measured at 400 kbps / 400 ms RTT, landing on `#home` and never opening a tab, a budget spent on `canMapLoad()` armed the notice at 78.2-78.3s (two runs) on a service that became ready at 174.3-174.4s, so the first data-tab click showed "The map is temporarily unavailable" and a reload countdown before the map had had a second on screen. Each tick subtracts the time that really elapsed since the last one rather than the nominal tick, because `setInterval` coalesces. The watch is also bounded in wall-clock time (15 minutes): a page nobody ever brings the map onto would otherwise hold a 2 Hz interval for the life of the page and never reach a verdict; after that it stops without accusing the service. A late `ready` still clears the notice and cancels the countdown, so even a genuine timeout recovers by itself if the service catches up.

   **Why the map warms up behind the information pages.** The app's default landing state is an information page, and it used to hide the map with `display: none` — which throttled the iframe too, so MapX did not begin loading until the first data-tab click and the user paid the whole load then. The map is now kept laid out and loading while an information page is shown: `src/ui/map-warming.js` gives `#app-map` the `is-warming` class (`MAP_WARMING_CLASS`), which pins it in the viewport with `position: fixed` and makes it `opacity: 0`, plus `aria-hidden` on the container and `inert` on the container and each of its children.

   That state has to be held, not merely set. Mangrove's preview gate calls `removeAttribute("inert")` on every direct child of `<body>` when the PIN is accepted, `#app-map` is one of them, and nothing upstream puts it back; and children arrive afterwards (`buildSiteInspectorPanel()` runs after `createSidebar()`). A `MutationObserver` on the container — `inert`, `aria-hidden`, `childList` — re-asserts both for as long as the map is warming. Without it, "Skip to map" put focus on the invisible `#app-map` (it carries `tabindex="-1"`) in the session in which the PIN was entered. The skip link is also hidden while an information page is the view, because there is no map to skip to.

   The warm-up is not universal. It is skipped where `inert` is unsupported (Safari before 15.5, Firefox before ~April 2023), because `pointer-events: none` covers the pointer only and the layer switches, the collapse button, the inspect toggle and the MapX iframe would remain tab stops inside an invisible overlay; and it is skipped where it is not worth its cost — `navigator.connection.saveData`, a `2g`/`slow-2g` `effectiveType`, a viewport narrower than 768px or a coarse pointer. In those cases the map is hidden with `display: none` exactly as it was before the warm-up existed, `canMapLoad()` correctly reports that it cannot load, and the only thing lost is the head start. Where it does apply it is scheduled behind `requestIdleCallback`, so it does not compete with the information page the user is reading.

   What it costs, measured on `#home` over 25s without ever opening a data tab (Chromium, live MapX, median of 5 runs per cell, transfer as CDP `encodedDataLength`, heap as the top frame's `JSHeapUsedSize` — the cross-origin MapX renderer's own heap is in another process and is not counted): at 1440x900, 142 requests and 8.63 MB with the warm-up against 95 requests and 4.30 MB without — +47 requests, +4.33 MB (+101%) and +14 MB of JS heap (28.9 MB against 14.9 MB), plus a live WebGL context, on every visit including a bounce. At 390x844 with a coarse pointer the gate takes that back to exactly the same 95-request, 4.30 MB, 14.9 MB-heap baseline, from the 119 requests, 6.59 MB and 28.5 MB that `main` spends there; a save-data or 2g connection lands on the same baseline at any size. At 1440x900 the gate is a no-op by design, and the branch matches `main` request for request (142/8.63 MB against 141/8.58 MB).

   What the browser will and will not keep rendering was measured rather than assumed (Chromium 151, the live MapX service, a fresh browser context per run, landing on `#home` and never clicking a data tab):

   | map's state while an information page is shown                                | `ready`                       |
   | ----------------------------------------------------------------------------- | ----------------------------- |
   | `display: none` (the old behaviour)                                           | never, 3/3 runs (watched 25s) |
   | in normal flow, below the information page and so out of the viewport         | never, 3/3 runs (watched 25s) |
   | laid out in the viewport, fully covered by the opaque information page        | 4.5–6.1s, but never in 1 of 5 |
   | laid out in the viewport, `opacity: 0`, above the information page (this app) | 5.7–6.8s, 7/7 runs            |

   So the gate is intersection with the viewport, not being scrolled past: an off-screen iframe never starts. Being covered mostly works but not reliably — Chromium's occlusion tracking stopped one run of five dead, which is exactly the failure this change must not reintroduce, and it would also have to survive a short information page, a transparent section and mobile viewport quirks. `opacity: 0` needs no stacking-order changes to the information page or the global footer and cannot show the map through either. The map is taken out of the flow but not out of the layout, so the document's scrolling, the information pages and the footer are unchanged (measured: identical `scrollHeight` and `scrollWidth` at 1440px and 390px).

   What this buys: the first data-tab click used to wait 2.5s, 2.6s and 2.9s for `ready`; now the map is already there (0.2s, which is the measurement's own overhead). Clicking a data tab immediately, before the warm-up has finished, is no slower than it was.

   Two consequences worth remembering. First, `canMapLoad()` must stay honest — if a future browser also throttles zero-opacity or occluded frames, the ready budget would count time in which MapX cannot progress and the false failure notice would come back; the check is the measurement above, repeated. Second, "can load" and "is on screen" are now different questions, which is why `isMapOnScreen()` exists: the warm-up loads on the user's reading time, and neither the ready budget nor the retry countdown may be spent on it. A missing container answers the two differently on purpose — `canMapLoad()` is true (don't stall a watch on an element that isn't there) and `isMapOnScreen()` is false (don't reload a page that has no map in it). Both find the container by its root-scoped `data-ui="app-map"` hook first, falling back to `#app-map`, so they and `ui/map-warming.js` act on one element; a page with more than one sidebar root would need per-instance availability, which this module does not do.

3. **On SDK ready** — once `mapx.on("ready")` fires, `setSDKReady(true)` unlocks layer toggles, vector highlight is enabled, and any layers in the URL hash are restored (`sidebar.restoreFromUrl()`).

Layer toggle buttons check `isSDKReady()` before calling SDK methods, so clicking a layer before the map has loaded produces a console warning rather than a silent failure.

### MapX SDK integration (iframe + postMessage)

MapX runs in an iframe. All communication goes through `mxsdk.Manager`, which uses `window.postMessage` RPC under the hood. SDK methods are wrapped in thin facade modules under `src/sdk/` so nothing else in the app touches postMessage directly.

```
Browser tab
  ├── Our app (parent window)
  │     ├── src/sdk/client.js    → mxsdk.Manager lifecycle + readiness flag
  │     ├── src/sdk/views.js     → view add/remove, cached legend images
  │     ├── src/sdk/legends.js   → catalogue + validated vector legend extraction
  │     ├── src/sdk/raster-legends.js → approved GeoServer raster legend extraction
  │     ├── src/sdk/filters.js   → layer transparency, filters
  │     └── src/external/        → external data adapters + runtime view registry
  │
  └── MapX iframe (cross-origin)
        └── communicates via postMessage ↕
```

**Primary project and cross-project views:** the SDK connects to one primary MapX project (`PRIMARY_PROJECT = ECO_DRR`). Public views from other MapX projects can currently be added by ID with `view_add`, so validation warns about these dependencies without blocking startup. This behavior is not guaranteed by the SDK contract; consolidating permanent views into the primary project remains the preferred long-term setup. Runtime external layers create temporary views within the connected project.

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

Category tabs (Risk, Resilience, Hazard, Exposure, Vulnerability, in `TABS` order) live in a Mangrove `mg-mega-topbar` navigation bar. Home, Sources, and About provide the remaining informational views. `index.html` holds only the home link, a separator and the info links; `createNav()` in `src/ui/nav.js` inserts a link per `TABS` entry before the separator, so adding a tab needs no markup change. Links already in the markup are wired, not duplicated.

A tab entry carries everything generated from it: `id`, `label`, `description`, an optional `definitionUrl` and `glossary`, its layers (or R2R `groups`), and `card: { icon, color, desc }` — the tab's home-page card, which `buildHomePanel({ tabs })` renders from. So adding a tab is one edit in `src/config/layers/index.js`: the nav link, the layer panel and the home card all follow. `card` is optional, since a tab can be deliberately left off the home grid and an embed may pass a subset of tabs; `validateLayers()` checks its shape when it is there, because a half-filled card would render a blank one.

The topbar is a plain list of links inside `<nav aria-label>`, with no ARIA menu roles: Mangrove's own MegaMenu leaves the topbar and its items with their native semantics and uses `menu`/`menuitem` only inside a submenu. `menubar` would promise arrow-key navigation and a single tab stop that this nav does not implement, and it stopped the links being announced as links. `setActive()` marks the link for the view on screen with `is-active` and `aria-current="page"` -- the hash is this app's address bar, so that link is the current page -- and `destroy()` restores both.

**Two routing modes driven by `switchTab()`:**

- **Info tabs** — hide the map (`#app-map`), show the full-page `#info-page` container, display the matching info panel.
- **Data tabs** — show the map, show the floating layer panel with the matching tab's layers.

Tabs whose layers span multiple R2R categories (Societies / Economy / Environment) are grouped by the `withR2rGroups()` helper in `src/config/layers/index.js`. Each group renders as a `<details>`/`<summary>` element in the sidebar, open by default, with a collapsible arrow. Tabs with only one category (e.g. Hazard) render flat. The `groups` field is `null` for flat tabs; the sidebar checks it and renders accordingly.

The active tab and open layers are encoded in the URL hash (format: `#tab?layers=key:sourceIdx,...`) so links are shareable and browser back/forward works. On `hashchange`, both the active tab and the open layer set are reconciled against the new URL.

The current repository owns the **map registry** only: tab structure, layer metadata, MapX view IDs, legends, and map interaction. Future resilience indicators or chart-based content are expected to live in a separate system and be cross-linked from this app when appropriate. To keep that future path open, placeholder resilience entries can exist here before their final delivery format is settled.

Layer lifecycle status and prototype availability are separate. An **In development** layer remains in that editorial state in Sources and inventory exports, but becomes available in the map explorer once every required MapX view ID exists. Layers without complete IDs stay hidden by default and can be revealed with the review toggle. Explicitly retired keys live in `data/removed-layer-keys.txt` and are excluded from both configuration and future imports.

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

| Type             | UI                                                | Use case                               |
| ---------------- | ------------------------------------------------- | -------------------------------------- |
| `sub-tabs`       | Button bar for ≤3 sources; select for larger sets | Switching between named data variants  |
| `stepped-slider` | Range input with tick labels                      | Selecting return periods or thresholds |

To add a new widget type: create a factory function in `src/ui/widgets/`, register it in the index. No changes to `sidebar.js` needed.

**Duplicate view ID constraint:** each MapX view ID must appear at most once across all layer configs. Reusing the same ID in two layers corrupts `openViews` state (the Set can't tell them apart) and breaks hash serialisation. `validateLayers()` treats duplicates as errors.

### State management

Plain ES module exports and per-instance factories, no framework.

**Terminology note:** in the MapX SDK, a dataset on the map is called a "view." In our UI and docs, we call them "layers." The code uses both: `openViews` is the SDK-facing set, but UI labels say "layer."

- `openViews` (Set) — MapX view IDs currently active on the map (derived from the layers store)

The active tab is not module state: each sidebar instance keeps its own (`sidebar.activeTab`, starting from the URL or the `initialTab` option).

**Layers store (unisdr/undrr-risk-resilience-maps#14).** `createLayersStore()` in `src/state/layers-store.js` holds one immutable record per layer key:

```js
{
  key,
  // Intent, written by the UI through the layer controller
  desired, sourceIdx, settings,
  // What MapX shows, written by the layer controller
  applied, appliedSourceIdx, appliedSettings, viewId,
  status, // "idle" | "loading" | "removing" | "switching" | "error"
  error,
}
```

`applied` means MapX confirmed the layer is on; `viewId` is the view carrying it, and is `null` while off and in the gap of a source switch. `set(key, patch)` notifies subscribers synchronously with `(key, next, prev)`; `get`, `all` and `openViewIds` read. A compound layer's selected source is `sourceIdx` (this replaced the old `activeSourceIndex` Map in `store.js`), and an external layer's selected crop or scenario is `settings`.

- `set` ignores a patch that changes nothing (including a first write equal to the defaults) and warns about and ignores unknown fields. `settings` and `appliedSettings` are stored as deep-frozen copies, and a patch with equal contents keeps the stored object. A subscriber that throws is logged with `console.error` and does not stop the other subscribers or the caller. `get(key)` for a key with no record returns one frozen "off" record per key.
- `desired`, `sourceIdx` and `settings` are intent. When a MapX call fails they are reset to what MapX shows (a failed turn-on leaves `desired: false`, a failed turn-off `true`), and `status: "error"` and `error` record the failure until a later call for that layer succeeds. See the failure table under Layer controller.
- `store.openViews` stays as a compatibility Set for `main.js` and `sdk/inspect.js`. The sidebar never mutates it: `mirrorOpenViews()` updates it incrementally from `viewId` changes, which keeps its insertion order.
- The URL hash is a store subscriber. When `applied`, `appliedSourceIdx` or `appliedSettings` change, or a layer that is on gets a view back (`viewId` from `null`), `toUrlLayers()` serialises the applied source and settings of the records that are on and carry a view, and writes through the state adapter. The hash follows the map, not intent, so a click still loading is not in a shared link. The `null` gap during a source switch writes nothing, so a switch is still one entry. If another layer writes the hash during that gap, the view-back rule lists the layer again once a view carries it (for example after a rollback to the same source). Tab switches and batch ends still write directly.
- Hash order is config order: the registry's `urlKeyOrder()` (`urlKeyOrder(tabs)` in `src/config/registry.js`) lists published, keyed layers tab by tab in `tab.layers` order, the walk the hash was always built from. It is not the sidebar's row order, because tabs with more than one R2R category show their rows grouped (Societies, Economy, Environment). `toUrlLayers(records, keyOrder)` requires the order, and leaves out (with a one-time warning) a layer whose key is missing from it.
- The hash is written synchronously inside `set`, before the layer rows (a later subscriber) update their switches, legends and details. A failed write (e.g. a `SecurityError` when a browser rate-limits `pushState`) is logged, and the panel still finishes updating.
- The sidebar renders its rows from the store: one subscriber hands each record to the layer's rows (see Layer rows below). Switches follow `desired`, and the details, source widget, opacity slider and legend follow `applied`/`viewId`.
- The store and controller belong to a sidebar instance (see Sidebar instance below): `createSidebar()` creates them, clears `store.openViews`, and exposes them as `sidebar.store` and `sidebar.controller`. `sidebar.destroy()` removes the subscriptions and the URL listener, destroys the controller and the layer rows, destroys the hash adapter if the sidebar created it, and drops the store and controller. Afterwards both properties are `null`, and switch clicks, clear-all, source and variant changes, tab switches and `restoreFromUrl()` (which warns) do nothing. MapX calls that settle after a destroy or after a new instance is created are dropped: the destroyed controller writes nothing and starts no further MapX calls. Nothing is created lazily.

### Layer controller

`createLayerController({ store, getLayer, views, external, onError })` in `src/services/layer-controller.js` is the only code that adds or removes MapX views. It never touches the DOM, the URL or the SDK directly: `views` is `{ add, remove }` (the sidebar passes `sdk/views.js`), `external` wraps the runtime registry in `src/external/index.js`, and `getLayer` looks up layer config by key (the sidebar passes the layer registry's `byKey`, limited to published layers).

```js
controller.setOn(key, on); // intent: on/off
controller.setSource(key, sourceIdx); // intent: compound layer source
controller.setSettings(key, settings); // intent: external provider settings
controller.intend(key, patch); // several intent fields at once (restore, back/forward)
controller.clearAll(); // every layer on, loading or wanted → off
controller.hasPendingIntent(key); // intent differs from what MapX shows (see URL hash history entries)
controller.destroy(); // ignore new intent; drop results still in flight
```

Each call writes intent to the record and resolves with the settled record once MapX matches the latest intent. `intend()` accepts only intent fields (`desired`, `sourceIdx`, `settings`); any other field (`applied`, `viewId`, …) is ignored with a console warning. The module also exports pure helpers: `isBusyStatus(status)`, `settingsMatch(actual, wanted)` and `clampSourceIdx(layer, idx)` (the sidebar clamps URL source indices with it).

**Intent and apply.** Every layer kind follows one policy: the latest intent wins, and no click is dropped.

- Each key has at most one reconciliation running. Intent that arrives meanwhile and changes the record marks the key dirty; intent equal to the record only joins the run, so it neither retries a failing call nor cancels its reset. When the current MapX call settles, the controller re-reads the record and plans again from what is now on the map, so a stale plan is never finished (a switch A→B that is overtaken by C adds C, never B).
- Callers that arrive during a run join its promise, so `clearAll()` inside `batchHashWrites()` waits for a layer that was still loading and the batch still writes one history entry.
- Keys are independent. There is no global queue, so restore issues the first `view_add` of each layer in hash order.
- Simple and compound layers: the target view is `layer.id` or `sources[sourceIdx].id`; the controller removes the current view, then adds the target. During a switch the record stays `applied` with `viewId: null`.
- External layers: the registry is the source of truth for the runtime view. The controller opens, closes or calls `replaceExternalLayer` (create the new view, then remove the old one) when `settings` differ from the runtime's, and copies the result into the record. Providers receive the record's frozen `settings`. `settings` is kept while the layer is off, so turning an external layer back on reopens its last variant (as a compound layer keeps its last source); the provider defaults apply only to a layer that never had settings.

**Failure semantics.** The record always describes what MapX shows. A failed call sets `status: "error"` and `error` and resets intent to the applied state, so switches and widgets do not show something the map doesn't. If newer intent arrived during the failed call, intent is left alone and that intent is tried next.

| Failure                                     | Record afterwards                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `view_add` fails turning a layer on         | off; `desired: false`                                                                     |
| `view_remove` fails (turning off or switch) | still on with the old view; `desired: true`, `sourceIdx` reset to the applied one         |
| New source fails during a switch            | previous source re-added; on with the old view, `sourceIdx` reset                         |
| New source and re-adding the old both fail  | off (`applied: false`, `viewId: null`, `desired: false`); never on without a view         |
| External open fails                         | off; `desired: false`                                                                     |
| External close fails                        | still on; `desired: true`                                                                 |
| External replacement fails                  | the registered view stays; `viewId`/`appliedSettings` from the registry, `settings` reset |

Intent for a key that `getLayer` does not know (not in the config, or unpublished) makes no MapX call: intent is reset to the applied state with `status: "error"` and an `error` naming the key, and the controller warns once per key. A row built for a layer object that is not the registry's entry for its key warns too (the sidebar's `tabs` must hold the registry's own layer objects).

An external `open` that resolves without a runtime view id, or a `replace` whose result has no `runtime` with a view id, counts as a failure (a `TypeError` in `error`). For `replace`, the registry's current runtime, not the provider's result, gives `viewId` and `appliedSettings`.

`onError(key, error, action)` reports every failure (the sidebar logs a warning). A later successful call clears `error`. A throwing `onError` is logged with `console.error` and does not interrupt the reconciliation. If a reconciliation itself throws (a bug, such as a store write that throws), the key is freed, a busy status is replaced by `status: "error"`, and every waiting caller settles with the record, so later intent still runs.

**State adapter.** `createHashAdapter({ target = window })` in `src/state/hash-adapter.js` is the only path from the UI to `location`/`history`: `read()` parses `target.location.hash`, `write(state, { replace })` pushes or replaces through `target.history`, `subscribe(fn)` watches `hashchange` on `target`, `destroy()` removes its listeners. `parseHash()` and `writeHash()` accept optional `location`/`history` for this and default to the globals. `createSidebar(root, { stateAdapter })` accepts another adapter with the same contract (see the embedding design in unisdr/undrr-risk-resilience-maps#14).

### Layer registry

`createLayerRegistry(tabs)` in `src/config/registry.js` indexes the tab config once and is pure (it reads the config it is given and touches no DOM, URL or SDK). `getLayerRegistry()` returns the registry for the app's `TABS`, built on first use and shared, since the config is immutable.

```js
registry.byKey(key); // layer config, published or not
registry.byViewId(viewId); // { tab, layer, source } for a permanent MapX view id (compound sources too)
registry.urlKeyOrder(); // published, keyed layers in config order (the hash order)
```

It replaces the separate `TABS` walks behind the sidebar's old `layerElementMap` lookup (the controller's `getLayer`), `getLayerByKey` in `hash.js`, the site inspector's view index and the sidebar's `URL_KEY_ORDER`. Keys and view ids are unique (`validateLayers()` rejects duplicates); with duplicates the first occurrence wins. Freezing is shallow: the registry, its key order and the `byViewId` entries are frozen, but the layer, source and tab objects it returns are the config's own (not frozen), so treat them as read-only. `export-layers.js`, `home.js` and the info panels still walk `TABS` directly, because they need tabs, groups and unpublished layers in page order.

### Router

`createRouter({ controller, registry, adapter, dataTabs, infoTabs, initialTab, isReady, isExternal, layerKeys })` in `src/services/router.js` is the only module that reads or writes URL state. It owns the active tab and the history rule; it touches no DOM and reaches the URL only through the injected state adapter, which it creates (a hash adapter) and destroys itself when the caller passes none. It lives in `services/` rather than `state/` because it drives the layer controller the way the controller drives the SDK, while the `state/` modules hold state and encode it and depend on nothing.

```js
const router = createRouter({ controller, registry, adapter, dataTabs, infoTabs, initialTab });
router.attachTo(store); // take the store and subscribe: where this sits is where the URL write sits
const off = router.onTabChange((tabId) => renderTab(tabId)); // the UI renders from this
router.start(); // show the first tab (URL, else initialTab) and watch for external URL changes
await router.restoreFromUrl(); // after MapX is ready: request the URL's layers, in URL order
router.setActiveTab("hazard"); // a user switched tab: show it and push one entry
router.asOneEntry(() => controller.clearAll()); // a multi-layer change as one history entry
router.activeTab; // the active tab (the last one, after destroy)
router.destroy(); // drop the store and URL subscriptions, destroy an adapter it created
```

- **Subscription order.** The router reads and writes nothing until `attachTo(store)`, which is its one store subscription, so the call site of `attachTo` _is_ the URL's place in the store's subscriber order. The sidebar calls it between its `onViewsChanged` subscriber and its row renderer; the store calls subscribers synchronously in subscription order, so the URL is written before the rows update the switches and the legend. `src/ui/sidebar.order.test.js` pins that order and fails if the two are swapped (it used to be a side effect of where `createRouter()` sat, which nothing pinned).
- **Batching, not UI verbs.** `asOneEntry(fn)` runs a multi-layer change inside the batch (the per-layer writes are skipped and one entry is pushed when it settles); the caller drives the layers, so "clear all" is `router.asOneEntry(() => controller.clearAll())` in the sidebar rather than a `clearAll()` on the router.
- **Which layers it may turn on.** `layerKeys` is the published, keyed layers of the configured tabs (`urlKeyOrder(tabs)` from the registry module), not a question put to the UI about the rows it built.
- **Writing.** A record change that alters what the URL says (`changesUrlState`) writes `{ tab, layers }` through the adapter, with `toUrlLayers(records, registry.urlKeyOrder())` so shared links stay in config order. A failed write (a browser rate-limiting history calls) is logged and the URL falls behind; the map and the panel stay correct.
- **History rule.** Unchanged from before the split, and described under URL hash and shareability below: the first URL change of an action pushes, later writes of the same action replace while the layer still has pending intent (`actionEntryKeys`), and multi-layer changes run in one batch (pushed for clear-all, replacing for restore and back/forward).
- **Reading.** `hashChangeAction()` (pure, exported from the same module) classifies an external change into ignore / keep-layers / reconcile; `restoreFromUrl()` and `reconcileLayersFromUrl()` clamp source indices, pass external settings through and skip keys the app has no row for (`layerKeys`).
- **Destroy.** `destroy()` runs its disposers, clears the tab listeners and the open action entries, and destroys the adapter if it created it. Afterwards every method is inert, nothing is re-created, and a MapX call that settles later writes no URL. `restoreFromUrl()` warns.

### Sidebar instance

`createSidebar(root, options)` in `src/ui/sidebar.js` is the UI's instance boundary (step toward `createRiskMap()` in the embedding design, unisdr/undrr-risk-resilience-maps#14). It composes the layers store, the layer controller, the router, the nav, the info pages and the layer panel. It never reads or writes URL state itself: it asks the router for a tab and renders the tab the router reports, so a nav click, a home card, `showTab()` and a back/forward navigation all render the same way.

```js
const sidebar = createSidebar(root, {
  stateAdapter, // optional read/write/subscribe/destroy adapter; default: a hash adapter the router owns
  registry, // optional; default getLayerRegistry()
  tabs, // optional data tabs; default TABS (must be the registry's layer objects)
  onViewsChanged, // optional (count) => void: number of layers on the map, when it changes
  initialTab, // optional tab shown when the URL names none; default "home"
});
await sidebar.restoreFromUrl(); // after MapX is ready: request the URL's layers in URL order
sidebar.showTab("hazard"); // open a tab as a home card does; the seam for tests and future embeds (createRiskMap)
sidebar.store; // createLayersStore() instance, null after destroy
sidebar.controller; // createLayerController() instance, null after destroy
sidebar.activeTab; // the shown tab id
sidebar.destroy();
```

- **Root scoping.** Elements are found by `[data-ui="..."]` under the root: `nav`, `info-page`, `app-map`, `layer-panel`, `panel-body` (required), `panel-toggle`, `clear-layers`, `show-disabled` and `global-footer`. A missing optional element skips its feature. The root is marked `data-ui-root` while the instance lives, and a part belongs to its nearest marked ancestor, so an instance skips the parts of a sidebar root nested inside it (once that nested root is marked). The ids in `index.html` stay for CSS and skip links, but the sidebar never looks elements up by id. Tab and info panels carry `data-tab-panel` and no element id, and are held in Maps.
- **Instance state.** Rows (`allRows`, `rowsByKey`), panels, "Show disabled", the warned-keys set and the instance's live region live in the closure. The active tab, the history-entry keys and the batch depth belong to the router (see above); `sidebar.activeTab` reads `router.activeTab`.
- **Still shared between instances.** Two live instances are not supported yet:
  - `store.openViews` (`src/state/store.js`) is module-level compatibility state that `main.js` and tests read. Every instance mirrors into it, and creating an instance clears it, which wipes the view ids of an instance that is still live.
  - The Sources page repeats Mangrove's section ids (`mg-tabs__section-sources-N` and `…--trigger`) per instance, because Mangrove's tab links point at them by id.
  - `isSDKReady()`, `sdk/views.js` and the external runtime registry are module singletons tied to the one MapX iframe.
- **Listeners.** Every listener the instance adds uses one `AbortController` signal: nav links (`createNav({ signal })`), the panel toggle, Clear all, Show disabled, the home cards (`buildHomePanel({ tabs, onNavigate, signal })`), the Sources page controls, and the panel drag and resize (`makeDraggable(el, handle, { signal })`, `makeResizable(el, { signal })`, which also end a drag in progress and remove the grip). The store subscriptions, the router (which holds the URL subscription and its own store subscription) and the instance's live region are disposers. Home cards call `onNavigate` instead of dispatching a `navigate-tab` event on `document`.
- **Destroy.** `destroy()` runs the disposers (controller first, then the router and its adapter), aborts the signal (which also runs Mangrove's `mgTabsDestroy` for the Sources tabs, removing its window and font listeners), destroys the rows, removes the DOM the instance built (info pages, tab panels, generated nav links, resize grip) and resets the static Clear all and Show disabled buttons. It also restores the page state it changed: the `#app-map` and `#info-page` display, the global footer, the nav links' active classes and the panel's collapsed state. A new instance on the same page creates no duplicate ids or handlers. The lifecycle rules under State management apply.
- **`main.js`** is the standalone entry and the only module that reaches for page globals: it passes `document.body` as the root, looks up `#mapx` and `#inspect-toggle`, and wires the inspect toggle through `onViewsChanged`. `initMapServiceRetry(document, reload)` and `startMapServiceRetryCountdown({ reload })` take a `reload` callback (default `location.reload()`).

### Layer rows

`createLayerRow(layer, options)` in `src/ui/layer-row.js` draws one layer. The home tab uses `variant: "full"`: an accordion with description, source and citation links, source widget or external controls, opacity slider and legend. Other tabs' cross-tab sections use `variant: "compact"`: label, type tag and switch, plus description, opacity slider and legend while the layer is on. Source and variant switching stay in the home tab. Before this, the two placements had separate builders kept in sync by hand, which caused #10 and #12.

```js
const row = createLayerRow(layer, {
  variant: "full", // or "compact"
  store, // createLayersStore(): read for the current intent on click
  controller, // createLayerController(): the switch, expand control, widget and controls call it
  isReady, // () => boolean: the map accepts layer changes (isSDKReady)
  isVisible, // () => boolean: the row's tab is shown
  onNavigate, // (tabId) => void: the citation link opens Sources
  selectionPending, // () => boolean: a pick through another row's controls is settling
  announce, // optional (message, record) => void: the caller's live region; without it the row builds its own
});
row.element; // root element (.layer-item or .cross-tab-item)
row.update(record); // render the record; idempotent
row.hasPendingSelection(); // a source or variant pick made through this row is settling
row.destroy(); // remove the row's listeners (widget and controls too); later updates do nothing
```

- **Rendering from the record.** `update(record)` compares the record with the last one it rendered and with what the row shows, so calling it again with the same record changes nothing in the DOM and makes no SDK call. The row keeps only UI state of its own: whether the accordion is expanded, whether it opens when the layer comes on, what the source widget or external controls show, how many of its own picks are settling, and which view's slider and legend are in its slots.
- **Row markup and keyboard.** A full row's head holds two sibling controls: `button.layer-expand` (the accordion's control, carrying `aria-expanded`, the arrow, the label and the type tag) and the layer's switch. The switch is Mangrove's `.mg-switch`: a `label.mg-switch` wrapping `input.mg-switch__input.layer-eye[type=checkbox][role=switch]` and its `aria-hidden` track and thumb. Both are real controls, so Enter and Space act on whichever is focused (a checkbox ignores Enter, so the row forwards it to a click) and nothing has to guess which control a key press was for. Until #21 the whole head was one `role="button"` with the switch nested inside it, which axe reports as `nested-interactive` and which no assistive technology can present.
- **Switch states.** `checked` follows intent; the accessible name is the layer's name, and changes only while a call is in flight (`aria-busy` plus "Loading X…" / "Turning off X…"), which Mangrove draws as a pending ring on the thumb (static under `prefers-reduced-motion`), a track overlay and a progress cursor. A call still in flight after 450 ms also says so in writing, in the wording of Mangrove's switch-pending story: an `aria-hidden` `.layer-pending.mg-form-help` line under the row's head reading "Turning on" or "Turning off" (see Pending text below). A failed call adds `.is-error` to the label (a red track outline) and fills the row's `.layer-error` line, and `aria-disabled` marks a switch the map cannot accept changes for yet. The switch stays focusable while disabled, and `isReady()` is re-read whenever a record changes or `onSDKReadyChange` fires. Its description (`title` on the input) only says what the row cannot do — the map is still starting up, or a compact row has no source controls — never what state the switch is in; nothing assistive technology can reach restates the on/off state. A checkbox toggles itself before any handler runs, so the row writes the record back onto it after every change: a refused or unchanged toggle cannot leave the switch showing something the map is not doing.
- **Expand rules (full rows).** A layer that comes on expands its accordion (switch, cross-tab row, restore or back/forward), unless the expand control started that activation: the expand control expands the row itself, and a slow load must not reopen it after the user collapsed it. Turning the layer off collapses the row, and the next activation expands again. Collapsing never turns a layer off. Back/forward or restore asking for a layer the expand control is already loading is not a new activation, so a row the user collapsed during that load stays collapsed.
- **Lazy controls.** The opacity slider (`get_view_layer_transparency`) and legend (`resolveMapXLegend`, `get_view_legend_image`) are built only while `isVisible()` is true, once per view that arrives on the map for the layer. A row in a hidden tab, including the home accordion of a layer turned on from a cross-tab row, builds them when its tab is shown; once built they stay while the tab is hidden. Clearing (layer off, new source) is immediate in every row. Descriptions, switch states, the source widget and external controls are cheap and render at once.
- **Announcements.** One polite live region per sidebar instance, not per row: `createLayerAnnouncer()` in `src/ui/announcer.js` builds a visually hidden `.layer-announcer.mg-u-sr-only` with no id and `role="status"`, the sidebar appends it to its root (or, for a root that is not an element, to that document's `<body>` — never to the layer panel, which sits inside the `#app-map` an information page hides) and passes `announce` to every row. It announces the start of every call ("Loading X…" / "Turning off X…") and then a failed load, turn-off, source switch or variant change, and is cleared when a call settles without failing. The busy sentence is spoken from there rather than left to the switch's name, because `aria-busy` also tells assistive technology to suspend reporting changes inside that subtree — the same reason rc.2's own `switch-pending.js` uses a `role="status"` region.

  A layer has a row in its own tab and a compact row in every other tab's cross-tab section, and all of them render the same record, so a region per row said the same thing several times. The region is shared and appended to the root instead of only letting the visible tab's row speak, because a row cannot see the two cases where that says nothing at all: while an information page is shown no row is visible, and a cross-tab row's region sits inside a collapsed `<details>`, which is not rendered and so never announced. `announce(key, message, record)` takes the record the message came from: every row of a layer is handed the same record object, so the second row's call is a duplicate and is dropped, while the same failure happening again arrives with a new record and is announced again. A record can carry more than one message (a call that settled into a failure clears the busy sentence and then says what went wrong), so each record's messages are remembered as a set, and a call that passes no record at all is always a new event rather than a repeat of the last one. A row created without an `announce` option builds a region of its own, in its own document, so `createLayerRow` stays usable standalone.

  Because the region is shared, two layers can have something to say at once (two failing together, or a shared link restoring both while MapX is down). Writing one message over the other would leave the region holding only the newest and the earlier sentence would very likely never be spoken, so the region carries **every** layer's current message, joined oldest first; a layer's sentence is dropped from the line when its call settles, and the rest are written back. So one layer settling cannot wipe another's "Loading…", whichever of the two settles first. A clear writes only when it changes the line, so dropping a message that was not in it does not make the region repeat what still is.

  The visible half stays per row: every published row shows the failure in its own `aria-hidden` `.layer-error` line, so it is seen as well as heard; an external row normally shows it on its own status line and falls back to `.layer-error` when no status line was rendered (an activation from the expand control). A failed variant change made through the home row's external controls is announced by those controls instead, so the region does not repeat it.

- **Pending text.** Mangrove's switch-pending story pairs a pending switch with visible text below the label. The row shows the same text, but only once a call has been in flight for `PENDING_TEXT_DELAY_MS` (450 ms): most MapX views are on the map in about 150 ms, and text that appears and disappears inside that window is noise, while a wait approaching a second needs explaining. The text is `aria-hidden` — the live region already says the same thing, with the layer's name, which the line leaves out because the row shows it right above. It sits on its own line under the head, aligned with the `.layer-error` line it can be followed by and with the same reserved height, so the head never moves and one message never resizes into the other. Both variants behave the same. A row that already shows a message of its own where an external layer's controls go (an EDRA row's "Loading X…", or its controls' "Updating external layer…") does not get a second one: the external status wins while it is on screen. The delay is cleared when the call settles, when the direction flips (the wording is replaced without a new wait), and by the row's AbortController, so `destroy()` leaves no timer and no text behind.
- **Wiring.** The sidebar instance builds (through `layer-panel.js`) a full row per layer in its tab and a compact row per published layer in each other tab's cross-tab section. One store subscriber fans each record out through a `Map<key, Set<row>>` (home row first) and updates Clear all. A tab switch calls `update()` on every row with its current record, which only builds the controls of rows that just became visible. `sidebar.destroy()` destroys every row.
- **Scope.** A row queries only its own elements (and `closest()` for the cross-tab section it opens), adds no ids and registers its listeners with one `AbortController`, whose signal it also passes to the source widget (`buildWidget(..., { signal })`) and external controls (`buildExternalControls(..., { signal })`), so `destroy()` removes those listeners too and drops a stepped-slider pick still waiting on its debounce. A pick already sent to the controller still settles; the row ignores it once destroyed. The opacity slider sync in `layer-controls.js` still queries the document.

### UI layer (Mangrove)

All styling builds on the [UNDRR Mangrove component library](https://assets.undrr.org/mangrove/2.0.0-rc.2/css/style.css) (v2.0.0-rc.2). Components used:

- `mg-page-header` (`--default`, `__decoration`, `__toolbar-wrapper`, `__block--logo`) — UNDRR branding bar with Sendai stripe, matching PageHeader's rendered HTML. The logo is `mg-logo mg-logo--autocrop` and is preloaded from `assets.undrr.org/logos/...` (the canonical path, with no `/static/` segment); the decoration divs are `aria-hidden`. `--autocrop` only applies below 1164px, where Mangrove crops the lockup to the emblem and wordmark
- `mg-mega-topbar` — category navigation bar (Simple Nav variant), with no ARIA menu roles
- `mg-card`, `mg-card__icon--bordered` — interactive category cards on the home page
- `mg-highlight-box` — callout boxes on info pages
- `mg-button` (`-primary`, `-secondary`, `-outline`, `--icon`, `--icon--small`) — actions, map toolbar and icon tools
- `mg-tag` (`--subtle`) — layer type and geometry badges in the layer panel
- `mg-switch` (`__input`, `__track`, `__thumb`, `__label`) — every on/off control: layer activations in home and cross-tab rows, "Show disabled", and the Sources MapX-ID switch. rc.2's pending (`aria-busy`), `aria-disabled` and forced-colours states and its `--mg-switch-*` custom properties are used instead of local rules
- `mg-empty-state` (`--compact`, `--panel`) — the "nothing published in this category" message in a layer tab
- `mg-form-label`, `mg-form-select`, `mg-form-error` — compound-layer source switcher and the row-level failure message
- `mg-form-help` — layer descriptions and the row-level "Turning on" / "Turning off" pending text
- `mg-range`, `mg-range__ticks` — slider track and stepped ticks for opacity and source selection
- `mg-icon` (`-close`, `-exclamation-triangle`, `-refresh`, `-external-link`, `-copy`) — the close buttons on the infobox and site inspector; the map-service notice's warning symbol, its "Try again" arrow and the new-tab mark on its status link; and the site inspector's copy control. The inspect tool's crosshair and the panel's collapse chevron stay inline SVG: neither has an equivalent in the icon set, and the collapsed state rotates the chevron 180 degrees
- `mg-status-label` — publication status for planned datasets on the Sources page, and the "Offline" badge in the map-service notice
- `mg-notice` (`--warning`, `--overlay`, `__header`, `__icon`, `__title`, `__description`, `__meta`, `__actions`) — the map-service notice, as ServiceNotice's CSS-only markup. `--overlay` gives the absolute inset, the centring, the 94% neutral-0 wash and its `backdrop-filter`; `map-service-notice.css` adds only the stacking order, the 22rem inline-start inset that clears the layer panel, the `[hidden]` rule and `border: 0` (the component's 1px severity border traces the overlay, and this overlay is the whole map embed, so it drew a gold hairline around the map rather than around a notice). The React hydration path (`data-mg-service-notice`) is deliberately not used: the retry, the countdown and the capped retries are `src/sdk/availability.js`
- `mg-buttons` — the action row inside the notice
- `mg-copy-button` (`__feedback`) — the "copy coordinates" control in the site inspector, initialised by `mgCopyButton()` (see Mangrove JavaScript)
- `mg-details` — expandable planning sections on the Sources page
- `mg-accordion` (`--flush`) — the layer panel's two disclosure stacks: the R2R group subheadings and the collapsed cross-tab sections. It supplies the summary's flex row, the rotating chevron with reduced-motion handling, the 2.75rem minimum hit target, the inset focus ring and the open/closed divider. `layer-accordion.css` scales the summary _type_ back to panel size but leaves the height alone, so both summaries measure 44px where the group headings were 36.2px and the cross-tab summaries 41.6px before. It also restates the leading padding at 1.25rem: Mangrove's chevron is a trailing `::after` where the old glyph was a leading `::before`, so without it the heading text starts left of the rows it labels rather than between a row's expand arrow and its label. The stack's container rules are written as `.mg-accordion.layer-groups` / `.mg-accordion.cross-tab-sections`, because `.mg-accordion`'s own declarations are (0,1,0) and a single class would win only on emission order; the last cross-tab section restates the bottom border that `details:not(:last-child)` leaves off. `mg-details` is deliberately not combined with the accordion here, because `details.mg-details p` would restyle the layer descriptions and cross-tab group labels inside the stack
- `mg-container` — centred layout
- `mg-skip-link` — accessible skip navigation link revealing on keyboard focus
- `mg-table`, `mg-table-scroll-region` — feature attribute table in the infobox and accessible scroll region for wide data tables
- `mg-table--data`, `mg-table__th--sticky`, `mg-table__td--code` — the Sources tables: compact padding, subtle dividers and an uppercase header band, headers pinned while the region scrolls (which is why `.data-table-wrap` caps at 70vh — released again in `@media print`, where there is no scroll container and the cap would truncate the citations), and the MapX-ID cells in the code face. `mg-table__th--sortable` is not used: it styles a header containing a sorting button and reflects `aria-sort`, but nothing sorts the rows and the script to do so is out of scope. rc.2 has a specificity bug here: `.mg-table td, .mg-table th` is (0,1,1) and defeats both `.mg-table--data` and `.mg-table__td--code` at (0,1,0), so the compact body size never lands without a local restatement (`.data-table td.mg-table__td--code`). `--small` and the `--data` header band are written as (0,2,1) and do work
- `mg-tabs` — category tabs on the Sources page, stacking below 480px
- `mg-footer` — UNDRR global footer, syndicated from PreventionWeb
- `mg-preview-access` — preview PIN gate, configured from `data-mg-preview-*` attributes

### Mangrove JavaScript

Mangrove ships vanilla behaviour scripts alongside the CSS. Two are loaded, both
pinned to the same release as the stylesheet, both fetched from the CDN rather
than bundled so they stay in step with it, and both optional — a load failure
leaves the authored markup working, not broken.

- `js/tabs.js` for the Sources page tabs. It auto-initialises `[data-mg-js-tabs]`
  containers on `DOMContentLoaded`, but our info panels are built from JavaScript
  after that event, so `src/ui/mangrove-tabs.js` imports the module and calls
  `mgTabs()` once the markup is in the document. Without it the panels render in
  sequence. The sidebar's `destroy()` aborts the signal that runs `mgTabsDestroy`,
  which is what removes the module's window and font listeners.
- `js/copy-button.js` for the site inspector's copy control, through
  `src/ui/mangrove-copy-button.js`, which mirrors the tabs loader. Importing the
  module initialises the document once, but the inspector builds its button
  later, so the wrapper calls `mgCopyButton(scope)` over the coordinates row it
  has just written. rc.2 exports only `mgCopyButton`: there is no destroy, and
  nothing global to undo, because its one listener is a `click` on the button
  element and goes with the markup. The `signal` therefore guards the part that
  can outlive its markup — the inspector aborts the previous render's controller
  before each rebuild and on close, so a slow module load never wires a row that
  is already gone. A destroy export is still called if a later release adds one.

  Unlike the tabs loader, this one is **not** optional in the "never applied,
  never broken" sense. Without the tabs module every panel still renders, so the
  content stays reachable; without the copy module the button is present,
  focusable, not disabled and labelled — and inert. So the inspector attaches a
  local click handler (`attachCopyButtonFallback`) at render time, reading the
  same `data-*` attributes and raising the same copied state, tooltip and
  `aria-live` text, and drops it only once `initMangroveCopyButtons` reports the
  module applied. The two are never both listening, so a click is never copied
  or announced twice.

### Preview access gate

The prototype sits behind Mangrove's `preview-access` component: a
`<div data-mg-preview-access>` in `index.html` plus `js/preview-access.js` from
the CDN, which builds the overlay and persists the unlock in `sessionStorage`.
It replaced a hand-rolled gate. This is a soft barrier, not access control —
the PIN is public in the markup by design.

### UNDRR global footer

Content pages (Home, Sources, About) carry the UNDRR global footer; the map view
is full-bleed and omits it. The footer is Mangrove's documented Footer embed —
`<footer class="mg-footer">` wrapping a `pw-widget-footer` container, plus the
PreventionWeb syndication widget, all in `index.html`. The widget fetches and
injects the global footer content itself; `src/ui/global-footer.js` only toggles
visibility per view. The footer structure is a UNDRR branding requirement and
must not be reshaped locally.

Syndication cannot be verified from automated tooling: the widget's
`widget-body.php` request sits behind a Cloudflare bot challenge that returns
403 to curl and headless browsers, and the widget only retrieves the footer
content inside that response's callback. An empty footer in a headless check is
expected — verify in an ordinary browser.

Mangrove 2.0 notes that affect this app: colour tokens are sRGB channel triples
and must be wrapped — `rgb(var(--mg-color-focus-ring))`, or
`rgb(var(--mg-color-neutral-900) / 0.1)` for a translucent one — except the ~24
complete-expression tokens on `tokens.json`'s exception list, such as
`--mg-form-input-border-color`, which are used bare. Only tokens that name the
state being styled are used: an `--mg-…--focus` token is not borrowed for a
resting background even where the two resolve alike today. No component
stylesheet declares a raw hex or `rgba()` colour. Where no token
matches a value, the nearest token is used translucently rather than a hex kept
(`--color-primary-light` is `rgb(var(--mg-color-blue-900) / 0.06)`), and drop
shadows keep their geometry with a tokenised colour, since Mangrove's
`--mg-card-shadow` / `--mg-shadow-raised` are inset hairline rings rather than
drop shadows and are not substitutes. Z-index 10-22 is frozen for Mangrove's
navigation zone, so app chrome uses 30+ (see `tokens.css`); and fonts come from
role tokens (`--mg-font-family-code` and friends) rather than per-component
typeface declarations.

Two places overrule a Mangrove default, and both say why in the stylesheet. The
Sources hero's switch has no inverse variant upstream, so `.sources-mapx-toggle`
darkens the off track and adds a white inset ring: over the mid-blue hero the
default (and an earlier translucent-white track) left both the thumb and the
track boundary under the 3:1 a UI component needs. The darkened fill itself
composites to `rgb(17,63,101)` against the hero — 1.7:1, nowhere near 3:1 — so
it is the ring, not the fill, that carries the track's outer boundary (6.49:1),
and the ring is therefore two device-independent pixels rather than one, so it
cannot land sub-pixel at a fractional zoom or DPR. The layer panel's
`.layer-review-switch` re-declares the switch geometry one size down because
Mangrove has no size hook yet (unisdr/undrr-mangrove#1199); the thumb's travel is
derived with `calc()` from the track width, padding, border and thumb size, and a
`[dir=rtl]` rule mirrors it, because the override would otherwise beat Mangrove's
own RTL rule. The border term exists for `forced-colors: active`, where Mangrove
adds a 1px track border but its padding reset loses to this override, so the
travel has to shrink by 2px or the thumb sits flush with the track's edge.

**Labelling controls.** Several panel controls show a word beside themselves
rather than above an associated `<label>`: the opacity slider, the stepped
slider's "Return period", the sub-tabs' metric name. Mangrove's `mg-form-label`
carries `for`, which needs an id, and the same layer can render the same control
twice at once (its home tab and another tab's cross-tab section), so a fixed id
would be duplicated. The convention across all of them is therefore one shape:
the visible text is a decorative `<span class="… mg-form-label" aria-hidden>`,
and the control alongside it is named by an `aria-label` carrying the same words,
which satisfies WCAG 2.5.3. No bare `<label>` without a `for` is left anywhere —
it names nothing and only reads as an orphan to assistive technology.

### Layer panel controls

The floating layer panel includes:

- **Per-layer accordions** — expand to reveal opacity slider, legend, and source-switching widget. Built by `createLayerRow()` (full variant, see Layer rows) and placed by `buildTabPanel()` in `layer-panel.js`.
- **Eye toggle** — asks the layer controller to turn a layer on/off; `aria-checked` shows the latest intent, so a second click while loading cancels the first. While a MapX call is in flight the switch is `aria-busy="true"` and labelled "Loading X…" (or "Turning off X…"), and a call still in flight after 450 ms adds a visible "Turning on" / "Turning off" line under the row's head. Enter/Space on the switch toggle the layer; on the row header they expand or collapse the accordion
- **Failure announcements** — one visually hidden `role="status"` `aria-live="polite"` region per sidebar instance (`.layer-announcer.mg-u-sr-only`, no id, appended to the instance root) announces a failed load, turn-off, source switch or variant change for every kind of layer, e.g. "Could not load X. It is off." A layer with rows in several tabs is announced once, not once per row, and two layers speaking at once are both carried; each row still shows the message in its own `aria-hidden` `.layer-error` line. A new call for the layer clears it. Variant changes made through the external controls are announced by the controls' own status instead, and the external loading/error text in the row is visual only
- **Show disabled toggle** — reveals unpublished review-only layer entries in the current category without making them toggleable on the map
- **Clear all button** — shown while any record is `desired` or `applied`, so it appears as soon as a layer starts loading and stays while a failed turn-off leaves a layer on; `controller.clearAll()` turns them all off, including layers still loading
- **`onViewsChanged` option** — `main.js` passes it to `createSidebar()` and enables the inspect tool from it. It is called with the number of layers on the map (`applied` records) only when that number changes, from its own store subscriber. Intent never fires it, and a source switch does not either: the switching layer stays `applied` through the gap between its views (when `openViews` briefly lacks it), so inspect is not disabled mid-switch
- **Opacity slider / legend** — rendered by `src/ui/layer-controls.js` after a layer is turned on. The SDK uses "transparency" (0 = opaque, 100 = invisible); the UI presents "opacity" (inverse), rounded to the slider's step so the thumb, the percentage beside it and `aria-valuetext` cannot disagree. Mangrove's Range pairs `mg-range` with an `mg-form-label` carrying `for`, which needs an id, and the same layer can show a slider in its home tab and in a cross-tab section at once; the visible "Opacity" text is therefore `aria-hidden` and the name comes from `aria-label` with the same word, with `aria-valuetext` spelling out the percentage the native value would read as a bare number. Legend priority is: a provider-owned structured legend; validated MapX vector rules from `get_views`; discrete GeoServer raster `intervals`/`values` from an approved provider; then the MapX image fallback. Raster requests first contact the exact approved provider endpoint and retry its explicit HTTP 403 origin denial through the allowlisted MapX mirror within one bounded request budget. Network failures and redirects go directly to the image fallback. Continuous ramps, unapproved providers, sprites, custom code, malformed responses, and excessive rule sets deliberately retain a labelled image rather than risk a misleading approximation. The full security boundary, fallback reasons, operations, and regression procedure are in `docs/legends.md`. While the structured renderer is being validated, its MapX image is also available in a collapsed comparison disclosure, lazy-loaded on first expansion. The catalogue cache is scoped to the active SDK manager and refreshes once on a missing view because `view_add` can introduce public cross-project views after initialisation. Async renders use a DOM ownership marker so a closed layer or superseded compound source cannot append stale legend content.

### Feature popups and click handling

MapX fires `click_attributes` events on vector feature clicks. The SDK emits varying arg shapes depending on view type; `main.js` normalises all payloads to `{ attributes: ... }` before passing them to `showInfobox()`. The infobox uses a single managed `keydown` handler that is removed on every close path (Escape key or close button).

### URL hash and shareability

Format: `#tab?layers=key:sourceIdx,key:sourceIdx,...`

- Simple layers: just the key (e.g. `population`)
- Compound layers: key + source index (e.g. `earthquake-pga:2`); index 0 is omitted for brevity
- On initial load, `sidebar.restoreFromUrl()` (the router's) clamps source indices and asks the controller for each layer in hash order (`controller.intend(key, { desired: true, sourceIdx, settings })`). Source index is always set (including 0) to ensure any prior state is cleared.
- Not every `hashchange` is app state. `hashChangeAction()` in `src/services/router.js` (pure, so a future non-URL state adapter can reuse it) classifies the parsed state:
  - **ignore**: empty hash, unknown id or in-page anchor (e.g. a Mangrove tab section `#mg-tabs__section-...`). Tab and layers are left alone.
  - **keep-layers**: an info tab (`home`, `sources`, `about`) with no `layers`, such as a plain `href="#sources"` link. Info tabs don't show the map, so the view switches, the open layers stay on, and the hash is rewritten in place (`replaceState`) to the canonical `#sources?layers=...`. The same applies on Back to a bare info-tab entry.
  - **reconcile**: a data tab (with or without `layers`), or an info tab carrying `layers`. Tab and layers are applied exactly as below.
- In-app links to info pages (nav links, a layer's "Citation and methodology details") ask the router for the tab directly rather than relying on the hash.
- On a reconciling `hashchange`, the router's `reconcileLayersFromUrl()` sets intent from the new URL: layers absent from it are turned off, and those in it are asked for with their source and settings. The controller works out what has to change (turn on, turn off, switch source, replace an external variant), and the source widget or external controls are rebuilt if they show something else.
- History entries: a single user action (toggle, source switch, tab switch) pushes one entry. A layer's hash write pushes unless it continues an action on that layer: when a write finds the layer still has pending intent (`controller.hasPendingIntent(key)`: `desired`, a compound layer's `sourceIdx` or an external layer's `settings` differ from what MapX shows), the key is remembered, and its next writes replace that entry until one finds the intent applied (a record change that settles the intent without a URL change also closes it). So a double-click on a switch (on, then off while the add was in flight) makes one entry that already holds the pre-click state, and Back does not turn the layer on; quick A→B→C source picks make one entry ending on C even if B reached the map first. Any other push (another layer, a tab switch, clear-all), the end of a batch and a back/forward navigation close the open actions, so a later action never replaces an earlier one's entry. Multi-layer changes run inside the router's `batch()`, which skips the per-layer writes and writes once when the batch settles: clear-all pushes one entry, while restore and back/forward replace the current entry because the URL already holds the target state. The `hashchange` handler switches tabs without writing, so the previous layers are never written under the new tab.

## Build pipeline

- Vite dev server with hot reload
- Vite/Rollup produces static assets to `dist/`
- Serve with the Node.js static server (`server.js`) or any static host
- No application backend is needed. Runtime data can come from MapX and explicitly approved external providers; some legend requests may use the MapX mirror.

## Testing

Two suites, with a deliberate split of labour:

| Suite                 | Command         | Runs in                   | What it is for                                                                                                         |
| --------------------- | --------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Unit (vitest + jsdom) | `yarn test`     | jsdom, SDK modules mocked | Every module's own rules, in detail: parsing, reconciliation policy, row rendering, failure paths, lifecycle           |
| E2E (Playwright)      | `yarn test:e2e` | Chromium, MapX stubbed    | The few guarantees that only hold in a real browser: the URL, the history stack, focus and keys, the rendered controls |

`yarn test:all` runs both.

### Unit tests (vitest + jsdom)

Configured in `vite.config.js`, whose `include` is anchored at
`{src,scripts}/**` and whose `exclude` covers `tests/e2e/` (those specs match
vitest's `*.spec.js` pattern but are the browser suite) and `.claude/**`. Both
halves exist because this repo is worked on through git worktrees created
_inside_ the checkout, each with its own full `src/`: with vitest's default
`include` a run collected every worktree's tests and failed on another branch's
in-progress code. A new top-level directory holding unit tests must be added to
`include`. Test files cover pure and near-pure modules:

| File                                      | What it tests                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/state/hash.test.js`                  | `parseHash`/`writeHash` round-trips, push vs replace, `getLayerByKey`                                                                                                                                                                                                                            |
| `src/config/registry.test.js`             | `byKey`/`byViewId`/`urlKeyOrder`, grouped tabs, duplicates, shallow-frozen indexes, the shared app registry                                                                                                                                                                                      |
| `src/ui/sidebar.instance.test.js`         | `createSidebar()` lifecycle: destroy then create leaves no duplicate ids or double handlers, old nav/panel/Clear all/home card clicks do nothing after destroy, every window/document and on-page listener aborted, home card navigation via callback, drag/resize removed, root-scoped lookups  |
| `src/ui/nav.test.js`                      | Tab links generated from config before the separator, existing markup not duplicated, click sources, active state, destroy and signal abort, root scoping                                                                                                                                        |
| `src/ui/layer-panel.test.js`              | Tab panel intro/empty state/groups, unpublished rows and Show disabled visibility, cross-tab sections (skipped tabs, groups, compact rows)                                                                                                                                                       |
| `src/utils/panels.test.js`                | Collapse/expand sizes, drag and resize idempotence, abortable drag and resize (including a drag in progress)                                                                                                                                                                                     |
| `src/ui/layer-row.test.js`                | Both variants with a real store and fake controller: idempotent `update()` (no DOM mutations, no extra SDK calls), busy/label/announcer rendering, expand rules, lazy slider/legend, compact details only while on, `destroy()`                                                                  |
| `src/state/layers-store.test.js`          | Store set/get/all, patch rules, subscribers and their errors, openViews mirror, serialisation from applied fields                                                                                                                                                                                |
| `src/services/router.test.js`             | Pure (no DOM, no `location`): the first tab from URL state or `initialTab`, push vs replace per action, clear-all as one entry, config key order, restore order and clamping, hash-change actions, and destroy dropping late results                                                             |
| `src/services/layer-controller.test.js`   | Latest intent wins (rapid toggles, A→B→C switches), clear-all during load, add/remove/double failures, external settings during load, `view_add` order across keys, destroy                                                                                                                      |
| `src/state/hash-adapter.test.js`          | Adapter read/write/subscribe/destroy on a target; shared links (grouped tabs too) round-trip byte for byte via the store                                                                                                                                                                         |
| `src/ui/announcer.test.js`                | The live region and its rule: a duplicate for the same record dropped, the same message from a new record (or no record) announced again, one record carrying a clear and a failure, two layers speaking at once both carried, and a standing message written back whichever layer settles first |
| `src/ui/sidebar.order.test.js`            | The store's subscriber order through a real instance: `openViews` current and the rows not yet rendered at the moment the URL is written, for a layer going on and going off                                                                                                                     |
| `src/ui/sidebar.announce.test.js`         | Exactly one write to the instance's region per layer event across three placements, for the busy and failure messages; a repeated failure announced twice; two layers loading or failing together; the region's placement for a non-element root; the per-row `.layer-error` lines kept          |
| `src/ui/home.test.js`                     | Category cards built from each tab's `card` field, tabs without one skipped, navigation through the callback, signal abort                                                                                                                                                                       |
| `src/config/validate.test.js`             | All error conditions (missing IDs, duplicate views, wrong project, legend schema, tab card shape)                                                                                                                                                                                                |
| `src/ui/widgets/sub-tabs.test.js`         | DOM construction, initial state, callbacks, aria roles, revert on rejected switch                                                                                                                                                                                                                |
| `src/ui/widgets/source-selection.test.js` | Shows the reported final source; overlapping picks; rejected or failed switches                                                                                                                                                                                                                  |
| `src/ui/widgets/stepped-slider.test.js`   | DOM, initial state, debounce behaviour                                                                                                                                                                                                                                                           |
| `src/ui/infobox.test.js`                  | Hide/show, title resolution, SKIP_KEYS, Escape/close, XSS escaping, singleton handler                                                                                                                                                                                                            |
| `src/ui/site-inspector.test.js`           | Panel build, view index, batch collection, generation guard, raster fallback                                                                                                                                                                                                                     |
| `src/ui/layer-controls.test.js`           | Opacity inversion semantics, SDK error fallbacks, legend swatches, SDK image fallback/diagnostic                                                                                                                                                                                                 |
| `src/sdk/legends.test.js`                 | MapX style normalisation, localisation, safety limits, unsupported-style fallbacks, request cache                                                                                                                                                                                                |
| `src/sdk/legend-model.test.js`            | Shared color/text/value safety and localization rules                                                                                                                                                                                                                                            |
| `src/sdk/raster-legends.test.js`          | Provider policy, mirror retry, bounded streaming, GeoServer schema, diagnostics, timeout                                                                                                                                                                                                         |
| `src/sdk/inspect.test.js`                 | `click_attributes` batching, generation counter, discard of stale events, several result subscribers (order, disposer, signal)                                                                                                                                                                   |
| `src/utils/export-layers.test.js`         | BOM, CRLF, headers, compound layer expansion, project labels, disabled status, CSV quoting                                                                                                                                                                                                       |

`src/ui/sidebar.cross-tab.test.js` creates a sidebar instance with mocked SDK modules and covers cross-tab rows (including that a layer turned on from a cross-tab row renders no slider or legend into its hidden home row until that tab is shown, with exact `addLegend`/`addOpacitySlider` counts across tab switches), shared-link restore (including view-add order), clear-all (including a layer still loading), back/forward history entries, rapid double toggles, quick source picks and a failed switch (widget, hash and legend agree), turning an external layer off while it loads, `viewRemove` failures and non-app hashes, plus a `layers store` block asserting records match the switches, `openViews` and the hash after toggle, source switch, clear-all, restore and back/forward, and covering failure records, a throwing hash write, a layer whose view returns after another layer wrote the hash, a double switch failure that ends off, and destroy/rebuild. `src/ui/sidebar.grouped.test.js` checks that a grouped tab's hash keeps config order on toggle and restore. `src/ui/sidebar.test.js` covers the home-tab accordion (activation, keyboard, unknown layers) through a sidebar instance.

### E2E smoke suite (Playwright)

`playwright.config.js` runs `tests/e2e/*.spec.js` in Chromium only, against the
Vite dev server on port 3040 (started by the config's `webServer`, so there is
nothing to launch by hand). CI retries twice and records a trace on the first
retry; `test-results/` and `playwright-report/` are git-ignored and uploaded as
an artifact when the job fails.

**Reuse is verified, not assumed.** Locally `reuseExistingServer` is on, because
starting a server per run costs several seconds of every iteration — but a dev
server from another worktree answers on that port just as happily, and the suite
then reports failures about code that is not on the branch under test. So
`vite.config.js` adds a dev-only middleware at `/__dev-server-identity` that
reports the root the server is serving, and `tests/e2e/global-setup.js` (which
Playwright runs after `webServer`) refuses the whole run when that is not this
checkout, naming the other checkout, its pid and the ways out. `E2E_PORT` moves
the suite to another port and `E2E_REUSE_SERVER=0` forces a fresh server; the
shared constants live in `tests/e2e/dev-server.js`. CI (`process.env.CI`) never
reuses a server, so the check is a no-op there.

**MapX is stubbed, always.** `tests/e2e/fixtures/mapx-stub.js` is served from
the real SDK URL (`https://app.mapx.org/sdk/mxsdk.umd.js`) by Playwright
routing, so `loadMapXSdk()` gets a script that sets `window.mxsdk` exactly as
the UMD bundle does. Its `Manager` appends a placeholder element instead of a
cross-origin iframe, emits `ready` on the next tick, and answers the commands
`src/sdk/` sends: `view_add`, `view_remove`, `get_views`,
`get_view_legend_image`, `get_view_layer_transparency`,
`set_view_layer_transparency`, `set_immersive_mode`, `set_vector_highlight`,
`set_features_click_sdk_only` and the camera reads. `get_views` returns raster
views with no legend URL, which is what the approved-provider policy in
`raster-legends.js` rejects without any request, so legends resolve to the image
fallback and the stub's per-view legend image carries its own view id — that is
how a spec checks the legend on screen belongs to the view the URL names. The
fixture also blocks `app.mapx.org`, `api.mapx.org` (the MapX mirror),
`*.unepgrid.ch` (GeoServer) and `*.copernicus.eu` (EDRA) outright, and stubs the
PreventionWeb footer widget. `window.__mapxStub` exposes `ready`, `openViews`,
`calls` and a `delayMs` a spec raises when it needs a later action to land while
an earlier MapX call is provably still in flight.

The Mangrove stylesheet and `preview-access.js` are still loaded from
assets.undrr.org: they are the app's own design system, and without them the
page under test is not the page. The preview PIN gate persists its unlock as
`mg-preview-access:<data-mg-preview-id>` in sessionStorage, so the fixture seeds
that key (and marks the gate unlocked directly as a fallback) rather than typing
the PIN in every test.

| Spec                    | What it proves end to end                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared-link.spec.js`   | A three-layer link restores all three switches and both widget kinds on their named sources, and the hash is byte-identical after the restore rewrites it |
| `history.spec.js`       | One user action is one real history entry; two Back steps and two Forward steps each restore their own layers and URL; navigating history adds no entries |
| `cross-tab.spec.js`     | A layer turned on from another tab's section renders no controls in its hidden home row, then exactly one slider and one legend once that tab is shown    |
| `source-switch.spec.js` | Overlapping source picks end on the last one, with the widget, the URL, the opacity slider's view id and the legend image all naming the same view        |
| `clear-all.spec.js`     | Clear all during a load leaves no switch on, no view on the map and a bare hash                                                                           |
| `keyboard.spec.js`      | Tab reaches a layer switch from the row's expand control, Space turns it on and Enter turns it off                                                        |

Deliberately **not** covered here, because a browser adds nothing or the suite
would be guessing at MapX: anything MapX itself renders (tiles, the map canvas,
its own chrome), legend colour correctness and GeoServer schema handling
(`raster-legends.test.js`), the reconciliation policy's failure paths
(`layer-controller.test.js`), external/EDRA layers, feature inspection, and
visual regression.

`yarn test:mapx-raster-contract` is a manual, network-dependent check of the configured Earthquake
PGA views, GIRI GeoServer JSON, and the MapX mirror. See `docs/legends.md` for cadence and browser
visual regression steps.

## What this is not

- Not a full geospatial analysis platform (no draw-box queries, spatial mining)
- Not a data viz tool beyond risk and resilience scope
- Not an SPA. If multiple pages are needed, use Vite MPA (one HTML entry per page).
