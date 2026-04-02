# GRI Risk Viewer — UX & Interaction Model Analysis

> Reference analysis of the [GRI Risk Viewer](https://global.infrastructureresilience.org) interaction patterns. This documents the application structure we aim to replicate (reskinned with UNDRR Mangrove styling). This is not a design spec — it's an inventory of what the GRI Risk Viewer does so we can scope what to build.
>
> Used by [PRD.md](../PRD.md) and [ARCHITECTURE.md](../ARCHITECTURE.md).

## Page structure

### Global navigation (top bar)

```
[GRI Risk Viewer]  Hazard  Exposure  Vulnerability  Risk  Adaptation  |  About  Guide  Articles  Sources  Downloads
```

- **Left group:** logo + 5 data tabs (each is a route: `/view/hazard`, `/view/exposure`, etc.)
- **Separator** between data tabs and info pages
- **Right group:** static content pages (About, Guide, Articles, Sources, Downloads)
- Active tab is visually highlighted

### Landing page (`/`)

- Hero section with title, description paragraphs explaining the IPCC risk framework
- 4 category cards (Hazard, Exposure, Vulnerability, Risk) — each with icon, description, and link to its tab
- "Explore the data" CTA linking to `/view/hazard`
- Credits section (Oxford OPSIS)
- Footer with links to About, Terms, Data Sources, GitHub, OPSIS

### Map view pages (`/view/<tab>`)

Two-column layout:

```
┌─────────────────────────────────────────────────────────┐
│  Top nav bar                                            │
├──────────────┬──────────────────────────────────────────┤
│  Sidebar     │  Map (full height)                       │
│  (scrollable)│                                          │
│              │  ┌─────┐                                 │
│  [Tab layers]│  │Tools│  (search, basemap, inspect)     │
│              │  └─────┘                                 │
│              │                                          │
│  [Other tabs]│                         ┌──────────────┐ │
│  (collapsed) │                         │  Legend(s)    │ │
│              │                         └──────────────┘ │
├──────────────┴──────────────────────────────────────────┤
│  Footer                                                 │
└─────────────────────────────────────────────────────────┘
```

## Sidebar structure

### Tab categories

Each tab has a primary category section (expanded) plus the other tabs shown collapsed at the bottom. This means **all tab categories are accessible from any tab** without navigating away — they're accordion-collapsed in the sidebar.

Example on the Risk tab:
- **Risk** (expanded, primary) — contains layer accordions
- **Hazards** (collapsed) — can expand inline
- **Exposure** (collapsed)
- **Vulnerability** (collapsed)

Each category heading has a **show/hide layer** eye icon toggle.

### Layer accordions

Each layer within a category is an accordion:

```
▶ Layer Name                              👁 [show/hide]
```

When expanded:

```
▼ Layer Name                              👁 [hide]
  ┌─────────────────────────────────────────────┐
  │ Description text about the data source      │
  │                                             │
  │ [Control widgets — vary by layer type]      │
  └─────────────────────────────────────────────┘
```

### Layer control widget types

Different layers have different controls. Observed patterns:

#### 1. Data source toggle + slider + dropdowns (Hazard layers)
Example: **River Flooding**
- **Data source toggle:** `[Aqueduct] [JRC]` — button group switching between data providers
- **Description:** "Map shows river flooding depths for different return periods, from WRI Aqueduct (2020)."
- **Return Period slider:** discrete steps `2  5  10  25  50  100  250  500  1000`
- **Epoch dropdown:** Present / Future
- **RCP dropdown:** Baseline / 4.5 / 8.5
- **GCM dropdown:** WATCH / various climate models

#### 2. Category dropdown (Exposure layers)
Example: **Buildings**
- **Description:** data source + year
- **Dropdown:** All / Non-residential / Industry / etc.

#### 3. Multi-dropdown with linked hazard (Risk layers)
Example: **Infrastructure Risk**
- **Description:** explains vulnerability assumptions
- **Sector dropdown:** Roads / Rails / Power
- **Hazard dropdown:** auto-linked based on sector (disabled when only one option)
- **Epoch dropdown:** Present / Future
- **RCP dropdown:** Baseline / 4.5 / 8.5
- **Hazard layer toggle switch:** shows/hides the underlying hazard layer

#### 4. Multi-dropdown (Adaptation layers)
Example: **Nature-Based Solutions**
- **Description** (with **preliminary** bold warning)
- **Adaptation type dropdown:** e.g. Slope vegetation (natural regeneration)
- **Geographic scope dropdown:** Country / Region
- **Color by dropdown:** Baseline EAD (mean) etc.
- **Hazard dropdown:** auto-linked (disabled)

#### 5. Nested sub-groups (Vulnerability)
Example: **Vulnerability** tab contains two sub-groups:
- **People** (expanded) — Human Development (Subnational), Human Development (Grid), Relative Wealth Index, Travel Time to Healthcare
- **Planet** (expanded) — Biodiversity Intactness, Forest Landscape Integrity, Protected Areas (WDPA)

#### 6. Disabled layers
Example: **Wildfires** — greyed out, no show/hide toggle, signalling "coming soon" or unavailable data.

## Map area

### Map controls (floating toolbar, top-left of map)
- **Search** (magnifying glass) — location search
- **Layer switcher** (stacked squares) — toggle layer visibility
- **Site inspection tool** (crosshair) — toggles feature inspection mode

### Map controls (top-right)
- **Zoom in / Zoom out** (+/-)

### Legend (bottom-right of map)
- Displays when layers are active
- Shows layer title + colour ramp + value range
- **Multiple legends stack vertically** when multiple layers are visible (e.g. hazard + damage on Risk tab)
- Separator between legends

### Basemap toggle
- Switches between light vector map and satellite imagery
- Attribution bar at bottom: CARTO, OpenStreetMap, Sentinel-2

## Site inspection (feature click)

Activated via the crosshair button. Shows a prompt: "Click on the map to see details for a location."

### Site Details panel (right side)
On click:
```
┌──────────────────────────────────────────┐
│ Site Details                    ⬇  ✕     │
│ Coordinates: 20.000000, -40.000000  📋   │
│                                          │
│ ⓘ This site inspection tool is a        │
│   work-in-progress. Please contact us    │
│   or report an issue.                    │
│                                          │
│ River Flooding (Aqueduct)         ○  ▾   │
│ River Flooding (JRC)              ○  ▾   │
│ Coastal Flooding (Aqueduct)       ○  ▾   │
│ Tropical Cyclones (IRIS)          🟢 ▾   │
│ Tropical Cyclones (STORM)         🟢 ▾   │
│ Extreme Heat                      ○  ▾   │
│ Droughts                          ○  ▾   │
│ Earthquakes                       ○  ▾   │
└──────────────────────────────────────────┘
```

- **Header:** "Site Details" with download and close buttons
- **Coordinates:** with copy-to-clipboard button
- **Per-hazard rows:** each hazard listed with a risk indicator dot (green = data, grey = no data) and expandable chevron
- Disabled rows when no data at that location
- **Download site data package** button (exports data for that point)
- Map places a **crosshair marker** at the clicked location

## URL routing & state encoding

Layer state is encoded in URL query parameters:

```
/view/hazard?y=20&x=-40&z=3&sections={...}
```

- `x`, `y`, `z` — map center and zoom
- `sections` — JSON object encoding which layers/sub-layers are active
- `site` — coordinates when site inspection is active (e.g. `"20.000000,-40.000000"`)

This enables **deep-linking to specific map states** — shareable URLs that reproduce exact layer configurations.

Example:
```
/view/risk?sections={"hazards":{"fluvial":{"aqueduct":true}},"risk":{"infrastructure":true},"exposure":{"infrastructure":true}}
```

## Cross-tab layer persistence

Notably, when activating layers and switching tabs:
- **Other tab categories remain accessible** as collapsed sections at the bottom of the sidebar
- Toggling a layer in a collapsed section activates it without navigating to that tab
- URL `sections` object can contain keys for multiple categories simultaneously

## Static content pages

| Page | Route | Purpose |
|---|---|---|
| About | `/about` | Project description, team credits |
| Guide | `/guide` | How to use the viewer |
| Articles | `/articles` | Research articles and publications |
| Sources | `/data` | Per-category data source documentation with links |
| Downloads | `/downloads` | Data download links |

The **Sources** page is particularly relevant — it lists every data source grouped by category (Contextual, Hazard, Exposure, Vulnerability, Risk, Adaptation) with full attribution, links to original data, and citation information.

## UX patterns to replicate

1. Accordion sidebar: category, then layer, then controls
2. Per-layer control widgets (sliders, dropdowns, toggles) matched to each layer's data dimensions
3. Show/hide eye toggle on every layer and category heading
4. Floating legend that updates as layers change; stacks when multiple layers are active
5. Site inspection mode: toggle on, click map, get per-hazard data in a side panel
6. URL state encoding so layer configurations are deep-linkable
7. Cross-tab access: other categories are collapsed in the sidebar but still expandable without switching tabs
8. Disabled/coming-soon layers greyed out in the list
9. Linked dropdowns where some controls auto-set based on others (e.g. hazard type locked by sector choice)
10. Basemap toggle between vector and satellite
