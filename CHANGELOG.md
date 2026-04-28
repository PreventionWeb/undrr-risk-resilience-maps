# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

## [Unreleased]

### Added

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
- Local legend override system (HTML swatches) with SDK PNG as diagnostic fallback
- Feature click popup (infobox) from MapX `click_attributes` events
- MapX SDK wrapper modules (`src/sdk/client.js`, `views.js`, `filters.js`, `map-control.js`)
- CSS split into design tokens + per-component files
- Accessibility: focus-visible, aria attributes, keyboard nav, prefers-reduced-motion
- Layer config split into per-category files under `src/config/layers/`

### Fixed

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

- Layout from fixed sidebar to floating panel over full-width map
- Hazard layers reorganised into compound layers where data pairs exist
- Layer toggles guarded by SDK readiness flag so they cannot fire before the map is connected
- Unpublished prototype layers now support richer states such as Awaiting data and Pending removal while remaining hidden from the sidebar by default and retained in Sources/CSV
- Primary category order now leads with Risk and Resilience
- Coral Reefs moved to disabled/unpublished status while category scope is reviewed
- Terminology updated from "risk to resilience" to "risk and resilience" throughout the project
- Disabled layer accordions are now expandable so descriptions and metadata remain readable during review (previously `pointer-events: none` blocked interaction)
