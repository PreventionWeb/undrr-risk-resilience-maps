/**
 * Loader for Mangrove's vanilla tabs behaviour.
 *
 * `js/tabs.js` is a self-contained ES module that auto-initialises every
 * `[data-mg-js-tabs]` container on DOMContentLoaded. Our info panels are built
 * from JavaScript after that event, so the auto-init never sees them and we
 * have to call `mgTabs()` ourselves once the markup is in the document.
 *
 * The script is fetched from the CDN rather than bundled so it stays in step
 * with the stylesheet. Keep MANGROVE_VERSION aligned with the `<link>` in
 * index.html.
 *
 * Enhancement is optional: the authored markup renders every panel in sequence
 * without it, so a load failure degrades to the pre-tabs layout rather than
 * hiding content.
 */

const MANGROVE_VERSION = "2.0.0-beta.3";
const TABS_MODULE_URL = `https://assets.undrr.org/mangrove/${MANGROVE_VERSION}/js/tabs.js`;

let modulePromise = null;

/**
 * Initialise Mangrove tabs within `scope`. Resolves to true when the behaviour
 * was applied, false when the module could not be loaded.
 */
export async function initMangroveTabs(scope = document, { importImpl } = {}) {
  try {
    // Only the real CDN import is memoised. An injected loader is per-call, so
    // tests (and any future caller passing its own loader) are not served a
    // module cached by an earlier call.
    let mod;
    if (importImpl) {
      mod = await importImpl();
    } else {
      modulePromise ??= import(/* @vite-ignore */ TABS_MODULE_URL);
      try {
        mod = await modulePromise;
      } catch (err) {
        modulePromise = null;
        throw err;
      }
    }
    if (typeof mod?.mgTabs !== "function") return false;
    mod.mgTabs(scope);
    return true;
  } catch {
    return false;
  }
}

export { TABS_MODULE_URL };
