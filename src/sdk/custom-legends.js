/**
 * MANUAL MAINTENANCE: these four custom-code legends are local definitions,
 * unlike vector/raster legends read from remote style metadata.
 * Changing remote data values alone does not invalidate them. Any change to
 * data.methods does: fail back to the MapX image until a maintainer reviews
 * the style and updates the definition AND its hash. Never just refresh a hash.
 * Upstream JavaScript is never executed. See docs/legends.md.
 */
import { CUSTOM_LEGENDS } from "./custom-legend-definitions.js";

export async function resolveCustomMapXLegend(view) {
  const reviewed = CUSTOM_LEGENDS[view?.id];
  const methods = view?.data?.methods;
  if (!reviewed || typeof methods !== "string" || !globalThis.crypto?.subtle) {
    return { legend: null, reason: "unsupported-view-type" };
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(methods));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== reviewed.methodsSha256) return { legend: null, reason: "custom-style" };
  return { legend: reviewed.legend, reason: null };
}
