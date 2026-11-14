# Layer workspace interaction preview

Run `yarn dev` and open `/layer-workspace.html`. The existing viewer is still at `/`.
The preview is a separate entry point using the current published layer configuration,
MapX SDK loader, structured legend parser, camera adapter and CSV download workflow.
It does not change the existing sidebar, URL routing or production layer controller.

The workspace starts empty. New visitors start at an inline **Choose layers** step with three suggested
maps and static thumbnails captured from the live maps. Their first choice is
shown on the map; other variants can be collected independently. Returning
visitors resume their saved step. **Explore map** becomes available after a
selection; the map connection starts only when that step opens. The step
navigation remains available to return to the catalogue without losing selections.
Escape cannot dismiss this page step. Clearing all layers returns to the chooser.

Use `/layer-workspace.html?start=1` to review the first-visit flow without reading
or overwriting an existing saved workspace. Thumbnails are documented in
[the preview-image notes](../public/preview-thumbnails/README.md).
Use **Add layers** to search across categories and add independent child variants.
Adding a variant collects it without replacing the current map. Workspace order,
selection, mode and opacity persist in localStorage under
`undrr-layer-workspace-preview-v1`. **Clear all** empties the selection.

- **One layer** shows one indicator and its legend; its eye button hides or shows it.
- **Overlay** allows multiple visible layers. Top of list means top of map.
  Drag the handles or use up/down buttons. Ordering uses MapX's native
  `set_views_layer_order`; Settings controls each variant's opacity.
  New variants start hidden; entering Overlay carries over the single map selection.
- **Compare** shows two maps, with explicit variant selectors and individual legends.
  Cameras follow each other while Views linked is enabled. The prototype polls the
  existing camera adapter every 1.2 seconds rather than depending on undocumented
  map movement events. The second map connects only when Compare is first opened.
- **Download data** reviews all collected variants, including hidden ones. Each
  eligible variant uses the existing CSV progress/cancel flow or its hosted file.
  This is per-variant downloading, not a combined archive.

This is a reviewable UX prototype, not a replacement for the production controller.
It has its own serialized map reconciliation. On a remote failure it reports the error;
change a layer to retry or reload to reconnect. It omits dynamic EDRA provider layers
from its catalog and does not implement blend modes or spatial intersection. Overlay
uses normal alpha compositing, which can conceal lower layers or mix legend colors.
The overlay legend identifies the top layer; use Compare to read indicators separately.
A production integration should use map movement events where supported and reconcile
this workspace model with collection policy, sharing, inspection and external providers.

Validation: `yarn build`, `yarn lint`, `yarn test`, and
`yarn test:e2e tests/e2e/layer-workspace.spec.js`. Browser tests use the shared MapX
stub; live MapX is checked manually through the local preview.

## Design-system follow-up

See [Mangrove upstream candidates](mangrove-upstream-candidates.md) for the
header, reorder, collection and layout patterns worth considering, the existing
components to reuse, and the mode-selector placement feedback from this preview.
These are local notes; no upstream trackers have been opened.

The [Mangrove and UNDRR alignment record](mangrove-alignment.md) maps the preview
to published components, tokens and editorial guidance, including the native
Dialog fallback required by the pinned 2.3.0 release.

## Alternative prototype

The separate [map-first prototype](map-first-prototype.md) at `/map-first.html`
opens directly on a featured map. It explores an alternative to the mandatory
Choose layers step and keeps its own saved state. Both versions remain available
for comparison.
