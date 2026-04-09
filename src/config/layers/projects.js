/**
 * MapX project IDs.
 *
 * Each project is a separate workspace in MapX with its own set of views.
 * The SDK connects to one project at a time; cross-project view loading
 * is not currently supported.
 */
export const ECO_DRR = "MX-2LD-FBB-58N-ROK-8RH";
export const HOME = "MX-YBJ-YYF-08R-UUR-QW6";
export const CDC = "MX-CDC-CTV-4PZ-VQD-OZ3";

/** Human-readable display names for MapX project IDs. */
export const PROJECT_LABELS = {
  [ECO_DRR]: "ECO-DRR (UNEP/GRID-Geneva)",
  [HOME]: "MapX HOME project",
  [CDC]: "MapX CDC project",
};
