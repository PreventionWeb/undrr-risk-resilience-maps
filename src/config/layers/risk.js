import { ECO_DRR } from "./projects.js";

const RISK_CITATION = "Derived composite layer. See component hazard and exposure layer citations.";
const RISK_LICENSE = "Derived (see component layers)";

export const RISK_LAYERS = [
  {
    // TODO: replace with a composite risk view ID once available in MapX.
    // These IDs are currently shared with hazard exposure sources, which
    // corrupts toggle state. Disabled until dedicated risk views exist.
    id: null,
    key: "risk-river-flood",
    label: "River Flood Exposure",
    type: "rt",
    desc: "Annual physical exposure to river floods.",
    source: "Derived from hazard and exposure layers (GAR/PREVIEW).",
    sourceUrl: "https://unepgrid.ch/en/activity/1BDE1705",
    citation: RISK_CITATION,
    license: RISK_LICENSE,
    note: "Disabled — dedicated risk view ID not yet available in MapX; current ID conflicts with hazard layer.",
    project: ECO_DRR,
    disabled: true,
  },
  {
    id: null,
    key: "risk-cyclone",
    label: "Cyclone Exposure",
    type: "rt",
    desc: "Annual physical exposure to tropical cyclones.",
    source: "Derived from hazard and exposure layers (GAR/PREVIEW).",
    sourceUrl: "https://unepgrid.ch/en/activity/1BDE1705",
    citation: RISK_CITATION,
    license: RISK_LICENSE,
    note: "Disabled — dedicated risk view ID not yet available in MapX; current ID conflicts with hazard layer.",
    project: ECO_DRR,
    disabled: true,
  },
  {
    id: null,
    key: "risk-landslide",
    label: "Landslide Exposure",
    type: "rt",
    desc: "Annual physical exposure to landslides.",
    source: "Derived from hazard and exposure layers (GAR/PREVIEW).",
    sourceUrl: "https://unepgrid.ch/en/activity/1BDE1705",
    citation: RISK_CITATION,
    license: RISK_LICENSE,
    note: "Disabled — dedicated risk view ID not yet available in MapX; current ID conflicts with hazard layer.",
    project: ECO_DRR,
    disabled: true,
  },
];

