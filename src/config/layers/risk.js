import { ECO_DRR } from "./projects.js";

const AWAITING = "disabled-awaiting-data";
const SOURCE_TBC = "Source to be confirmed.";
const CITATION_TBC = "Source to be confirmed.";
const LICENSE_TBC = "TBD";
const NOTE_PENDING = "Awaiting data — MapX view not yet available.";

const CDRI_SOURCE = "Coalition for Disaster Resilient Infrastructure (CDRI)";
const CDRI_CITATION =
  "Coalition for Disaster Resilient Infrastructure. (2026). Global Infrastructure Resilience: Capturing the resilience dividend. New Delhi: CDRI.";
const CDRI_LICENSE =
  "CC BY 3.0 IGO. Source data derived from the Global Infrastructure Risk Model and Resilience Index (GIRI), commissioned by CDRI. Processed by UNDRR for the Risk to Resilience Metrics initiative.";
const RECOVERY_SOURCE =
  "World Bank Unbreakable / Global Socio-Economic Resilience to Natural Disasters data. Indicator calculated and processed by UNDRR for the Risk to Resilience Metrics initiative.";
const RECOVERY_CITATION =
  "Middelanis, R.; Jafino, B. A.; Hill, R.; Nguyen, M. C.; Hallegatte, S. 2025. Reproducibility package for Global Socio-Economic Resilience To Natural Disasters. World Bank Reproducible Research Repository.";
const RECOVERY_LICENSE =
  "Modified BSD 3-Clause. Source data derived from the World Bank Reproducibility Package for Global Socio-Economic Resilience To Natural Disasters. Indicator calculated and processed by UNDRR.";

const STEP_LINK = "LINK TO YOUR ECONOMIC AND SOCIAL EXPOSURE";
const STEP_PRIORITIZE = "PRIORITIZE CURRENT AND FUTURE INVESTMENT";

export const RISK_LAYERS = [
  {
    id: null,
    key: "multiple-hazards",
    label: "Multiple Hazards",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-impact-of-multiple-hazards",
    type: "vt",
    geometry: "point",
    desc: "Estimates how multiple hazards or shocks could jointly affect people, assets, services or welfare, highlighting risks that may be underestimated when shocks are assessed separately",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Impact of multiple hazards",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Proposed assessment of the combined effects of multiple hazards on people, assets, services or household well-being.",
  },
  {
    id: null,
    key: "years-lost",
    label: "Life year lost",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-life-years-lost-due-to-disasters",
    type: "vt",
    geometry: "point",
    desc: "Estimates the potential loss of human life and remaining life expectancy associated with disaster impacts, helping show how risk affects people across generations",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Life years lost due to disasters",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Proposed estimate of the remaining years of life lost to premature disaster-related deaths. UNDRR and WHO are developing the methodology.",
  },
  {
    id: null,
    key: "recovery-speed",
    label: "Recovery Speed",
    type: "vt",
    geometry: "point",
    desc: "Recovery speed of consumption levels after a 1:100 event, by income group and hazard type.",
    source: RECOVERY_SOURCE,
    citation: RECOVERY_CITATION,
    license: RECOVERY_LICENSE,
    project: ECO_DRR,
    initiative: "Recovery speed of top/bottom income groups from a 1-in-100 year event",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-VCP83-3E2TG-PJWFJ",
        label: "Poorest: Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year earthquake for households in the lowest income quintile within each country.",
        csvDownload: "yes",
        desc: "Poorest households - 1:100 earthquake event.",
      },
      {
        id: "MX-YBWIB-YLHIV-WKG2H",
        label: "Poorest: Flood",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year flood for households in the lowest income quintile within each country.",
        csvDownload: "yes",
        desc: "Poorest households - 1:100 flood event.",
      },
      {
        id: "MX-RTJQZ-WHX2B-SI4HB",
        label: "Poorest: Storm",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year storm for households in the lowest income quintile within each country.",
        csvDownload: "yes",
        desc: "Poorest households - 1:100 storm event.",
      },
      {
        id: "MX-DMKUU-PAPIT-W4EMP",
        label: "Poorest: Tsunami",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year tsunami for households in the lowest income quintile within each country.",
        csvDownload: "yes",
        desc: "Poorest households - 1:100 tsunami event.",
      },
      {
        id: "MX-HHA9G-4VUF9-CREXQ",
        label: "Richest: Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year earthquake for households in the highest income quintile within each country.",
        csvDownload: "yes",
        desc: "Richest households - 1:100 earthquake event.",
      },
      {
        id: "MX-MDFMH-34XOD-EU9HN",
        label: "Richest: Flood",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year flood for households in the highest income quintile within each country.",
        csvDownload: "yes",
        desc: "Richest households -  1:100 flood event.",
      },
      {
        id: "MX-PZYN0-UQZTF-J6I8N",
        label: "Richest: Storm",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year storm for households in the highest income quintile within each country.",
        csvDownload: "yes",
        desc: "Richest households -  1:100 storm event.",
      },
      {
        id: "MX-O4I9O-FHOJD-EHNNA",
        label: "Richest: Tsunami",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-recovery-speed-of-top-bottom-income-groups-from-a-1-in-100-year-event",
        note: "Shows modelled consumption recovery after a 1-in-100-year tsunami for households in the highest income quintile within each country.",
        csvDownload: "yes",
        desc: "Richest households -  1:100 tsunami event.",
      },
    ],
    widget: { type: "sub-tabs", label: "Hazard" },
  },
  {
    id: null,
    key: "aal-public",
    label: "AAL to Public Assets",
    type: "vt",
    geometry: "point",
    desc: "Average annual loss for public assets under current and future climate scenarios.",
    source: CDRI_SOURCE,
    citation: CDRI_CITATION,
    license: CDRI_LICENSE,
    project: ECO_DRR,
    initiative: "AAL to public infrastructure",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-443WM-S89FY-2ANCD",
        label: "Current",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Shows the expected direct disaster loss per year to public assets covered by the model under current climate conditions.",
        csvDownload: "yes",
        desc: "AAL for public assets under current climate.",
      },
      {
        id: "MX-6HW4M-X4PAM-WH46T",
        label: "RCP 2.6",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Shows the expected direct disaster loss per year to public assets covered by the model under the RCP 2.6 climate scenario.",
        csvDownload: "yes",
        desc: "AAL for public assets under RCP 2.6.",
      },
      {
        id: "MX-QLZI0-AXK6X-8OAN7",
        label: "RCP 8.5",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Shows the expected direct disaster loss per year to public assets covered by the model under the RCP 8.5 climate scenario.",
        csvDownload: "yes",
        desc: "AAL for public assets under RCP 8.5.",
      },
    ],
    widget: { type: "stepped-slider", label: "Climate scenario" },
  },
  {
    id: null,
    key: "pml-public",
    label: "PML to Public Assets",
    type: "vt",
    geometry: "point",
    desc: "Direct probable maximum losses to public infrastructure, by hazard.",
    source: CDRI_SOURCE,
    citation: CDRI_CITATION,
    license: CDRI_LICENSE,
    project: ECO_DRR,
    initiative: "Direct Probable Maximum Losses to public infrastructure",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "In development — MapX views are present but not yet approved for publication.",
    sources: [
      {
        id: "MX-2V1JX-EV4WL-AQKZV",
        label: "Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Modelled direct earthquake losses to public infrastructure at a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML to public infrastructure - Earthquake",
      },
      {
        id: "MX-241F9-QO6FA-T9BU6",
        label: "Flood",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Modelled direct flood losses to public infrastructure at a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML to public infrastructure - Flood",
      },
      {
        id: "MX-T29Z1-M34D1-JUOCG",
        label: "Storm",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Modelled direct storm losses to public infrastructure at a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML to public infrastructure - Storm",
      },
      {
        id: "MX-IW2XA-WEITA-ROOG4",
        label: "Tsunami",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-losses-to-public-infrastructure",
        note: "Modelled direct tsunami losses to public infrastructure at a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML to public infrastructure - Tsunami",
      },
    ],
    widget: { type: "sub-tabs", label: "Hazard" },
  },
  {
    id: null,
    key: "aal-crops",
    label: "AAL to Crops",
    type: "vt",
    geometry: "point",
    desc: "Average annual loss for crops.",
    source: "UNDRR, JRC and CIMA Foundation",
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "AAL crops",
    r2rCategory: "Environment",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: NOTE_PENDING,
    sources: [
      {
        id: null,
        label: "Wheat",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-crop-losses-from-drought-4-key-crops",
        note: "Long-term average annual wheat production loss due to drought.",
        desc: "Average annual loss for crops.",
      },
      {
        id: null,
        label: "Maize",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-crop-losses-from-drought-4-key-crops",
        note: "Long-term average annual maize production loss due to drought.",
        desc: "Average annual loss for crops.",
      },
      {
        id: null,
        label: "Rice",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-crop-losses-from-drought-4-key-crops",
        note: "Long-term average annual rice production loss due to drought.",
        desc: "Average annual loss for crops.",
      },
      {
        id: null,
        label: "Soybean",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-average-annual-crop-losses-from-drought-4-key-crops",
        note: "Long-term average annual soybean production loss due to drought.",
        desc: "Average annual loss for crops.",
      },
    ],
    widget: { type: "sub-tabs", label: "Crop" },
  },
  {
    id: null,
    key: "pml-crops",
    label: "PML to Crops",
    type: "vt",
    geometry: "point",
    desc: "Probable maximum loss for crops.",
    source: "UNDRR, JRC and CIMA Foundation",
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "PML crops",
    r2rCategory: "Environment",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: NOTE_PENDING,
    sources: [
      {
        id: null,
        label: "Wheat",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-probable-maximum-crop-losses-from-drought-4-key-crops",
        note: "Modelled wheat production loss due to drought at a specified return period.",
        desc: "Probable maximum loss for crops.",
      },
      {
        id: null,
        label: "Maize",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-probable-maximum-crop-losses-from-drought-4-key-crops",
        note: "Modelled maize production loss due to drought at a specified return period.",
        desc: "Probable maximum loss for crops.",
      },
      {
        id: null,
        label: "Rice",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-probable-maximum-crop-losses-from-drought-4-key-crops",
        note: "Modelled rice production loss due to drought at a specified return period.",
        desc: "Probable maximum loss for crops.",
      },
      {
        id: null,
        label: "Soybean",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-direct-probable-maximum-crop-losses-from-drought-4-key-crops",
        note: "Modelled soybean production loss due to drought at a specified return period.",
        desc: "Probable maximum loss for crops.",
      },
    ],
    widget: { type: "sub-tabs", label: "Crop" },
  },
  {
    id: null,
    key: "aal-pml-housing",
    label: "Losses to housing",
    type: "vt",
    geometry: "point",
    desc: "Average annual loss and probable maximum loss for housing stock under current and future climate scenarios.",
    source: CDRI_SOURCE,
    citation: CDRI_CITATION,
    license: CDRI_LICENSE,
    project: ECO_DRR,
    initiative: "AAL/PML housing",
    r2rCategory: "Societies",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-YP5S0-VBMJK-R7IMX",
        label: "AAL Current",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the expected direct disaster loss per year to modelled housing stock under current climate conditions.",
        csvDownload: "yes",
        desc: "AAL for housing under current climate.",
      },
      {
        id: "MX-MKE3F-AONM0-27UM0",
        label: "AAL RCP 2.6",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the expected direct disaster loss per year to modelled housing stock under the RCP 2.6 climate scenario.",
        csvDownload: "yes",
        desc: "AAL for housing under RCP 2.6.",
      },
      {
        id: "MX-O1L8F-IKWHZ-VZTO7",
        label: "AAL RCP 8.5",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the expected direct disaster loss per year to modelled housing stock under the RCP 8.5 climate scenario.",
        csvDownload: "yes",
        desc: "AAL for housing under RCP 8.5.",
      },
      {
        id: "MX-ZA12C-TU5AH-L9K7P",
        label: "PML Current",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the modelled level of direct disaster loss to housing under current climate conditions, associated with a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML for housing under current climate.",
      },
      {
        id: "MX-XY8R2-9T29I-7235T",
        label: "PML RCP 2.6",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the modelled level of direct disaster loss to housing under the RCP 2.6 climate scenario, associated with a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML for housing under RCP 2.6.",
      },
      {
        id: "MX-VWYGB-7A6CV-QC1UG",
        label: "PML RCP 8.5",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-reduction-in-housing-losses-aal-pml",
        note: "Shows the modelled level of direct disaster loss to housing under the RCP 8.5 climate scenario, associated with a selected annual exceedance probability.",
        csvDownload: "yes",
        desc: "PML for housing under RCP 8.5.",
      },
    ],
    widget: { type: "sub-tabs", label: "Metric / Scenario" },
  },
  {
    id: "MX-FCU2W-1CCYO-NFZB9",
    key: "ecosystem-loss",
    label: "Losses to ecosystem",
    csvDownload: "yes",
    type: "vt",
    geometry: "point",
    desc: "Ecosystem loss resulting from disaster events.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Economic loss to ecosystem failure under current conditions",
    r2rCategory: "Environment",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Proposed measure of disaster-related ecosystem loss. The viewer leaves the loss indicator and unit unspecified.",
  },
  {
    id: null,
    key: "aal-to-gdp-2025",
    label: "AAL to GDP (2025)",
    type: "vt",
    geometry: "point",
    desc: "Average annual loss as a share of GDP (2025 baseline), by hazard.",
    source: CDRI_SOURCE,
    citation: CDRI_CITATION,
    license: CDRI_LICENSE,
    project: ECO_DRR,
    initiative: "Average Annual Losses of real GDP now and 2050",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-9NADN-CB8JT-WC1OD",
        label: "Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled average annual losses from earthquakes as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "AAL to GDP 2025 — earthquake.",
      },
      {
        id: "MX-Y0QE0-24K69-FKLY4",
        label: "Landslides",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled average annual losses from landslides as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "AAL to GDP 2025 — landslides.",
      },
      {
        id: "MX-1IW5U-0WB6E-23TWY",
        label: "Tropical Cyclones",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled average annual losses from tropical cyclones as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "AAL to GDP 2025 — tropical cyclones.",
      },
      {
        id: "MX-YYCOH-BJR17-AI5DC",
        label: "Floods",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled average annual losses from floods as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "AAL to GDP 2025 — floods.",
      },
      {
        id: "MX-GWI29-SUI19-JI9NK",
        label: "Tsunamis",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled average annual losses from tsunamis as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "AAL to GDP 2025 — tsunamis.",
      },
    ],
    widget: { type: "sub-tabs", label: "Hazard" },
  },
  {
    id: null,
    key: "pml-to-gdp-2025",
    label: "PML to GDP (2025)",
    type: "vt",
    geometry: "point",
    desc: "Probable maximum loss as a share of GDP (2025 baseline), by hazard.",
    source: CDRI_SOURCE,
    citation: CDRI_CITATION,
    license: CDRI_LICENSE,
    project: ECO_DRR,
    initiative: "Probable Maximum Losses of real GDP",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-D7PMU-PL88W-UYF2D",
        label: "Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-probable-maximum-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled losses from earthquakes at a selected annual exceedance probability, expressed as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "PML to GDP 2025 — earthquake.",
      },
      {
        id: "MX-AXEIH-GM2KV-TGOII",
        label: "Landslides",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-probable-maximum-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled losses from landslides at a selected annual exceedance probability, expressed as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "PML to GDP 2025 — landslides.",
      },
      {
        id: "MX-V0I12-3KA70-ZVMX9",
        label: "Tropical Cyclones",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-probable-maximum-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled losses from tropical cyclones at a selected annual exceedance probability, expressed as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "PML to GDP 2025 — tropical cyclones.",
      },
      {
        id: "MX-2C1U4-W0QF9-OQ7EO",
        label: "Floods",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-probable-maximum-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled losses from floods at a selected annual exceedance probability, expressed as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "PML to GDP 2025 — floods.",
      },
      {
        id: "MX-C7MNL-TEXT7-TN001",
        label: "Tsunamis",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-probable-maximum-losses-of-real-gdp-now-and-2050",
        note: "Shows modelled losses from tsunamis at a selected annual exceedance probability, expressed as a share of GDP in the 2025 baseline.",
        csvDownload: "yes",
        desc: "PML to GDP 2025 — tsunamis.",
      },
    ],
    widget: { type: "sub-tabs", label: "Hazard" },
  },
  {
    id: null,
    key: "current-fiscal-gap",
    label: "Fiscal Gap",
    type: "vt",
    geometry: "point",
    desc: "Current fiscal gap (cost of uninsured disaster losses) by hazard.",
    source: "IIASA",
    citation:
      'Hochrainer-Stigler, S., Mechler, R., Pflug, G., & Linnerooth-Bayer, J. (2014/2015). Funding practices and fiscal disaster risk management. Initial applications defining the "fiscal resource gap year event" metric as a measure of sovereign fiscal resilience',
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    project: ECO_DRR,
    initiative: "Chance of a disaster exceeding public financing capacity (Fiscal gap)",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    sources: [
      {
        id: "MX-X144T-FVH4D-CNILH",
        label: "Floods",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-chance-of-a-disaster-exceeding-public-financing-capacity-fiscal-gap",
        note: "Shows how often losses from floods could exceed available public financing. A shorter return period indicates a more frequent potential shortfall.",
        csvDownload: "yes",
        desc: "Current fiscal gap — floods.",
      },
      {
        id: "MX-6R1HD-1QCSB-CDRCP",
        label: "Landslides",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-chance-of-a-disaster-exceeding-public-financing-capacity-fiscal-gap",
        note: "Shows how often losses from landslides could exceed available public financing. A shorter return period indicates a more frequent potential shortfall.",
        csvDownload: "yes",
        desc: "Current fiscal gap — landslides.",
      },
      {
        id: "MX-VPWOT-F3J3E-N5CPW",
        label: "Tropical Cyclones",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-chance-of-a-disaster-exceeding-public-financing-capacity-fiscal-gap",
        note: "Shows how often losses from tropical cyclones could exceed available public financing. A shorter return period indicates a more frequent potential shortfall.",
        csvDownload: "yes",
        desc: "Current fiscal gap — tropical cyclones.",
      },
      {
        id: "MX-HH3SN-J2JQY-ZKSZV",
        label: "Earthquake",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-chance-of-a-disaster-exceeding-public-financing-capacity-fiscal-gap",
        note: "Shows how often losses from earthquakes could exceed available public financing. A shorter return period indicates a more frequent potential shortfall.",
        csvDownload: "yes",
        desc: "Current fiscal gap — earthquake.",
      },
      {
        id: "MX-I91L8-9WESU-ZXA05",
        label: "Tsunamis",
        explainerUrl:
          "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-chance-of-a-disaster-exceeding-public-financing-capacity-fiscal-gap",
        note: "Shows how often losses from tsunamis could exceed available public financing. A shorter return period indicates a more frequent potential shortfall.",
        csvDownload: "yes",
        desc: "Current fiscal gap — tsunamis.",
      },
    ],
    widget: { type: "sub-tabs", label: "Hazard" },
  },
  {
    id: null,
    key: "cost-supply-chain-disruption",
    label: "Supply Chain Disruption",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-annual-direct-economic-cost-of-supply-chain-disruption",
    type: "vt",
    geometry: "point",
    desc: "Economic cost of disaster-induced supply chain disruption.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Cost of supply chain disruption",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Proposed estimate of the economic cost of disaster-related supply chain disruption, including impacts beyond the directly affected area or sector.",
  },
  {
    id: null,
    key: "bank-solvency-capital-adequacy",
    label: "Bank Solvency / Capital Adequacy",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-improvement-to-bank-solvency-in-case-of-an-extreme-event",
    type: "vt",
    geometry: "point",
    desc: "Bank solvency in an AAL year and capital adequacy indicators.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Bank solvency in an AAL year / capital adequacy",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Assessment of banks’ ability to absorb losses and maintain adequate capital in a scenario at the average annual loss (AAL) level.",
  },
  {
    id: null,
    key: "sovereign-debt-stress-test",
    label: "Sovereign Debt Stress Test",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-avoided-sovereign-debt-increase-in-case-of-an-extreme-event",
    type: "vt",
    geometry: "point",
    desc: "Sovereign debt due to an AAL event (stress test).",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Sovereign debt due to AAL event (Stress test)",
    r2rCategory: "Economy",
    rrStep: STEP_LINK,
    status: AWAITING,
    note: "Stress test of government debt under a disaster scenario at the average annual loss (AAL) level.",
  },
  {
    id: null,
    key: "drr-financing-per-gdp",
    label: "DRR / Resilience Financing (% of GDP)",
    type: "vt",
    geometry: "point",
    desc: "Percentage of DRR and resilience financing as a share of GDP.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Percentage of DRR/ resilience financing per GDP",
    r2rCategory: "Economy",
    rrStep: STEP_PRIORITIZE,
    status: AWAITING,
    note: "Spending on disaster risk reduction and resilience as a share of GDP.",
  },
  {
    id: null,
    key: "humanitarian-vs-prevention-expenditure",
    label: "Humanitarian vs. Prevention Expenditure",
    explainerUrl:
      "https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology#metric-average-expenditure-on-humanitarian-relief",
    type: "vt",
    geometry: "point",
    desc: "Average expenditure on humanitarian relief compared to anticipatory action and prevention.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    initiative: "Average expenditure on humanitarian relief as compared to AA/ prevention",
    r2rCategory: "Economy",
    rrStep: STEP_PRIORITIZE,
    status: AWAITING,
    note: "Comparison of average spending on humanitarian relief, anticipatory action and prevention.",
  },
];
