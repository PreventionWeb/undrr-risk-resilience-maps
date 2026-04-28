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
    type: "rt",
    desc: "Well-being impacts of disaster risk, with and without adaptation measures.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    status: AWAITING,
    note: NOTE_ID_TBC,
    sources: [
      { id: null, label: "Assets w/o adaptation",   desc: "Asset value without adaptation measures." },
      { id: null, label: "Assets w/ adaptation",     desc: "Asset value with adaptation measures." },
      { id: null, label: "Wellbeing w/o adaptation", desc: "Well-being index without adaptation measures." },
      { id: null, label: "Wellbeing w/ adaptation",  desc: "Well-being index with adaptation measures." },
      { id: null, label: "Change in assets",         desc: "Change in assets attributable to adaptation." },
      { id: null, label: "Change in wellbeing",      desc: "Change in well-being attributable to adaptation." },
    ],
    widget: { type: "sub-tabs", label: "Metric" },
  },
  {
    id: null,
    key: "change-fiscal-gap",
    label: "Change in Fiscal Gap",
    type: "rt",
    desc: "Change in fiscal gap with and without financial support under resilience interventions.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    status: AWAITING,
    note: NOTE_ID_TBC,
    sources: [
      { id: null, label: "With support",    desc: "Change in fiscal gap with financial support." },
      { id: null, label: "Without support", desc: "Change in fiscal gap without financial support." },
    ],
    widget: { type: "sub-tabs", label: "Scenario" },
  },
  {
    id: null,
    key: "adaptation",
    label: "Adaptation",
    type: "rt",
    desc: "Spatial distribution of adaptation measures and resilience interventions.",
    source: SOURCE_TBC,
    citation: CITATION_TBC,
    license: LICENSE_TBC,
    project: ECO_DRR,
    status: AWAITING,
    note: NOTE_PENDING,
  },
];
