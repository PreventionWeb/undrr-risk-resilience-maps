# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

## [Unreleased]

### Added

- **August 2026 map inventory import**: reconciled 122 programme spreadsheet rows with the runtime registry, including eight World Bank recovery-speed views, PML public infrastructure views, crop placeholders, the ecosystem-loss and early-warning MapX IDs, richer source metadata, new Risk/Resilience placeholders, and explicit pending-removal states. The inventory importer now supports repeated sub-source labels and status-only updates.
- **External EDRA crop-risk prototype**: the Hazard group can now fetch European Drought Risk Atlas NUTS-2 boundaries and drought-related crop-yield reductions directly from Copernicus CEMS, reproject the source geometry from EPSG:3035, and inject it into MapX as a temporary GeoJSON view. The layer includes barley/maize/wheat and historical/current/+1.5 °C/+2 °C/+3 °C controls, opacity, a local legend, URL restore, and site-inspection attributes.
- External-layer runtime registry and provider adapter pattern, allowing non-MapX sources to participate in the existing `openViews`, inspection, clear-all, and layer-control workflows without a permanent MapX view ID.
- External-runtime governance guide covering the programme source-tracker row, ownership workflow, measured EDRA payload/reprojection costs, reliability and privacy dependencies, production trade-offs, and migration triggers.
- **Drag + resize for panels**: both the layer panel and the Site Details panel are now draggable (drag by their header bar) and resizable (bottom-right grip). Inline dimensions are cleared on collapse and restored on expand so the layer panel's collapsed state is not broken by a prior resize. Implemented in `src/utils/panels.js` (`makeDraggable`, `makeResizable`, `onPanelCollapse`, `onPanelExpand`) and `src/styles/components/panels.css`.
- **Dev-mode MapX native inspector**: in development builds (`import.meta.env.DEV`), the `set_features_click_sdk_only` suppression call is skipped so MapX's native feature popup appears alongside our custom Site Details panel, enabling data cross-checking during development.
- Site inspection mode: an **Inspect** button in the sidebar header activates click-to-inspect on the map. Clicking any location fires MapX `click_attributes` events (one per active vector layer); the app batches them and shows a floating **Site Details** panel with geographic coordinates, per-layer feature attributes, data-presence indicators, and a download button for each layer. Raster layers are shown as "not queryable at point". The panel closes on ✕ click or Escape. A generation counter prevents stale events from appearing after inspection is toggled off.
- `LEARNINGS.md`: project-level knowledge base documenting the confirmed `click_attributes` payload shape, batching pattern, RT layer limitations, `set_features_click_sdk_only` usage, the Mangrove `<details>` convention, and the view-index pattern.
- `closeInfobox()` exported from `src/ui/infobox.js` so the infobox can be explicitly dismissed when entering inspection mode.

- Cross-tab layer sections: each tab panel now shows collapsed `<details>` sections for all other tabs, letting users toggle layers from any category without switching tabs. Secondary eye buttons delegate to the canonical toggle; state (active indicator, auto-expand) stays in sync. Rapid/concurrent clicks are guarded by an in-flight Set per layer key.
- Risk & Resilience layers now active: MapX view IDs wired for AAL Public, AAL/PML Housing, AAL/PML to GDP 2025, PML to GDP 2025, Current Fiscal Gap (all 5 hazards including Floods), Well-being, and Change in Fiscal Gap — sourced from the confirmed inventory spreadsheet.
- Risk & Resilience tab now renders Risk Maps and Resilience Maps as distinct labelled subgroups in the sidebar; group headings hide automatically when disabled layers are not shown
- Canonical Risk and Resilience layer inventory sourced from the planning spreadsheet: 16 Risk layers (AAL/PML by hazard, fiscal gap, recovery speed, ecosystem loss, supply-chain disruption, bank solvency, sovereign debt, DRR financing, humanitarian vs. prevention expenditure) and 3 Resilience layers (wellbeing, change in fiscal gap, adaptation) — all marked `disabled-awaiting-data` pending MapX view ID assignment
- Config validator now checks for duplicate layer `key` values (previously only checked view IDs)
- Resilience tab with planned placeholder entries for future resilience-linked content
- Broader CDRI risk placeholders (AAL and 1:100 PML review entries) added to the Risk inventory
- Public roadmap note clarifying that future indicator/chart content will live outside this repository and be cross-linked into the map experience later
- Empty-state copy for categories that currently have no published layers
- Layer-panel review toggle for showing disabled layers without publishing them
- "Clear all" button in the layer panel header — hides when no layers are active
- Compound layer system: one accordion item can switch between multiple MapX views
- Sub-tabs widget for switching data metrics (depth / frequency / exposure)
- Stepped slider widget for return period selection (earthquake PGA: 250-2475yr)
- Widget registry (`src/ui/widgets/`) -- add new types without touching sidebar code
- Earthquake PGA layer with 5 return period sources
- River Flooding compound layer (depth, frequency, exposure sub-tabs)
- Tropical Cyclone, Landslide, Tsunami compound layers (exposure/frequency)
- Home / About panel, Guide, Sources, Downloads info pages
- Preview PIN gate for prototype access control
- Hash-based URL routing: active layers and active tab encoded in the URL so links are shareable and browser back/forward works
- GitHub Actions workflow for GitHub Pages deployment
- Startup config validation (catches typos, missing IDs, bad legend entries, duplicate view IDs, cross-project layers)
- Mangrove `mg-mega-topbar` navigation bar with category tabs and info links
- Floating layer panel over full-width map (collapsible, scrollable)
- Accordion layer items with expand arrow, type tags, and eye toggle
- Per-layer opacity sliders (inverted to MapX SDK transparency)
- Accessible structured HTML legends for supported MapX vector styles and approved discrete GeoServer raster colormaps, with bounded/allowlisted MapX mirror retry, lazy image comparison, labelled diagnostics, stale-render protection, and automatic image fallback for unsupported styles
- Local legend override system (HTML swatches) with SDK PNG as diagnostic fallback
- Feature click popup (infobox) from MapX `click_attributes` events
- MapX SDK wrapper modules (`src/sdk/client.js`, `views.js`, `filters.js`, `map-control.js`)
- CSS split into design tokens + per-component files
- Accessibility: focus-visible, aria attributes, keyboard nav, prefers-reduced-motion
- Layer config split into per-category files under `src/config/layers/`

### Fixed

- EDRA value requests now cover all available regions, including the Azores and Madeira; strict schema, duplicate-key, feature/vertex/value-count, and minimum join-coverage checks fail visibly instead of silently rendering a plausible no-data map.
- EDRA crop colours, thresholds, and no-data styling now come from the live configuration used by the source explorer. The MapX paint expression and HTML legend share that validated definition, preventing independent upstream-style drift.
- External-view deletion failures now keep the prior runtime registration and UI state authoritative; failed replacements clean up the candidate view instead of risking a hidden or duplicated MapX layer.
- `buildLayerAccordion` was checking `!layer.disabled` (legacy flag) for the eye toggle, so layers with `status: "disabled-awaiting-data"` would receive an eye button that called `viewAdd(null)`; now uses `isLayerPublished()` consistently
- Config validator was requiring non-null source IDs for all compound layers regardless of publication state; unpublished compound layers may now have `null` source IDs (IDs are assigned once views are uploaded)
- Duplicate MapX view IDs between hazard and risk layers caused incorrect layer state; affected risk layers temporarily disabled with TODOs
- Cross-project layer (Land Cover from HOME project) silently failing; disabled until a unified UNDRR MapX project is set up
- Hash `sourceIdx` out-of-bounds read crashing compound layer restore on back/forward navigation
- Back/forward navigation not reconciling which layers to turn off (only turned layers on)
- UI built inside the SDK `ready` handler, so sidebar appeared blank until the map loaded
- Infobox ESC key listener leaked on every open, accumulating handlers; replaced with a single managed module-level handler
- Category cards on the home page were non-interactive `<article>` elements; replaced with focusable `<button>` elements dispatching `navigate-tab` events

### Changed

- EDRA geometry, crop, and style-configuration responses are cached per page session, failed requests remain retryable, and source requests now time out after 30 seconds. Scenario switches no longer repeat the values request.
- External crop/scenario settings are encoded in shared URLs and reconciled on browser back/forward navigation.
- Layer inventory distinguishes externally delivered layers with a blank MapX ID and `External runtime` status instead of describing them as MapX uploads.
- Layout from fixed sidebar to floating panel over full-width map
- Hazard layers reorganised into compound layers where data pairs exist
- Layer toggles guarded by SDK readiness flag so they cannot fire before the map is connected
- Unpublished prototype layers now support richer states such as Awaiting data and Pending removal while remaining hidden from the sidebar by default and retained in Sources/CSV
- Primary category order now leads with Risk and Resilience
- Coral Reefs moved to disabled/unpublished status while category scope is reviewed
- Terminology updated from "risk to resilience" to "risk and resilience" throughout the project
- Disabled layer accordions are now expandable so descriptions and metadata remain readable during review (previously `pointer-events: none` blocked interaction)
