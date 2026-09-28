/**
 * MapX project IDs.
 *
 * Each project is a separate workspace in MapX with its own set of views.
 * The SDK connects to one project at a time. Public views from other
 * projects still load with `view_add` and appear in `get_views` (checked
 * on MapX 1.14.0-fix.1, 2026-09-28), but MapX doesn't document this.
 * MapX upstream: TBD (issue: embedders depend on these behaviours, item 1)
 * asks MapX to treat it as supported.
 */
export const ECO_DRR = "MX-2LD-FBB-58N-ROK-8RH";
export const HOME = "MX-YBJ-YYF-08R-UUR-QW6";
export const CDC = "MX-CDC-CTV-4PZ-VQD-OZ3";
export const UNDRR = "MX-FC7-VJG-IKU-MCA-QXM";

/** Human-readable display names for MapX project IDs. */
export const PROJECT_LABELS = {
  [ECO_DRR]: "ECO-DRR (UNEP/GRID-Geneva)",
  [HOME]: "MapX HOME project",
  [CDC]: "MapX CDC project",
  [UNDRR]: "UNDRR project",
};
