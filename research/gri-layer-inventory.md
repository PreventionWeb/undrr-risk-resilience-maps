# GRI Risk Viewer — Layer Inventory

> All layers in the [GRI Risk Viewer](https://global.infrastructureresilience.org), catalogued from browser inspection and the [Data Sources](https://global.infrastructureresilience.org/data) page. This is the baseline we're replicating.
>
> Referenced by [PRD.md](../PRD.md) and [ARCHITECTURE.md](../ARCHITECTURE.md). See [gri-mapx-crosswalk.csv](gri-mapx-crosswalk.csv) for MapX availability and view IDs.

## Hazard layers

| Layer | Source dataset | Provider | License | Notes |
|---|---|---|---|---|
| River Flooding (Aqueduct) | WRI Aqueduct Floods Hazard Maps | World Resources Institute | CC BY 4.0 | Inundation depth (m), 1km grid. Return periods: 2-1000yr. Baseline + RCP 4.5/8.5, epochs 2030/2050/2080 |
| River Flooding (JRC) | JRC Global River Flood Hazard Maps | European Commission JRC | CC BY 4.0 | Inundation depth (m), return periods 10-500yr. LISFLOOD model |
| Coastal Flooding (Aqueduct) | WRI Aqueduct Floods Hazard Maps | World Resources Institute | CC BY 4.0 | Same source as river flooding, coastal component |
| Tropical Cyclones (STORM) | STORM Tropical Cyclone dataset | 4TU.ResearchData | CC0 1.0 | Max wind speed (m/s), return periods. Present + future (SSP) |
| Tropical Cyclones (IRIS) | IRIS Imperial College Storm Model | Imperial College London | CC BY 4.0 | Wind speeds, 1/10 degree resolution. Present + future (SSP) |
| Extreme Heat | Lange et al 2020, ISIMIP | ISIMIP | CC0 1.0 | Temperature/humidity indicators, 0.5° grid. 8 hydro models, RCP 2.6/6.0, epochs 2030/2050/2080 |
| Droughts | Lange et al 2020, ISIMIP | ISIMIP | CC0 1.0 | Soil moisture below 2.5th percentile threshold. Same model ensemble as extreme heat |
| Landslide | Global Landslide Hazard Map | Arup / World Bank / GFDRR | CC BY-NC 4.0 | Annual frequency of significant landslides per km². Rainfall-triggered + earthquake-triggered |
| Earthquakes | GEM Global Seismic Hazard Map | Global Earthquake Model | CC BY-NC-SA 4.0 | Peak Ground Acceleration (PGA), 10% probability of exceedance in 50yr |
| Wildfires | — | — | — | **Disabled / coming soon** in the viewer |

## Exposure layers

| Layer | Source dataset | Provider | License | Notes |
|---|---|---|---|---|
| Population | JRC Global Human Settlement Layer (GHS-POP) | European Commission JRC | CC BY 4.0 | Population distribution per cell, 1975-2020 + projections to 2030 |
| Buildings | JRC Global Human Settlement Layer (GHS-BUILT) | European Commission JRC | CC BY 4.0 | Built-up surface density 2020. Filterable: All / Non-residential / Industry |
| Infrastructure (Roads & Rail) | OpenStreetMap | OSM contributors | ODbL | Roads (trunk, motorway, primary, secondary, tertiary) + rail lines. Extract Oct 2021 |
| Infrastructure (Power — transmission) | Gridfinder | Source / OSM | CC BY 4.0 | Predicted distribution + transmission line network |
| Infrastructure (Power — plants) | WRI Global Powerplants Database | WRI / Google / KTH et al | CC BY 4.0 | ~35,000 power plants, 167 countries. Capacity, generation, fuel type |
| Industry | — | — | — | Details on Sources page (industrial facilities) |
| Healthcare | — | — | — | Healthcare facility locations |
| Land Cover | — | — | — | Land cover classification |
| Topography | — | — | — | Elevation / terrain |
| Soil Organic Carbon | — | — | — | Soil carbon content |

## Vulnerability layers

| Layer | Sub-group | Source dataset | Provider | License | Notes |
|---|---|---|---|---|---|
| Human Development (Subnational) | People | Global Data Lab Subnational HDI | Global Data Lab | — | Subnational Human Development Index |
| Human Development (Grid) | People | Gridded HDI | — | — | Gridded version of HDI |
| Relative Wealth Index | People | Meta Data for Good | Meta | — | Relative wealth estimates |
| Travel Time to Healthcare | People | — | — | — | Accessibility metric |
| Biodiversity Intactness | Planet | — | — | — | Biodiversity intactness index |
| Forest Landscape Integrity | Planet | — | — | — | Forest integrity measure |
| Protected Areas (WDPA) | Planet | World Database on Protected Areas | UNEP-WCMC / IUCN | — | Global protected area boundaries |

## Risk layers

| Layer | Source | Notes |
|---|---|---|
| Population Exposure | Derived (hazard × population) | Population exposed to each hazard type |
| Infrastructure Risk | Derived (hazard × infrastructure) | Direct damages to roads/rail/power. Sector + hazard dropdowns, epoch/RCP scenarios. Toggle to show underlying hazard layer |
| Regional Summary | Derived | Aggregated risk summaries by region |

## Adaptation layers

| Layer | Source | Notes |
|---|---|---|
| Nature-Based Solutions | Oxford / GCA | **Preliminary** results. NbS "opportunity areas" for infrastructure resilience. Controls: adaptation type, geographic scope, color-by metric, hazard type |

## Layer control patterns summary

| Pattern | Used by | Controls |
|---|---|---|
| Slider + multi-dropdown | River Flooding, Coastal Flooding | Return period slider, epoch/RCP/GCM dropdowns, data source toggle |
| Category dropdown | Buildings, Population | Single category filter dropdown |
| Multi-dropdown + hazard link | Infrastructure Risk | Sector, hazard (auto-linked), epoch, RCP, hazard layer toggle |
| Multi-dropdown | Nature-Based Solutions | Adaptation type, scope, color-by, hazard |
| Simple toggle only | Landslide, Earthquakes, most Vulnerability layers | Show/hide only, no additional controls |
| Nested sub-groups | Vulnerability | People / Planet groupings containing child layers |

## MapX availability

_See [gri-mapx-crosswalk.csv](gri-mapx-crosswalk.csv) for which of these are available in MapX, with view IDs where confirmed._
