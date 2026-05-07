# TODO

Deferred work items, tracked here until they move into issues or get done.

> See [LEARNINGS.md](LEARNINGS.md) for design decisions, SDK quirks, and hard-won knowledge.

## State store upgrade

The current store (`src/state/store.js`) is a Set of open view IDs plus an active tab string. This works for basic layer toggling, but will need to grow when we add:

- **Per-layer filter state** -- numeric ranges, text filters, dropdown selections. Currently the only per-layer control is the opacity slider, which reads/writes directly to the SDK. Adding more filters means storing their values locally so we can restore state on tab switch or page reload.
- **Session persistence** -- saving the user's layer selections and filter settings to `localStorage` so they survive a page refresh.
- **URL state encoding** -- active layers and the active tab are already encoded in the URL hash (shareable links, back/forward). What isn't yet encoded: per-layer filter settings (opacity writes directly to the SDK, not to URL state) and sub-tab source index within compound layers. These will need URL encoding when session persistence lands.

The upgrade path: replace the flat Set with a keyed object (`{ [layerId]: { visible, opacity, filters } }`) and add `saveSession()` / `loadSession()` helpers. Do this before adding any filter widgets beyond opacity.

## MapX project consolidation

Create a dedicated UNDRR project in MapX that aggregates all needed data sources, keeping the SDK integration clean (one project, one iframe). Coordinate with the MapX platform contact at GRID-Geneva.

Cross-project `view_add` calls currently work in practice (see [LEARNINGS.md](LEARNINGS.md#mapx-sdk-cross-project-view_add)), so this is not blocking, but should be resolved before production.

## Widget event bus

The compound layer system (`src/ui/widgets/`) uses a callback pattern: each widget calls `onSourceChange(index)` which the sidebar routes to `switchSource()`. This works for source switching but is tightly coupled -- the sidebar owns all SDK call logic.

If we add filter widgets that need to call SDK filter methods (e.g. `set_view_layer_filter_text`, `set_view_layer_filter_numeric`), a lightweight event emitter would decouple widgets from specific SDK calls. Each widget would emit `{ type, layerId, value }` events, and a central handler would dispatch to the right SDK method.

Not blocking -- the current callback pattern works fine for source switching and opacity. Revisit when adding SDK filter widgets.

## Dual-panel map view

The GRI Risk Viewer supports side-by-side map panels. Each panel requires its own `mxsdk.Manager` instance (separate iframe). This is a v2 feature — no code exists yet and it's not currently planned for the MVP scope.

