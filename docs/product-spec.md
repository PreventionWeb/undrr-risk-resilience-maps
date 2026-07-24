# Product Specification — UNDRR Risk & Resilience Map Viewer

> Version: 1.0 · Date: July 2026  
> Status: **V1 definition — stakeholder review required**

---

## ⚠ This document needs your feedback now

A robust working prototype has been built. We are now defining **Version 1** — the production-ready release. This is the right moment to raise anything that isn't captured here, because:

- Changes to V1 scope after build begins carry significant effort and cost implications
- Anything not listed in §3 "In scope at V1" is explicitly deferred — it will not be in the first release
- The resourcing plan in [Resourcing Plan](resourcing-plan.md) is based on this scope

**If something is missing, wrong, or unclear — flag it before sign-off.**  
Once this document is agreed, it becomes the baseline for all effort estimates and change control.

**Target for sign-off: 15 July 2026 progress review** (GRAR / UNEP/GRID-Geneva / Comms / IT). The resourcing discussion at that meeting depends on this scope being agreed.

---

## 1. Context: two complementary tools

The Risk & Resilience Metrics initiative is being delivered through two distinct but complementary tools. Understanding the boundary between them is important for scoping this viewer correctly.

**Country pages — led by UNEP/GRID-Geneva, powered by Apache Superset**  
Bar charts, indicator tables, time-series, and per-country narrative content for a defined set of countries. Superset is the data engine; output is embedded into UNDRR country profile pages or equivalent. This stream is the primary subject of GRID/UNEP's planning work.

**Map viewer — this repository**  
A global spatial explorer: toggleable data layers across five categories (Risk, Resilience, Hazard, Exposure, Vulnerability), site inspection, and layer metadata. Operates at the global scale; no country-level filtering or charting in V1.

The two tools are designed to sit alongside each other. A natural future integration point would be clicking a country on the map and seeing Superset-driven charts — a pie chart of economic loss by hazard type, for example. This is technically realistic and architecturally straightforward once both tools are in production. It is explicitly **not in scope for V1** and is documented as a deferred feature in §3.

For the purposes of this specification, all scope, effort, and resource discussion refers to the **map viewer only**.

---

## 2. Purpose

The UNDRR Risk & Resilience Map Viewer is an interactive geospatial platform that makes global disaster risk and resilience data explorable by decision-makers, researchers, and UNDRR stakeholders. It provides a single interface for five data categories — Risk, Resilience, Hazard, Exposure, and Vulnerability — organised around the eight hazards that cause 90% of economic losses from disasters.

The tool is part of UNDRR's Risk & Resilience Metrics initiative. It does not duplicate UNDRR's existing country profiles or analytical resources; it provides a spatial layer that links to them.

**Primary audience:** UNDRR stakeholders, national DRR focal points, researchers, and policymakers — not general public.

**Secondary audience:** UNDRR digital and programme teams who maintain the layer inventory.

---

## 3. What has been built (current prototype)

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

- `data/inventory.csv`: master layer inventory, column-aligned to the programme team's spreadsheet; source of truth for layer metadata. Runtime external layers have a blank MapX ID and `External runtime` status.
- `scripts/import-inventory.mjs`: dry-run diff tool and `--apply` mode to patch MapX view IDs and status changes from CSV into JS config
- CSV export (Downloads / Sources page): generates a timestamped CSV of the current layer inventory
- `docs/external-layers.md`: approval, tracker, architecture, performance, and operating requirements for exceptional non-MapX sources

### Technical

- Vite build system; 225 unit tests across 16 test files
- UNDRR Mangrove design system v1.8.0
- MapX SDK (UNEP/GRID-Geneva) via iframe/postMessage
- PIN gate (prototype access control; see §4)
- Deployable as a static site (GitHub Pages / any static host)

---

## 4. Functional scope

### In scope at production launch

| Feature                         | Notes                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Five-tab layer explorer         | Risk, Resilience, Hazard, Exposure, Vulnerability                             |
| Layer toggle, opacity, legend   | Native vector legends where supported; authoritative image fallback otherwise |
| Site inspection (vector layers) | Click location → attribute popup                                              |
| Shareable deep links            | Hash-encodes active tab + layers                                              |
| Sources attribution table       | Per-layer citation, license, MapX view ID                                     |
| Layer inventory CSV export      | Full inventory download                                                       |
| Home page with category cards   | Links to each tab                                                             |
| Guide and About pages           | Usage instructions and tool background                                        |
| Content pipeline                | CSV import/export round-trip for non-developer updates to MapX IDs and status |
| UNDRR Mangrove branding         | Page header, nav, design tokens                                               |

### Explicitly out of scope at V1

The following are realistic and achievable features, but they represent distinct envelopes of work beyond the V1 build. They are documented here so they can be prioritised for future releases rather than appearing as gaps.

| Feature                                            | Why deferred                                                      | Illustrative example                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enhanced site inspection (charts, joined data)** | Significant new work; see note below                              | Clicking a location shows a modal with a chart — e.g. a pie graph of economic loss by hazard type for that country, or a time-series of AAL values — drawn from a data join beyond the raw MapX attribute payload |
| Side-by-side dual map panels                       | Was in original PRD; MapX SDK multi-view support needs validation | Compare two hazard layers at the same location simultaneously                                                                                                                                                     |
| Country profile click-through                      | Country profile URLs not yet confirmed by programme team          | Clicking a country opens the UNDRR country risk profile page                                                                                                                                                      |
| Geographic / attribute filtering                   | New data model + UI; post-launch if required                      | "Show only layers relevant to Floods" or "highlight countries above risk threshold X"                                                                                                                             |
| Time slider / temporal animation                   | Depends on data availability and MapX temporal API                | Scrub through 2025–2050 projected AAL values on the map                                                                                                                                                           |
| Multilingual interface                             | Significant i18n work; no current requirement                     | Arabic, French, Spanish versions of the UI                                                                                                                                                                        |
| User accounts / saved sessions                     | Beyond static-site architecture                                   | Save and share a custom layer selection with colleagues                                                                                                                                                           |
| Geospatial analysis functions                      | Out of scope per original PRD                                     | Draw a bounding box and query all layers within it                                                                                                                                                                |
| Print / PDF export                                 | Post-launch if required                                           | Export current map view as a PDF for a report                                                                                                                                                                     |
| Data upload to MapX                                | Programme team responsibility via MapX platform                   | —                                                                                                                                                                                                                 |

**Note on enhanced site inspection:** The current V1 inspection panel shows tabular attribute data for the clicked location — coordinates, layer name, and the raw field values from the MapX feature. Richer in-panel analysis (charts, data joins, trend lines, comparative modals) is technically feasible but constitutes a separate product scope. It would require: a data join strategy (linking MapX feature attributes to an external dataset), a charting library, a modal UI component, and agreement on what analytical questions the tool should answer. This is called out as an illustrative example of the kind of enhancement that is **easy to underestimate** — it looks like "just adding a chart" but touches data architecture, UX design, and MapX SDK behaviour. If this is envisioned for V1, it must be scoped and resourced now.

---

## 5. Known gaps and pre-launch requirements

These are things the prototype has as placeholders that must be resolved before production:

| Item                         | Current state                                                                                                                           | Required state                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Access control**           | 4-digit PIN hardcoded in client JS (`src/pin-gate.js`)                                                                                  | Real access control: public URL, UNDRR SSO, or IP allowlist — decision needed                                                           |
| **Tool name / branding**     | "GRAR Metrics Facility Map Viewer" used in `<title>`, `index.html`, About/Guide text                                                    | Final name agreed and applied throughout                                                                                                |
| **MapX SDK version**         | Loaded from `https://app.mapx.org/sdk/mxsdk.umd.js` (no version pin)                                                                    | Pinned to a stable version to prevent silent breaking changes                                                                           |
| **Hosting**                  | GitHub Pages (static, manual deploy)                                                                                                    | UNDRR infrastructure — decision needed (see §5)                                                                                         |
| **Country links**            | Not implemented — was in original PRD scope                                                                                             | Country profile URL pattern confirmed by programme team; links added to site inspection panel. _Known gap from original scope._         |
| **Per-layer download links** | Downloads page is a placeholder; `download_view_source_external` SDK method only works if a download URL is configured per view in MapX | Programme team to configure download URLs in MapX for each view, or accept that downloads link to source sites rather than direct files |
| **Legend coverage**          | Supported MapX vector styles render dynamically; raster, sprite, custom-coded, and unsupported styles use the MapX image                | Visual QA against representative production views; confirm image fallback coverage for unsupported styles                               |
| **Social / OG metadata**     | `index.html` has no `<meta property="og:...">` tags                                                                                     | Basic social preview metadata added                                                                                                     |
| **Raster layer inspection**  | Correctly flagged as non-queryable                                                                                                      | No change needed — but UX message could be clearer                                                                                      |
| **Mobile experience**        | Not designed or tested for mobile                                                                                                       | Decision: is mobile in scope? If yes, significant layout work required                                                                  |

---

## 6. Open questions (affect scope and effort)

These must be answered before the resourcing plan can be finalised:

1. **Hosting path** — standalone subdomain, embedded in Drupal/CMS, or content syndication iframe? Determines nav/auth/routing architecture.
2. **MapX legend schema stability** — can UNEP/GRID-Geneva confirm that the style fields returned by `get_views` are a supported contract? Until then, retain and monitor the MapX image fallback.
3. **Country profile URL pattern** — what is the URL structure for UNDRR country profile pages? Needed to implement click-through (a known gap from original PRD scope).
4. **Per-layer download URLs** — will the programme team configure download URLs in MapX for each view? If not, what does the Downloads page link to?
5. **Final tool name** — needed before any branding/copy work proceeds.
6. **Access control model** — who is this tool for, and how is access managed in production?
7. **Mobile scope** — required at launch, or desktop-first?
8. **MapX collaboration scope** — SDK support only, or active co-development on this repository?
9. **Dual map panels** — explicitly deferred, or still a launch requirement?

---

## 7. Technical architecture summary

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
- Runtime external layers add direct browser dependencies on third-party APIs and must pass the external-source review checklist
- Layer config lives in JS source files; content updates require a code change or the CSV import tool
