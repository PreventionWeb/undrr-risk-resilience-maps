# Product Requirements Document

> UNDRR Risk to Resilience Map — MVP Prototype
>
> Adapted from the [MVP Action Plan (2 Apr 2026)](https://unitednations-my.sharepoint.com/:w:/r/personal/kenneth_hawkins_un_org/Documents/UNDRR%20Risk%20to%20Resilince%20Map%20MVP%20Action%20Plan%20-%20Apr%202026.docx?d=w29a2a1d721204abda2f8c47e16b7b6a8&csf=1&web=1&e=SK02A4). Pending questions remain — see [open questions](#open-questions).

## Glossary

| Term | Meaning |
|---|---|
| UNDRR | United Nations Office for Disaster Risk Reduction |
| GRI Risk Viewer | [Global Resilience Index Risk Viewer](https://global.infrastructureresilience.org) by Oxford OPSIS. The interaction model we're replicating. |
| MapX | [UNEP/GRID-Geneva geospatial platform](https://app.mapx.org/). Hosts map layers and provides an SDK for embedding maps via iframe. |
| Mangrove | UNDRR's CSS component library for consistent branding (page headers, cards, grids, buttons). |
| CRI | Climate Risk Index -- upgraded risk layers being prepared by Andrea (UNDRR programme team). |
| GAR | Global Assessment Report on Disaster Risk Reduction. MapX hosts GAR-derived hazard data via its PREVIEW platform. |
| RCP / SSP | Representative Concentration Pathways / Shared Socioeconomic Pathways -- climate scenario frameworks used in hazard projections. |
| PGA | Peak Ground Acceleration -- seismic hazard measure. |

### People referenced in this document

- **Ken** -- UNDRR digital team, project lead. Liaison with MapX (Pierre).
- **Pierre** -- MapX/GRID-Geneva. Contact for platform terms and technical support.
- **William** -- UNDRR programme team. Owns the data inventory and layer list.
- **Andrea** -- UNDRR programme team. Preparing upgraded CRI layers.

## Objective

Build a [MapX](#glossary)-based geospatial explorer that replicates the [GRI Risk Viewer](#glossary) interaction model, reskinned with UNDRR branding and tied to the Risk & Resilience Metrics framework. Soft launch target: end of May 2026 (London Climate Week fundraising/investor forums).

## Research

Detailed research supporting this PRD:

- [GRI UX analysis](research/gri-ux-analysis.md) -- page structure, sidebar accordion, layer control widgets, site inspection panel, URL state encoding
- [GRI layer inventory](research/gri-layer-inventory.md) -- all 31 GRI layers with source datasets, providers, and licenses
- [GRI-MapX crosswalk](research/gri-mapx-crosswalk.csv) -- every GRI data source mapped to its MapX counterpart (with view IDs where confirmed), source URLs, and gap notes ([XLSX version](research/gri-mapx-crosswalk.xlsx))
- [Implementation patterns](research/implementation-patterns.md) -- scaffolding, Mangrove integration, SDK patterns, and parent/iframe coordination from the demo repo

## Core experience

The GRI Risk Viewer is the UX reference. We adopt its interaction patterns, reskinned to UNDRR branding. This avoids open-ended UI/UX debate by anchoring to a model that already works.

What the user sees:

- Hazard / Exposure / Vulnerability / Risk tabs in a sidebar
- Toggleable map layers with opacity and filter controls per layer
- Click any feature on the map to see its data in a popup
- Up to two map panels side by side
- Country-level clicks link out to Risk & Resilience country pages

## In scope

| Requirement | Detail |
|---|---|
| GRI baseline layers | All current GRI layers: roads, rails, power, plus upgraded CRI layers (from Andrea) |
| Metrics project layers | Augmented layers where data is ready — crop layer confirmed; heat/drought in progress |
| Per-layer metadata | Source attribution, download links or pointers to source sites |
| Roadmap tab | "Coming soon" section signalling planned additions (e.g. subnational vulnerability indices, early warning layers) |
| Country links | Country-level click-through to Risk & Resilience country pages |
| Feature data popups | Basic click-on-point data display (matching existing GRI behaviour) |
| GRI/Oxford credits | Clear successor/credits note acknowledging GRI and Oxford |

## Out of scope

- Geospatial analysis functions (draw-box queries, spatial mining) -- nice to have but not blocking
- Data visualisation not connected to risk-to-resilience. UNDRR has other mapping needs that may use MapX, but those are separate work streams.

## User story (v1)

Land on page &#8594; see map with overlay &#8594; toggle layers in sidebar &#8594; adjust filters/opacity &#8594; click feature for data &#8594; link to country page.

No freeform data mixing by end-users.

## Data layers

Layers are organised by tab (hazard / exposure / vulnerability / risk). The definitive inventory is pending from William (see [open questions](#open-questions)). See [research/gri-layer-inventory.md](research/gri-layer-inventory.md) for the full GRI baseline and [research/gri-mapx-crosswalk.csv](research/gri-mapx-crosswalk.csv) for MapX availability and view IDs.

| Source | Status |
|---|---|
| GRI layers (roads, rails, power) | Ready to clone |
| Upgraded CRI layers (Andrea) | Signalled as ready |
| Metrics: crop layer | Confirmed |
| Metrics: heat/drought layers | In progress |
| Subnational vulnerability indices | Future (Roadmap tab) |
| Early warning layers | Future (Roadmap tab) |

## Open questions

1. **MapX commercial terms** -- Clarify what the ~$10k/year "option one" cost covers and whether it's post-partnership or additional. Owner: Ken + Pierre.
2. **Data upload to MapX** -- Uploading new datasets is possible in principle but needs further testing. Most GRI layers (vulnerability, detailed exposure, derived risk) are not in MapX and will need to be ingested.
3. **Data inventory** -- William to provide a structured list: (a) GRI layers to clone, (b) metrics layers available now, (c) layers expected within 6-8 weeks. Organised by tab.
4. **GRI delta-analysis** -- Programme team to document what GRI does that they don't want replicated and what they want differently or additionally.
5. **GAR vs GRI source data** -- MapX hazard data comes from GAR/PREVIEW; GRI uses WRI Aqueduct and other academic sources. Decision needed: use what MapX already has (faster to ship) or upload GRI's original data (exact parity with GRI Risk Viewer). See [crosswalk](research/gri-mapx-crosswalk.csv).
6. **Full MapX catalogue probe** -- The MapX REST API requires authentication. Use the SDK probe script (`scripts/probe-mapx-views.js`) to dump all views from the Eco-DRR (85 views) and HOME (22 views) projects. A session with Pierre would also help surface layers we missed.

## Blockers

| Blocker | Owner | Risk |
|---|---|---|
| MapX commercial/partnership terms clarified | Ken + Pierre | Medium |
| Data list confirmed and layers uploaded to MapX | William | Medium |
| Andrea's upgraded GRI/CRI layers available | Andrea / William | Low |

## Timeline

| Phase | Period | Activities |
|---|---|---|
| Discovery | Now - mid-April 2026 | Formalise MapX terms, compile data inventory, agree tab structure, initial demo |
| Build | Now - mid-May 2026 | Clone GRI UX, ingest confirmed layers, wire up country page links, metadata panels |
| Soft launch | End of May 2026 | London Climate Week fundraising/investor forums |
