import { ECO_DRR } from "./projects.js";

const AWAITING = "disabled-awaiting-data";
const SOURCE_TBC = "Source to be confirmed.";
const CITATION_TBC = "Source to be confirmed.";
const LICENSE_TBC = "TBD";
const NOTE_ID_TBC = "MapX view exists; ID to be confirmed before enabling.";
const NOTE_PENDING = "Awaiting data — MapX view not yet available.";

export const RESILIENCE_LAYERS = [
  {
    id: null,
    key: "wellbeing",
    label: "Well-being",
    type: "vt",
    geometry: "point",
    desc: "Well-being impacts of disaster risk, with and without adaptation measures.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    sources: [
      { id: "MX-836KR-C0OWG-2OGU2", label: "Assets w/o adaptation",   desc: "Asset value without adaptation measures." },
      { id: "MX-NYKLB-MQNML-D4583", label: "Assets w/ adaptation",     desc: "Asset value with adaptation measures." },
      { id: "MX-G1G8E-MGLJL-Z9JEU", label: "Wellbeing w/o adaptation", desc: "Well-being index without adaptation measures." },
      { id: "MX-P8K9H-PUNT8-SEH10", label: "Wellbeing w/ adaptation",  desc: "Well-being index with adaptation measures." },
      { id: "MX-B5EX7-UCSAR-CQUNJ", label: "Change in assets",         desc: "Change in assets attributable to adaptation." },
      { id: "MX-3S4X6-9YXCI-MOI3L", label: "Change in wellbeing",      desc: "Change in well-being attributable to adaptation." },
    ],
    widget: { type: "sub-tabs", label: "Metric" },
  },
  {
    id: null,
    key: "change-fiscal-gap",
    label: "Change in Fiscal Gap",
    type: "vt",
    geometry: "point",
    desc: "Change in fiscal gap with and without financial support under resilience interventions.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    sources: [
      { id: "MX-WOHMT-WYKWK-X25K9", label: "With support",    desc: "Change in fiscal gap with financial support." },
      { id: "MX-5GL7W-40NYZ-T1IX1", label: "Without support", desc: "Change in fiscal gap without financial support." },
    ],
    widget: { type: "sub-tabs", label: "Scenario" },
  },
  {
    id: null,
    key: "adaptation",
    label: "Adaptation",
    type: "vt",
    geometry: "point",
    desc: "Spatial distribution of adaptation measures and resilience interventions.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    status: AWAITING,
    note: NOTE_PENDING,
  },
];
