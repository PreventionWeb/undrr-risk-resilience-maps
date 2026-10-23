/** Explicitly reviewed custom views; mutable upstream JavaScript is never executed. */
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
