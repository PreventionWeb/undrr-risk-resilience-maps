# Map-first prototype

Open `/map-first.html` on the local Vite server. This is a separate experiment
alongside `/layer-workspace.html` (the stepper version) and `/` (the existing
viewer). It has its own entry module, page stylesheet and localStorage key,
`undrr-map-first-preview-v1`. Neither previous workspace is read or overwritten.
The app bar links back to the stepper prototype for comparison.

## First impression

The world map connects immediately and opens **Earthquake average annual loss as
a share of GDP**, using the existing `aal-to-gdp-2025:0` source. No modal, initial
selection step or saved-map setup stands between arrival and exploration. The
map has a visible indicator name, exact variant, units, baseline, legend and
source details. It is labelled Featured map, not an overall measure of risk.

The 2025 date is the configured baseline, not a claim about observed losses in
that year. The source describes average annual loss, a modelled risk measure.
Final publication still requires provider/editorial confirmation of the default
indicator's explanatory wording and suitability for the intended audience.

The early-warning map is not the default: its local source still carries an
awaiting-data status despite a live view. The broader catalogue retains the
existing availability policy and shows source notes when a dataset is opened.

## Browse and My maps

Browse contains a few suggested maps, a search field, a category selector and
compact dataset rows. Opening a row reveals the exact variants and separate
**View map** and **Save to My maps** actions. It does not expose every hazard,
crop and scenario as an initial wall of buttons.

Viewing replaces the current thematic map without saving it. Saving keeps that
exact variant without replacing the current map. My maps shows Saved, Loading,
On map, Left map or Right map, with a separate remove action. Clearing the saved
collection leaves the displayed map usable. It never sends someone to onboarding.

Returning visitors resume their displayed map, saved collection and rail view.
An explicit `?map=aal-to-gdp-2025:3` link overrides the current display while
preserving the saved collection.

## Inspection

Country search reads the displayed view's source table only for indicators
already reviewed for region-level CSV downloads. It does not fetch arbitrary
point/grid tables or manufacture country aggregates. Search selects a matching
source record and requests a country highlight without changing the camera.
Clicking a map uses the MapX `click_features` payload for that map's displayed
view. Raster and point results remain feature/location attributes.

For the GDP-loss family the inspector recognizes its actual named joined
`j0_aal_*_togdppercent` attribute, as well as the standard `j0_value` shape. It
shows a value, units, baseline and source. Zero is retained as zero; null, `$NULL`
and no-data values are labelled No reported data. Unknown multi-attribute
indicators retain their returned attributes rather than guessing a primary metric.
The prototype does not aggregate features or imply within-country resolution
from national estimates.

## Comparison and downloads

Compare appears when the current map and saved collection provide at least two
variants. It opens two maps with independent variant selectors, separate legends
and optional linked cameras. Cameras use the existing adapter and the same
1.2-second synchronization approach as the stepper prototype. Comparison does not
imply the maps use comparable classifications; the interface asks readers to check
units and legend scales.

Downloads review the displayed map and exact saved variants, including maps not
currently displayed. Eligible CSV and hosted-file actions reuse the existing
progress, cancellation and large-file flows. Downloading does not change the saved
collection. CSV exports state that geometry is excluded.

This experiment deliberately omits an overlay/opacity/stacking mode. It does not
alpha-blend country colour fills. The stepper prototype remains available for
reviewing layer-stack controls; a production overlay workflow still needs explicit
geometry and collection-compatibility rules. Dynamic EDRA provider layers remain
outside both experimental catalogues.

## Mangrove and verification

The prototype shares the pinned Mangrove 2.3.0 CSS, canonical UNDRR header, font
roles, theme tokens, official icon masks and existing preview thumbnails. Browse
and My maps use native pressed buttons controlling two rail sections. The custom
application layout is isolated by `mf-` classes. The native dialog is confined to
download review because the current Dialog manifest marks the library component
unreleased in 2.3.0.

`tests/e2e/map-first.spec.js` covers immediate display, viewing versus saving,
independent variants, clearing the collection, country lookup with zero and missing
values, feature inspection, explicit map links, download review, state isolation
and narrow-screen fit. It uses the shared MapX stub. The existing stepper browser
suite is run alongside it. Live review separately checks the actual map, country
records, source legend and comparison; it is not evidence of usability with the
intended audience.

Validation command:

```sh
E2E_PORT=3052 yarn test:e2e tests/e2e/map-first.spec.js tests/e2e/layer-workspace.spec.js --workers=2
```

The three useful audience tasks remain: find and interpret a country value;
compare two named variants; save several maps and download a variant that is not
shown. This prototype makes those tasks reviewable before choosing an approach.
