/** Enhance supplied dataset citations, and release nested dialogs before replacing their markup. */
let modulePromise;

export async function initMangroveCitations(scope, { signal } = {}) {
  const citations = [...scope.querySelectorAll("[data-mg-cite-this]")];
  if (signal?.aborted || !citations.length) return false;
  let mod;
  try {
    modulePromise ??= import("../vendor/mangrove/cite-this.js").catch((error) => {
      modulePromise = null;
      throw error;
    });
    mod = await modulePromise;
    // Import auto-initializes document markup, even if this render was closed
    // while loading. Clean up only its captured elements, never a newer render.
    if (signal?.aborted) {
      mod.mgCiteThisDestroy(citations);
      return false;
    }
    mod.mgCiteThis(citations);
    signal?.addEventListener("abort", () => mod.mgCiteThisDestroy(citations), { once: true });
    return true;
  } catch {
    try {
      mod?.mgCiteThisDestroy?.(citations);
    } catch {
      // Preserve readable fallback text even after a partial initialization.
    }
    // Authored citation text remains selectable when CDN enhancement fails.
    return false;
  }
}
