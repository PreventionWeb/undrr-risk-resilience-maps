/**
 * Loader for Mangrove's vanilla tabs behaviour.
 *
 * `js/tabs.js` is a self-contained ES module that auto-initialises every
 * `[data-mg-js-tabs]` container on DOMContentLoaded. Our info panels are built
 * from JavaScript after that event, so the auto-init never sees them and we
 * have to call `mgTabs()` ourselves once the markup is in the document.
 *
 * `mgTabs()` adds window listeners (`resize` and `orientationchange` for
 * `data-mg-js-tabs-stack-on-mobile` containers, `hashchange`) and a
 * `document.fonts` `loadingdone` listener, which only `mgTabsDestroy(scope)`
 * removes. Both are exports of the 2.0.0 module
 * (`mgTabs(scope, activateDeepLinkOnLoad = true, options = {})`,
 * `mgTabsDestroy(scope = document, preserveState = false)`); the destroy call
 * is still guarded in case a later release drops it. 2.0.0 also accepts an
 * `{ signal }` option that destroys the sets it initialised; we keep calling
 * `mgTabsDestroy` ourselves so the wrapper works the same on any 2.0 release.
 *
 * The script is fetched from the CDN rather than bundled so it stays in step
 * with the stylesheet. Keep MANGROVE_VERSION aligned with the `<link>` in
 * index.html.
 *
 * Enhancement is optional: the authored markup renders every panel in sequence
 * without it, so a load failure degrades to the pre-tabs layout rather than
 * hiding content.
 */

const MANGROVE_VERSION = "2.0.0";
const TABS_MODULE_URL = `https://assets.undrr.org/mangrove/${MANGROVE_VERSION}/js/tabs.js`;

let modulePromise = null;

/**
 * Initialise Mangrove tabs within `scope`. Resolves to true when the behaviour
 * was applied, false when the module could not be loaded or `signal` aborted
 * first.
 * @param {ParentNode} [scope]
 * @param {object} [options]
 * @param {() => Promise<object>} [options.importImpl] - module loader (tests)
 * @param {AbortSignal} [options.signal] - aborting it calls `mgTabsDestroy(scope)`,
 *   so abort while the scope's containers are still in the document. If it
 *   aborts before the module has loaded, `mgTabs` is never called.
 */
export async function initMangroveTabs(scope = document, { importImpl, signal } = {}) {
  if (signal?.aborted) return false;
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
    if (signal?.aborted) return false;
    if (typeof mod?.mgTabs !== "function") return false;
    mod.mgTabs(scope);
    signal?.addEventListener(
      "abort",
      () => {
        try {
          mod.mgTabsDestroy?.(scope);
        } catch (err) {
          console.warn("Mangrove tabs could not be destroyed:", err);
        }
      },
      { once: true },
    );
    return true;
  } catch {
    return false;
  }
}

export { TABS_MODULE_URL };
