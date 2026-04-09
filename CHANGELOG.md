# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

## [Unreleased]

### Added

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
