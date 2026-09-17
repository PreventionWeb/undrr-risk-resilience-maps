# Architecture

> See [docs/product-spec.md](docs/product-spec.md) for V1 scope. See [research/gri-ux-analysis.md](research/gri-ux-analysis.md) for the GRI interaction model that informed the prototype. See [METHODOLOGY.md](METHODOLOGY.md) for MapX API/SDK discovery approach.
> Runtime external-layer governance, source-tracker instructions, measured performance, and production trade-offs are documented in [docs/external-layers.md](docs/external-layers.md).
> Legend architecture, upstream contracts, troubleshooting, and regression QA are documented in [docs/legends.md](docs/legends.md).

## Overview

Static site, no backend. The app embeds MapX in an iframe via the SDK's postMessage bridge and wraps it in a sidebar UI styled with Mangrove (v2.0.0-rc.1). See [docs/product-spec.md](docs/product-spec.md) for what we're building; this doc covers how.

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
│   │   └── layer-controller.js # createLayerController(): reconciles layer intent to MapX, latest intent wins
│   ├── state/
│   │   ├── store.js            # openViews Set (derived), activeTab
│   │   ├── layers-store.js     # createLayersStore(): per-layer intent + applied records, subscribers
│   │   ├── hash-adapter.js     # createHashAdapter(): read/write/subscribe/destroy over hash.js
│   │   └── hash.js             # URL hash encoding/decoding + layer index lookup
│   ├── ui/
│   │   ├── sidebar.js          # createSidebar(root, options): composes store, controller, URL sync, nav and panels; one instance
│   │   ├── nav.js              # createNav(): generates data tab links from TABS, wires nav clicks and active state within a root
│   │   ├── layer-panel.js      # Data tab panels (intro, groups, empty state, Show disabled) and cross-tab sections
│   │   ├── layer-row.js        # createLayerRow(): one row component, full (home tab) or compact (cross-tab)
│   │   ├── layer-controls.js   # Per-layer opacity slider and legend renderer
│   │   ├── external-controls.js # Provider-neutral external-layer controls
│   │   ├── home.js             # Home page cards (navigate through an onNavigate callback)
│   │   ├── info-panels.js      # Sources and About full-page views
│   │   ├── infobox.js          # Feature click popup (legacy; superseded by site-inspector)
│   │   ├── site-inspector.js   # Inspect mode: click → Site Details panel
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
├── .github/workflows/deploy.yml # GitHub Pages CI
├── vite.config.js
├── server.js                   # Static production server (for previewing dist/)
└── package.json
```

## Architectural decisions

### Startup sequence

The app initialises in three phases to keep the UI responsive even if the MapX SDK is slow to load:

1. **Immediate** — `validateLayers()` runs first and throws on config errors. `createSidebar(document.body, { onViewsChanged })` follows: nav links are generated and wired, info pages are built, and layer accordions are rendered. The user can read the home, Sources, and About pages without waiting for the map.
2. **SDK availability** — `src/sdk/availability.js` loads the remote SDK with a 15-second limit. After the manager starts, a separate 30-second limit waits for its `ready` event. A failed request, invalid SDK response, manager-construction error, or stalled MapX iframe reveals an in-page service notice with manual retry and MapX availability links; the non-map pages remain usable. A visible 60-second countdown then reloads the current URL automatically, preserving its tab and layer hash while checking whether the service has recovered. The countdown pauses while the browser tab is hidden or an information page is active so it does not interrupt reading.
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

Category tabs (Risk & Resilience, Hazard, Exposure, Vulnerability) live in a Mangrove `mg-mega-topbar` navigation bar. Home, Sources, and About provide the remaining informational views. `index.html` holds only the home link, a separator and the info links; `createNav()` in `src/ui/nav.js` inserts a link per `TABS` entry before the separator, so adding a tab needs no markup change (a home card still needs a `CARD_VISUAL` entry in `home.js`). Links already in the markup are wired, not duplicated.

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

Plain ES module exports with setter functions, no framework.

**Terminology note:** in the MapX SDK, a dataset on the map is called a "view." In our UI and docs, we call them "layers." The code uses both: `openViews` is the SDK-facing set, but UI labels say "layer."

- `openViews` (Set) — MapX view IDs currently active on the map (derived from the layers store)
- `activeTab` (string) — currently selected tab ID

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

### Sidebar instance

`createSidebar(root, options)` in `src/ui/sidebar.js` is the UI's instance boundary (step toward `createRiskMap()` in the embedding design, unisdr/undrr-risk-resilience-maps#14). It composes the layers store, the layer controller, URL sync, the nav, the info pages and the layer panel.

```js
const sidebar = createSidebar(root, {
  stateAdapter, // optional read/write/subscribe/destroy adapter; default: a hash adapter the sidebar owns
  registry, // optional; default getLayerRegistry()
  tabs, // optional data tabs; default TABS (must be the registry's layer objects)
  onViewsChanged, // optional (count) => void: number of layers on the map, when it changes
});
await sidebar.restoreFromUrl(); // after MapX is ready: request the URL's layers in URL order
sidebar.showTab("hazard"); // open a tab as a home card does (switch, expand the panel)
sidebar.store; // createLayersStore() instance, null after destroy
sidebar.controller; // createLayerController() instance, null after destroy
sidebar.destroy();
```

- **Root scoping.** Elements are found with `root.querySelector('[data-ui="..."]')`: `nav`, `info-page`, `app-map`, `layer-panel`, `panel-body` (required), `panel-toggle`, `clear-layers`, `show-disabled` and `global-footer`. A missing optional element skips its feature. The ids in `index.html` stay for CSS and skip links, but the sidebar never looks elements up by id; tab and info panels are held in Maps, not found by `tab-${id}`.
- **Instance state.** Rows (`allRows`, `rowsByKey`), panels, the history-entry keys (`actionEntryKeys`), batch depth, "Show disabled", the warned-keys set and the active tab live in the closure. `store.openViews` and `store.activeTab` (`src/state/store.js`) are still written as module-level compatibility state for `main.js`, `sdk/inspect.js` and tests, so two live instances would share them.
- **Listeners.** Every listener the instance adds uses one `AbortController` signal: nav links (`createNav({ signal })`), the panel toggle, Clear all, Show disabled, the home cards (`buildHomePanel({ onNavigate, signal })`), the Sources page controls, and the panel drag and resize (`makeDraggable(el, handle, { signal })`, `makeResizable(el, { signal })`, which also end a drag in progress and remove the grip). The URL subscription and store subscriptions are disposers. Home cards call `onNavigate` instead of dispatching a `navigate-tab` event on `document`.
- **Destroy.** `destroy()` runs the disposers (controller first), aborts the signal, destroys the rows, removes the DOM the instance built (info pages, tab panels, generated nav links, resize grip) and resets the static Clear all and Show disabled buttons, so a new instance on the same page creates no duplicate ids or handlers. The lifecycle rules under State management apply.
- **`main.js`** is the standalone entry and the only module that reaches for page globals: it passes `document.body` as the root, looks up `#mapx` and `#inspect-toggle`, and wires the inspect toggle through `onViewsChanged`. `initMapServiceRetry(document, reload)` and `startMapServiceRetryCountdown({ reload })` take a `reload` callback (default `location.reload()`).

### Layer rows

`createLayerRow(layer, options)` in `src/ui/layer-row.js` draws one layer. The home tab uses `variant: "full"`: an accordion with description, source and citation links, source widget or external controls, opacity slider and legend. Other tabs' cross-tab sections use `variant: "compact"`: label, type tag and switch, plus description, opacity slider and legend while the layer is on. Source and variant switching stay in the home tab. Before this, the two placements had separate builders kept in sync by hand, which caused #10 and #12.

```js
const row = createLayerRow(layer, {
  variant: "full", // or "compact"
  store, // createLayersStore(): read for the current intent on click
  controller, // createLayerController(): the switch, header, widget and controls call it
  isReady, // () => boolean: the map accepts layer changes (isSDKReady)
  isVisible, // () => boolean: the row's tab is shown
  onNavigate, // (tabId) => void: the citation link opens Sources
  selectionPending, // () => boolean: a pick through another row's controls is settling
});
row.element; // root element (.layer-item or .cross-tab-item)
row.update(record); // render the record; idempotent
row.hasPendingSelection(); // a source or variant pick made through this row is settling
row.destroy(); // remove the row's listeners (widget and controls too); later updates do nothing
```

- **Rendering from the record.** `update(record)` compares the record with the last one it rendered and with what the row shows, so calling it again with the same record changes nothing in the DOM and makes no SDK call. The row keeps only UI state of its own: whether the accordion is expanded, whether it opens when the layer comes on, what the source widget or external controls show, how many of its own picks are settling, and which view's slider and legend are in its slots.
- **Expand rules (full rows).** A layer that comes on expands its accordion (switch, cross-tab row, restore or back/forward), unless the header started that activation: the header expands the row itself, and a slow load must not reopen it after the user collapsed it. Turning the layer off collapses the row, and the next activation expands again. Collapsing never turns a layer off. Back/forward or restore asking for a layer the header is already loading is not a new activation, so a row the user collapsed during that load stays collapsed.
- **Lazy controls.** The opacity slider (`get_view_layer_transparency`) and legend (`resolveMapXLegend`, `get_view_legend_image`) are built only while `isVisible()` is true, once per view that arrives on the map for the layer. A row in a hidden tab, including the home accordion of a layer turned on from a cross-tab row, builds them when its tab is shown; once built they stay while the tab is hidden. Clearing (layer off, new source) is immediate in every row. Descriptions, switch states, the source widget and external controls are cheap and render at once.
- **Announcements.** Each published row has its own polite live region (`.layer-announcer`) that announces a failed load, turn-off, source switch or variant change, and is cleared by the next call. A failed variant change made through the home row's external controls is announced by those controls instead, so no row repeats it.
- **Wiring.** The sidebar instance builds (through `layer-panel.js`) a full row per layer in its tab and a compact row per published layer in each other tab's cross-tab section. One store subscriber fans each record out through a `Map<key, Set<row>>` (home row first) and updates Clear all. A tab switch calls `update()` on every row with its current record, which only builds the controls of rows that just became visible. `sidebar.destroy()` destroys every row.
- **Scope.** A row queries only its own elements (and `closest()` for the cross-tab section it opens), adds no ids and registers its listeners with one `AbortController`, whose signal it also passes to the source widget (`buildWidget(..., { signal })`) and external controls (`buildExternalControls(..., { signal })`), so `destroy()` removes those listeners too and drops a stepped-slider pick still waiting on its debounce. A pick already sent to the controller still settles; the row ignores it once destroyed. The opacity slider sync in `layer-controls.js` still queries the document.

### UI layer (Mangrove)

All styling builds on the [UNDRR Mangrove component library](https://assets.undrr.org/mangrove/2.0.0-rc.1/css/style.css) (v2.0.0-rc.1). Components used:

- `mg-page-header` — UNDRR branding bar with Sendai stripe
- `mg-mega-topbar` — category navigation bar (Simple Nav variant)
- `mg-card`, `mg-card__icon--bordered` — interactive category cards on the home page
- `mg-highlight-box` — callout boxes on info pages
- `mg-button` (`-primary`, `-secondary`, `-outline`, `--icon`, `--icon--small`) / `mg-tag` — actions, map toolbar and icon tools, and layer type badges
- `mg-switch` — toggle switch controls for data options and layer activations
- `mg-range`, `mg-range__ticks` — slider track and stepped ticks for opacity and source selection
- `mg-status-label` — publication status for planned datasets on the Sources page
- `mg-details` — expandable planning sections on the Sources page
- `mg-container` — centred layout
- `mg-skip-link` — accessible skip navigation link revealing on keyboard focus
- `mg-table`, `mg-table-scroll-region` — feature attribute table in the infobox and accessible scroll region for wide data tables
- `mg-tabs` — category tabs on the Sources page, stacking below 480px
- `mg-footer` — UNDRR global footer, syndicated from PreventionWeb
- `mg-preview-access` — preview PIN gate, configured from `data-mg-preview-*` attributes

### Mangrove JavaScript

Mangrove ships vanilla behaviour scripts alongside the CSS. We load
`js/tabs.js` for the Sources page tabs. It auto-initialises `[data-mg-js-tabs]`
containers on `DOMContentLoaded`, but our info panels are built from JavaScript
after that event, so `src/ui/mangrove-tabs.js` imports the module from the CDN
and calls `mgTabs()` once the markup is in the document. Enhancement is
optional — without it the panels render in sequence.

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
and must be wrapped — `rgb(var(--mg-color-focus-ring))`; z-index 10-22 is frozen
for Mangrove's navigation zone, so app chrome uses 30+ (see `tokens.css`); and
fonts come from role tokens (`--mg-font-family-code` and friends) rather than
per-component typeface declarations.

### Layer panel controls

The floating layer panel includes:

- **Per-layer accordions** — expand to reveal opacity slider, legend, and source-switching widget. Built by `createLayerRow()` (full variant, see Layer rows) and placed by `buildTabPanel()` in `layer-panel.js`.
- **Eye toggle** — asks the layer controller to turn a layer on/off; `aria-checked` shows the latest intent, so a second click while loading cancels the first. While a MapX call is in flight the switch is `aria-busy="true"` and labelled "Loading X…" (or "Turning off X…"). Enter/Space on the switch toggle the layer; on the row header they expand or collapse the accordion
- **Failure announcements** — each layer row (home and cross-tab) has its own visually hidden `aria-live="polite"` region (`.layer-announcer.mg-u-sr-only`, no id) that announces a failed load, turn-off, source switch or variant change for every kind of layer, e.g. "Could not load X. It is off." A new call for the layer clears it. Variant changes made through the external controls are announced by the controls' own status instead, and the external loading/error text in the row is visual only
- **Show disabled toggle** — reveals unpublished review-only layer entries in the current category without making them toggleable on the map
- **Clear all button** — shown while any record is `desired` or `applied`, so it appears as soon as a layer starts loading and stays while a failed turn-off leaves a layer on; `controller.clearAll()` turns them all off, including layers still loading
- **`onViewsChanged` option** — `main.js` passes it to `createSidebar()` and enables the inspect tool from it. It is called with the number of layers on the map (`applied` records) only when that number changes, from its own store subscriber. Intent never fires it, and a source switch does not either: the switching layer stays `applied` through the gap between its views (when `openViews` briefly lacks it), so inspect is not disabled mid-switch
- **Opacity slider / legend** — rendered by `src/ui/layer-controls.js` after a layer is turned on. The SDK uses "transparency" (0 = opaque, 100 = invisible); the UI presents "opacity" (inverse). Legend priority is: a provider-owned structured legend; validated MapX vector rules from `get_views`; discrete GeoServer raster `intervals`/`values` from an approved provider; then the MapX image fallback. Raster requests first contact the exact approved provider endpoint and retry its explicit HTTP 403 origin denial through the allowlisted MapX mirror within one bounded request budget. Network failures and redirects go directly to the image fallback. Continuous ramps, unapproved providers, sprites, custom code, malformed responses, and excessive rule sets deliberately retain a labelled image rather than risk a misleading approximation. The full security boundary, fallback reasons, operations, and regression procedure are in `docs/legends.md`. While the structured renderer is being validated, its MapX image is also available in a collapsed comparison disclosure, lazy-loaded on first expansion. The catalogue cache is scoped to the active SDK manager and refreshes once on a missing view because `view_add` can introduce public cross-project views after initialisation. Async renders use a DOM ownership marker so a closed layer or superseded compound source cannot append stale legend content.

### Feature popups and click handling

MapX fires `click_attributes` events on vector feature clicks. The SDK emits varying arg shapes depending on view type; `main.js` normalises all payloads to `{ attributes: ... }` before passing them to `showInfobox()`. The infobox uses a single managed `keydown` handler that is removed on every close path (Escape key or close button).

### URL hash and shareability

Format: `#tab?layers=key:sourceIdx,key:sourceIdx,...`

- Simple layers: just the key (e.g. `population`)
- Compound layers: key + source index (e.g. `earthquake-pga:2`); index 0 is omitted for brevity
- On initial load, `sidebar.restoreFromUrl()` clamps source indices and asks the controller for each layer in hash order (`controller.intend(key, { desired: true, sourceIdx, settings })`). Source index is always set (including 0) to ensure any prior state is cleared.
- Not every `hashchange` is app state. `hashChangeAction()` in `src/state/hash.js` (pure, so a future non-URL state adapter can reuse it) classifies the parsed hash:
  - **ignore**: empty hash, unknown id or in-page anchor (e.g. a Mangrove tab section `#mg-tabs__section-...`). Tab and layers are left alone.
  - **keep-layers**: an info tab (`home`, `sources`, `about`) with no `layers`, such as a plain `href="#sources"` link. Info tabs don't show the map, so the view switches, the open layers stay on, and the hash is rewritten in place (`replaceState`) to the canonical `#sources?layers=...`. The same applies on Back to a bare info-tab entry.
  - **reconcile**: a data tab (with or without `layers`), or an info tab carrying `layers`. Tab and layers are applied exactly as below.
- In-app links to info pages (nav links, a layer's "Citation and methodology details") call `switchTab()` directly rather than relying on the hash.
- On a reconciling `hashchange`, the sidebar's `reconcileLayersFromUrl()` sets intent from the new URL: layers absent from it are turned off, and those in it are asked for with their source and settings. The controller works out what has to change (turn on, turn off, switch source, replace an external variant), and the source widget or external controls are rebuilt if they show something else.
- History entries: a single user action (toggle, source switch, tab switch) pushes one entry. A layer's hash write pushes unless it continues an action on that layer: when a write finds the layer still has pending intent (`controller.hasPendingIntent(key)`: `desired`, a compound layer's `sourceIdx` or an external layer's `settings` differ from what MapX shows), the key is remembered, and its next writes replace that entry until one finds the intent applied (a record change that settles the intent without a URL change also closes it). So a double-click on a switch (on, then off while the add was in flight) makes one entry that already holds the pre-click state, and Back does not turn the layer on; quick A→B→C source picks make one entry ending on C even if B reached the map first. Any other push (another layer, a tab switch, clear-all), the end of a batch and a back/forward navigation close the open actions, so a later action never replaces an earlier one's entry. Multi-layer changes run inside `batchHashWrites()`, which skips the per-layer writes and writes once when the batch settles: clear-all pushes one entry, while restore and back/forward replace the current entry because the URL already holds the target state. The `hashchange` handler switches tabs without writing, so the previous layers are never written under the new tab.

## Build pipeline

- Vite dev server with hot reload
- Vite/Rollup produces static assets to `dist/`
- Serve with the Node.js static server (`server.js`) or any static host
- No application backend is needed. Runtime data can come from MapX and explicitly approved external providers; some legend requests may use the MapX mirror.

## Testing

Vitest + jsdom is configured in `vite.config.js`. Run tests with `yarn test`.

Test files cover pure and near-pure modules:

| File                                      | What it tests                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/state/hash.test.js`                  | `parseHash`/`writeHash` round-trips, push vs replace, `getLayerByKey`                                                                                                                                                                                                                           |
| `src/config/registry.test.js`             | `byKey`/`byViewId`/`urlKeyOrder`, grouped tabs, duplicates, shallow-frozen indexes, the shared app registry                                                                                                                                                                                     |
| `src/ui/sidebar.instance.test.js`         | `createSidebar()` lifecycle: destroy then create leaves no duplicate ids or double handlers, old nav/panel/Clear all/home card clicks do nothing after destroy, every window/document and on-page listener aborted, home card navigation via callback, drag/resize removed, root-scoped lookups |
| `src/ui/nav.test.js`                      | Tab links generated from config before the separator, existing markup not duplicated, click sources, active state, destroy and signal abort, root scoping                                                                                                                                       |
| `src/ui/layer-panel.test.js`              | Tab panel intro/empty state/groups, unpublished rows and Show disabled visibility, cross-tab sections (skipped tabs, groups, compact rows)                                                                                                                                                      |
| `src/utils/panels.test.js`                | Collapse/expand sizes, drag and resize idempotence, abortable drag and resize (including a drag in progress)                                                                                                                                                                                    |
| `src/ui/layer-row.test.js`                | Both variants with a real store and fake controller: idempotent `update()` (no DOM mutations, no extra SDK calls), busy/label/announcer rendering, expand rules, lazy slider/legend, compact details only while on, `destroy()`                                                                 |
| `src/state/layers-store.test.js`          | Store set/get/all, patch rules, subscribers and their errors, openViews mirror, serialisation from applied fields                                                                                                                                                                               |
| `src/services/layer-controller.test.js`   | Latest intent wins (rapid toggles, A→B→C switches), clear-all during load, add/remove/double failures, external settings during load, `view_add` order across keys, destroy                                                                                                                     |
| `src/state/hash-adapter.test.js`          | Adapter read/write/subscribe/destroy on a target; shared links (grouped tabs too) round-trip byte for byte via the store                                                                                                                                                                        |
| `src/config/validate.test.js`             | All error conditions (missing IDs, duplicate views, wrong project, legend schema)                                                                                                                                                                                                               |
| `src/ui/widgets/sub-tabs.test.js`         | DOM construction, initial state, callbacks, aria roles, revert on rejected switch                                                                                                                                                                                                               |
| `src/ui/widgets/source-selection.test.js` | Shows the reported final source; overlapping picks; rejected or failed switches                                                                                                                                                                                                                 |
| `src/ui/widgets/stepped-slider.test.js`   | DOM, initial state, debounce behaviour                                                                                                                                                                                                                                                          |
| `src/ui/infobox.test.js`                  | Hide/show, title resolution, SKIP_KEYS, Escape/close, XSS escaping, singleton handler                                                                                                                                                                                                           |
| `src/ui/site-inspector.test.js`           | Panel build, view index, batch collection, generation guard, raster fallback                                                                                                                                                                                                                    |
| `src/ui/layer-controls.test.js`           | Opacity inversion semantics, SDK error fallbacks, legend swatches, SDK image fallback/diagnostic                                                                                                                                                                                                |
| `src/sdk/legends.test.js`                 | MapX style normalisation, localisation, safety limits, unsupported-style fallbacks, request cache                                                                                                                                                                                               |
| `src/sdk/legend-model.test.js`            | Shared color/text/value safety and localization rules                                                                                                                                                                                                                                           |
| `src/sdk/raster-legends.test.js`          | Provider policy, mirror retry, bounded streaming, GeoServer schema, diagnostics, timeout                                                                                                                                                                                                        |
| `src/sdk/inspect.test.js`                 | `click_attributes` batching, generation counter, discard of stale events                                                                                                                                                                                                                        |
| `src/utils/export-layers.test.js`         | BOM, CRLF, headers, compound layer expansion, project labels, disabled status, CSV quoting                                                                                                                                                                                                      |

`src/ui/sidebar.cross-tab.test.js` creates a sidebar instance with mocked SDK modules and covers cross-tab rows (including that a layer turned on from a cross-tab row renders no slider or legend into its hidden home row until that tab is shown, with exact `addLegend`/`addOpacitySlider` counts across tab switches), shared-link restore (including view-add order), clear-all (including a layer still loading), back/forward history entries, rapid double toggles, quick source picks and a failed switch (widget, hash and legend agree), turning an external layer off while it loads, `viewRemove` failures and non-app hashes, plus a `layers store` block asserting records match the switches, `openViews` and the hash after toggle, source switch, clear-all, restore and back/forward, and covering failure records, a throwing hash write, a layer whose view returns after another layer wrote the hash, a double switch failure that ends off, and destroy/rebuild. `src/ui/sidebar.grouped.test.js` checks that a grouped tab's hash keeps config order on toggle and restore. `src/ui/sidebar.test.js` covers the home-tab accordion (activation, keyboard, unknown layers) through a sidebar instance.

`yarn test:mapx-raster-contract` is a manual, network-dependent check of the configured Earthquake
PGA views, GIRI GeoServer JSON, and the MapX mirror. See `docs/legends.md` for cadence and browser
visual regression steps.

## What this is not

- Not a full geospatial analysis platform (no draw-box queries, spatial mining)
- Not a data viz tool beyond risk and resilience scope
- Not an SPA. If multiple pages are needed, use Vite MPA (one HTML entry per page).
