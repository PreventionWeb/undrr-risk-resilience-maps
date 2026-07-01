# Product Specification — UNDRR Risk & Resilience Map Viewer

> Version: 1.0 · Date: July 2026  
> Status: Prototype complete. This document describes the current build and the agreed intended scope for production. Changes to this spec may materially affect effort estimates in the accompanying [Resourcing Plan](resourcing-plan.md).

---

## 1. Purpose

The UNDRR Risk & Resilience Map Viewer is an interactive geospatial platform that makes global disaster risk and resilience data explorable by decision-makers, researchers, and UNDRR stakeholders. It provides a single interface for five data categories — Risk, Resilience, Hazard, Exposure, and Vulnerability — organised around the eight hazards that cause 90% of economic losses from disasters.

The tool is part of UNDRR's Risk & Resilience Metrics initiative. It does not duplicate UNDRR's existing country profiles or analytical resources; it provides a spatial layer that links to them.

**Primary audience:** UNDRR stakeholders, national DRR focal points, researchers, and policymakers — not general public.

**Secondary audience:** UNDRR digital and programme teams who maintain the layer inventory.

---

## 2. What has been built (current prototype)

The following is implemented and tested as of July 2026:

### Navigation & routing
- Five data tabs (Risk, Resilience, Hazard, Exposure, Vulnerability) plus four info pages (Home, Guide, Sources, Downloads/About)
- Hash-based URL routing: active tab and active layers are encoded in the URL, enabling shareable deep links
- Tab switching via nav bar and keyboard; browser back/forward supported

### Map layer panel
- Floating, draggable, resizable sidebar panel
- Layer accordion: each layer has a toggle (eye icon), opacity slider, description, and legend image
- "Show disabled" toggle to reveal placeholder/coming-soon layers during review
- "Clear all" to deactivate all layers at once
- Cross-tab sections: layers from other tabs accessible without leaving the current tab
- R2R category groups (Societies / Economy / Environment) shown as collapsible headings within each tab, open by default

### Layer configuration
- 100+ layer entries across all five categories
- Simple layers (single MapX view) and compound layers (multiple sub-sources with a widget switcher)
- Per-layer fields: label, description, type, source attribution, citation, license, MapX view ID, initiative, R2R category, R&R step, inventory status, note
- Status system: Active, Disabled (awaiting data), Disabled (coming soon), Disabled (review only)
- Widgets: stepped slider (e.g. return period selection), sub-tabs (e.g. metric switching)

### Site inspection
- Inspect mode: click any location on the map to query active vector layers
- Site Details panel: coordinates, per-layer feature attributes, data-presence indicators, per-layer data download
- Raster layers correctly flagged as non-queryable at a point

### Info pages
- **Home**: five category cards linking to each data tab; hero intro with UNDRR link
- **Guide**: step-by-step usage instructions
- **Sources**: per-category attribution tables (source, citation, license, notes); MapX view ID toggle for technical review; layer inventory CSV download
- **Downloads**: placeholder with links to source data providers
- **About**: tool description, acknowledgements, further reading

### Content pipeline
- `data/inventory.csv`: 101-row master layer inventory, column-aligned to the programme team's spreadsheet; source of truth for layer metadata
- `scripts/import-inventory.mjs`: dry-run diff tool and `--apply` mode to patch MapX view IDs and status changes from CSV into JS config
- CSV export (Downloads / Sources page): generates a timestamped CSV of the current layer inventory

### Technical
- Vite build system; 170 unit tests across 11 test files
- UNDRR Mangrove design system v1.8.0
- MapX SDK (UNEP/GRID-Geneva) via iframe/postMessage
- PIN gate (prototype access control; see §4)
- Deployable as a static site (GitHub Pages / any static host)

---

## 3. Functional scope

### In scope at production launch

| Feature | Notes |
|---|---|
| Five-tab layer explorer | Risk, Resilience, Hazard, Exposure, Vulnerability |
| Layer toggle, opacity, legend | Legend currently static image per layer |
| Site inspection (vector layers) | Click location → attribute popup |
| Shareable deep links | Hash-encodes active tab + layers |
| Sources attribution table | Per-layer citation, license, MapX view ID |
| Layer inventory CSV export | Full inventory download |
| Home page with category cards | Links to each tab |
| Guide and About pages | Usage instructions and tool background |
| Content pipeline | CSV import/export round-trip for non-developer updates to MapX IDs and status |
| UNDRR Mangrove branding | Page header, nav, design tokens |

### Explicitly out of scope at launch

| Feature | Reason / Future path |
|---|---|
| Side-by-side dual map panels | Was in original PRD; deferred — MapX SDK multi-view support needs validation |
| Country profile click-through | Was in original PRD; deferred — country profile URLs not yet confirmed |
| Geographic / attribute filtering | Significant new work; post-launch if required |
| Time slider / temporal animation | Depends on data availability and MapX temporal API |
| Dynamic legend extraction | MapX SDK does not currently expose legend data (see §5) |
| Multilingual interface | UNDRR six-language need; not in scope for this tool at launch |
| User accounts / saved sessions | No authentication beyond access control at URL level |
| Geospatial analysis functions | Draw-box, spatial queries — out of scope per original PRD |
| Print / PDF export of map | Post-launch if required |
| Data upload to MapX | Programme team responsibility via MapX platform |

---

## 4. Known gaps and pre-launch requirements

These are things the prototype has as placeholders that must be resolved before production:

| Item | Current state | Required state |
|---|---|---|
| **Access control** | 4-digit PIN hardcoded in client JS (`src/pin-gate.js`) | Real access control: public URL, UNDRR SSO, or IP allowlist — decision needed |
| **Tool name / branding** | "GRAR Metrics Facility Map Viewer" used in `<title>`, `index.html`, About/Guide text | Final name agreed and applied throughout |
| **MapX SDK version** | Loaded from `https://app.mapx.org/sdk/mxsdk.umd.js` (no version pin) | Pinned to a stable version to prevent silent breaking changes |
| **Hosting** | GitHub Pages (static, manual deploy) | UNDRR infrastructure — decision needed (see §5) |
| **Country links** | Not implemented | Country profile URL pattern confirmed; links added to site inspection panel |
| **MapX commercial terms** | Flagged as open in original PRD | Confirmed as resolved (or still open?) |
| **Legend images** | Static per layer (or absent) | Either dynamic extraction (see §5) or static images confirmed per layer |
| **Social / OG metadata** | `index.html` has no `<meta property="og:...">` tags | Basic social preview metadata added |
| **Raster layer inspection** | Correctly flagged as non-queryable | No change needed — but UX message could be clearer |
| **Mobile experience** | Not designed or tested for mobile | Decision: is mobile in scope? If yes, significant layout work required |

---

## 5. Open questions (affect scope and effort)

These must be answered before the resourcing plan can be finalised:

1. **Hosting path** — standalone subdomain, embedded in Drupal/CMS, or content syndication iframe? Determines nav/auth/routing architecture.
2. **MapX legend API** — does UNEP/GRID-Geneva plan to expose legend data programmatically? If yes, what timeline? If no, what is the fallback (static images managed per layer)?
3. **Country profile click-through** — what URL pattern? Is this a priority for launch?
4. **Final tool name** — needed before any branding/copy work proceeds.
5. **Access control model** — who is this tool for, and how is access managed in production?
6. **Mobile scope** — required at launch, or desktop-first?
7. **MapX collaboration scope** — SDK support only, or active co-development on this repository?
8. **Dual map panels** — explicitly deferred, or still a launch requirement?

---

## 6. Technical architecture summary

```
Browser
  └── index.html (Vite SPA entry point)
       ├── Mangrove CSS (UNDRR design system, CDN)
       ├── MapX SDK UMD (UNEP/GRID-Geneva, CDN)
       └── src/main.js
            ├── src/config/layers/      Layer definitions (JS objects)
            │    ├── risk.js / resilience.js / hazard.js / exposure.js / vulnerability.js
            │    └── index.js           TABS array, withR2rGroups() helper
            ├── src/ui/                 DOM-building UI modules
            │    ├── sidebar.js         Nav + layer panel + tab routing
            │    ├── home.js            Home page cards
            │    ├── info-panels.js     Guide / Sources / Downloads / About
            │    ├── site-inspector.js  Click-to-inspect + Site Details panel
            │    └── widgets/           Compound layer widgets (stepped-slider, sub-tabs)
            ├── src/sdk/                MapX SDK wrappers
            │    ├── client.js          SDK initialisation + singleton
            │    ├── views.js           viewAdd / viewRemove
            │    └── inspect.js         click_attributes event handling
            ├── src/state/
            │    ├── hash.js            URL hash encode/decode
            │    └── store.js           Active tab + active layers state
            └── src/utils/
                 └── export-layers.js   CSV generation

data/inventory.csv                      Master layer inventory (source of truth)
scripts/import-inventory.mjs            CSV → JS config import tool
```

**Key constraints:**
- All logic is client-side; no backend server required
- MapX renders the map in an iframe via postMessage API; the app has no direct access to map DOM
- Layer config lives in JS source files; content updates require a code change or the CSV import tool
