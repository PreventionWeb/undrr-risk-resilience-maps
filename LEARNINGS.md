# Project Learnings

Design decisions, SDK quirks, and hard-won knowledge for this codebase.

> See [TODO.md](TODO.md) for outstanding work items.

---

## MapX SDK: `click_attributes` event

**Payload shape** (confirmed from MapX source `app/src/js/map_helpers/index.js`):

```js
{
  part:       number,      // 1-indexed position of this event in the batch
  nPart:      number,      // total events expected for this click (= number of open VT views)
  idView:     string,      // MapX view ID
  attributes: [],          // feature attribute objects at click point; [] if no feature hit
  point:      { x, y },   // pixel coordinates (Mapbox GL Point)
  lngLat:     { lng, lat } // geographic coordinates (always present)
}
```

**Key behaviours:**

- One event fires **per open view that MapX treats as a vector-tile source**, not per click.
- `nPart` equals the number of such views. Many layers configured as `type: "rt"` in our app
  are stored by MapX as VT with a `GRAY_INDEX` property — they DO contribute to `nPart`.
  Only layers that MapX renders purely as image tiles (no vector source) are absent.
- `attributes` is an empty array (not absent) when the user clicks on empty map space for a VT view.
- MapX fires events in a `for...in` loop (see source), so delivery is ordered in practice, but the
  batch collector in `src/sdk/inspect.js` uses a `Map` keyed by `idView` and checks
  `map.size === nPart` rather than `part === nPart`, which handles out-of-order delivery safely.

---

## MapX SDK: `set_features_click_sdk_only`

Suppresses MapX's own feature popup so the SDK's `click_attributes` listener is the sole handler.
Useful when implementing a custom inspection panel.

```js
mapx.ask("set_features_click_sdk_only", { enable: true });
```

**Important:** Wrap in `.catch(() => {})` — do not `await` this call. The MapX SDK can sometimes
hang on certain `ask()` calls if the internal resolver throws (see limitation §9 in
`mapx-llm-skills`). This call is fire-and-forget; the UI should not depend on its response.

The app is also initialised with `closePanels: true`, which likely already suppresses the native
MapX feature panel. Calling `set_features_click_sdk_only` during inspection mode is belt-and-suspenders.

---

## MapX SDK: `click_attributes` and raster-as-VT layers

Many MapX "raster" views (Population, Tsunami, Earthquake PGA, etc.) are **not true raster tiles
internally** — they are stored as vector-tile layers with a single `GRAY_INDEX` property containing
the pixel value. These layers DO fire `click_attributes` and contribute to `nPart`, just like VT
views.

Implications:

- Our local config `type: "rt"` is a semantic classification for UI purposes (no attribute explorer,
  no numeric filter widget), NOT a reliable indicator of whether MapX will fire `click_attributes`.
- `inBatch` (the view ID appeared in a `click_attributes` event) is stronger evidence than local
  `type`. In `buildLayerRow`, check `inBatch` before `type === "rt"`.
- The float32 "no data" sentinel value is `-3.4028234663852886e38` (≈ `-FLT_MAX`). Filter it out
  and display "No data" instead of the raw number.
- `GRAY_INDEX` should be labelled "Pixel Value" for end users.

True un-queryable raster layers (those not present in any `click_attributes` batch despite being
open) still display "Raster layer — values not queryable at point." as a fallback.

**Coordinates without VT/raster-as-VT layers:** If only genuinely un-queryable RT layers are
active, no `click_attributes` events fire and `lngLat` is unavailable.

---

## MapX SDK: `download_view_source_external` requires a configured URL

Calling `mapx.ask("download_view_source_external", { idView })` opens MapX's native download
dialog, but only works if the **view publisher has configured a download URL** in the MapX view
editor. If no URL is set, MapX displays "The configured URL is not valid — please contact the
view publisher."

This SDK method is not usable as a generic download trigger for all layers. The site inspector
panel does **not** show download buttons for this reason; downloads are available through MapX's
own layer list (if configured) or via the Downloads page in the app nav.

---

## Mangrove `<details>` / `<summary>` styling

Mangrove's CSS fully manages `<summary>` element styling: padding, cursor, list-style marker
(the disclosure arrow), `-webkit-details-marker`, and user-select. Do **not** override any of
these in custom CSS — doing so conflicts with Mangrove's defaults and produces double arrows
or broken layouts.

Only add typography or colour overrides (e.g. `font-size`, `color`) to custom summary selectors.

---

## Site inspection batch collection pattern

`src/sdk/inspect.js` implements a generation-safe batch collector:

1. A `_generation` counter increments on every `enableInspection()` / `disableInspection()` call.
2. Each batch is stamped with the generation at creation time.
3. When a `click_attributes` event arrives for a different generation, it is silently discarded.
4. This prevents stale events from an earlier click (or an earlier inspection session) from
   triggering a panel update after the user has disabled inspection or clicked again rapidly.

`store.openViews` is snapshotted at `part === 1` time so the panel renders the layers that were
active at click time, not the potentially-changed live state.

---

## Layer config view-index

`src/ui/site-inspector.js` builds a `VIEW_INDEX` (`Map<idView, {tab, layer, source}>`) once at
module load time from the static `TABS` config. This index is used to look up display labels
and layer types for each `idView` in a `click_attributes` batch.

For compound layers (those with a `sources` array), every source's `id` is registered. The view
index maps each source view ID to the parent layer + the specific source, so the correct
sub-label is shown in the inspector.

Temporary external views have dynamic `MX-GJ-*` IDs and cannot be included in the static index.
`src/external/index.js` therefore keeps a second runtime index keyed by temporary view ID. The
site inspector consults the static index first, then the external runtime index.

---

## MapX SDK: temporary GeoJSON views for external data

The SDK can inject client-supplied GeoJSON into the active MapX iframe:

```js
const view = await mapx.ask("view_geojson_create", {
  data: featureCollection,
  save: false,
  title: "External layer",
});
await mapx.ask("view_geojson_set_style", {
  idView: view.id,
  paint: { "fill-color": "#f27739", "fill-opacity": 0.82 },
});
```

The returned ID has the form `MX-GJ-*`. Delete it with `view_geojson_delete`, not the normal
`view_remove`, when the app no longer needs the temporary view.

Important behavior: creating a GeoJSON view automatically fits the map to its extent. When
replacing a view to change its data attributes, capture `map_get_center` and `map_get_zoom`
before creation and restore them with `map_jump_to` afterwards.

---

## EDRA agriculture source is not in the public drought WMS

The European Drought Risk Atlas agriculture scenarios are built by the EDRA web application,
not advertised by `api/wms?REQUEST=GetCapabilities`. Its client combines:

- NUTS geometry from `gis/gapk/wfsService?MAP=EDRA...`
- values from `edra/rest/dataByBBox?system=AGRICULTURE&subsystem=...`

The values request requires the projection as the final comma-separated bbox component:
`2000000,1000000,7000000,6000000,EPSG:3035`. Omitting it returns HTTP 400.

The geometry service also returns EPSG:3035 coordinates even when `SRSNAME=EPSG:4326` is
requested. MapX's GeoJSON importer assumes WGS84 and does not apply the embedded per-geometry
`crs` member, so reproject every coordinate before calling `view_geojson_create`.

---

## Drag + resize panels: collapse vs inline-style conflict

When a user resizes a panel (inline `style.width`/`height`/`maxHeight` are set), subsequently
collapsing the panel via its toggle button leaves the inline width in place and overrides the
`.is-collapsed { width: auto }` CSS rule, breaking the collapsed state.

Fix: store the resized dimensions in `el.dataset.resizedWidth` / `el.dataset.resizedHeight`.
Before adding `.is-collapsed`, call `onPanelCollapse(el)` to clear the inline styles. After
removing `.is-collapsed`, call `onPanelExpand(el)` to restore the stored dimensions. This
pattern is implemented in `src/utils/panels.js`.

## Dev mode: MapX native inspector alongside custom panel

`set_features_click_sdk_only({ enable: true })` suppresses MapX's native feature popup so only
our Site Details panel handles click results. In `src/sdk/inspect.js`, both
`enableInspection()` and `disableInspection()` guard this call with `if (!import.meta.env.DEV)`.

In dev builds this means both panels appear simultaneously — useful for cross-checking that our
panel renders the same data MapX would show natively. In production only our panel appears.

In the Vitest test environment `import.meta.env.DEV` is `true` by default, so tests verify
that the `ask` call is **not** made (dev mode behavior).

---

## Layer type: `rt` vs `vt` for country-level indicator data

MapX view type codes are:

- `rt` — true raster tiles (gridded/continuous imagery: flood depth, earthquake PGA, population density)
- `vt` — vector tiles (points, lines, polygons: country centroids, administrative boundaries)
- `cc` — custom coded / live chart

Country-level economic/risk metrics (AAL, PML, fiscal gap, wellbeing, etc.) are stored in MapX as **vector tile point data** — they render as dots on the map and DO fire `click_attributes` events with their country attributes.

Incorrectly typing them as `rt` causes:

1. The sidebar badge to say "raster" (misleading)
2. The site inspector to show "Raster layer — not queryable" if the view doesn't appear in a `click_attributes` batch

All risk and resilience layers in `src/config/layers/risk.js` and `resilience.js` should be typed `vt`.

True raster layers (like earthquake PGA in `hazard.js`) remain `rt`.

---

## MapX SDK: cross-project `view_add`

The SDK initialises one MapX project at a time (currently ECO-DRR, `MX-2LD-FBB-58N-ROK-8RH`). In theory, `view_add` calls for views belonging to other projects should fail silently. In practice, cross-project calls work — layers from outside ECO-DRR load without error in testing.

**Likely reason:** MapX respects the public visibility flag on a view. Publicly accessible views load regardless of which project the SDK is connected to.

This is not guaranteed by the SDK contract. For now it is not a blocker, but consolidating all views into a single UNDRR project is the correct long-term solution (see [TODO.md](TODO.md#mapx-project-consolidation)).

---

## Layer config: `r2rCategory` and `withR2rGroups()`

Each layer object carries an `r2rCategory` field (`"Societies"`, `"Economy"`, or `"Environment"`) that maps to the UNDRR Risk-to-Resilience framework. The `withR2rGroups()` helper in `src/config/layers/index.js` groups a tab's layers into these categories for sidebar display.

**How it works:**

- If all layers in a tab share a single category (e.g. Hazard is all "Societies"), `groups` is `null` and the tab renders flat.
- If multiple categories are present, `groups` is an array of `{ id, label, layers }` objects in fixed order: Societies → Economy → Environment.
- The sidebar renders groups as `<details>`/`<summary>` elements, open by default, with a CSS arrow indicator that rotates when collapsed.
- `updateDisabledLayerVisibility()` hides the entire `<details>` element (not just the heading) when all its child layers are disabled and "Show disabled" is off.

**Adding a new layer:** Always set `r2rCategory`. Omitting it places the layer in an "Other" bucket that appears after the three standard groups.

---

## Content pipeline: `data/inventory.csv` ↔ JS layer config

`data/inventory.csv` is the non-developer-editable source of truth for layer metadata. It is column-aligned to the programme team's master spreadsheet.

`scripts/import-inventory.mjs` compares the CSV against the JS config files and reports differences. With `--apply` it patches:

- MapX view IDs (`id:` on simple layers, `id:` on compound sub-sources)
- Status changes between `disabled-awaiting-data` states

It does **not** patch: label, description, source, citation, license, legend, widget config, or geometry. Those require a developer edit to the JS config.

Runtime external layers use one simple-layer row with:

- a blank **MapX view ID** (temporary `MX-GJ-*` IDs are never durable);
- **Type** such as `Vector / external runtime`;
- **Inventory status** `External runtime`, which the importer treats as published.

Do not create one CSV row per external control combination unless those combinations are genuine,
permanent sub-sources. The EDRA crop and scenario selectors are represented by one tracker row.
See [docs/external-layers.md](docs/external-layers.md) for the exact EDRA entry and operational
metadata that does not fit in the 14-column CSV.

**Key implementation detail:** In the JS layer objects, `id:` appears _before_ `key:`. The import script searches _backward_ from the `key:` position to find the enclosing object start, then searches forward within that slice for `id:`. A forward search from `key:` would find the wrong `id:` (from the next object).
