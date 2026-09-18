/**
 * Loader for Mangrove's vanilla copy-button behaviour.
 *
 * `js/copy-button.js` is a self-contained ES module. Importing it runs
 * `mgCopyButton()` over the whole document once (on DOMContentLoaded if the
 * document is still parsing), so markup that is already in the page is wired up
 * for free. The site inspector builds its copy button from JavaScript, long
 * after that, so we call `mgCopyButton(scope)` ourselves with the scope the
 * button is in. The module marks each button it has seen with
 * `data-mg-copy-button-initialized`, so calling it again over the same scope is
 * a no-op.
 *
 * The 2.0.0-rc.2 module's only export is `mgCopyButton(scope)`: there is no
 * destroy, and nothing to undo globally -- the one listener it adds is a
 * `click` on the button element itself, so it is collected with the markup
 * whenever the caller replaces it. `signal` therefore covers the part that can
 * outlive its markup: aborting it before the module resolves means
 * `mgCopyButton` is never called on a scope that is already stale. The abort
 * still calls a destroy export if a later release adds one, the same way
 * mangrove-tabs.js guards `mgTabsDestroy`.
 *
 * The script is fetched from the CDN rather than bundled so it stays in step
 * with the stylesheet. Keep MANGROVE_VERSION aligned with the `<link>` in
 * index.html and with mangrove-tabs.js.
 *
 * Enhancement is optional: the authored markup is an ordinary button, so a
 * load failure leaves an inert control rather than a broken panel.
 */

const MANGROVE_VERSION = "2.0.0-rc.2";
const COPY_BUTTON_MODULE_URL = `https://assets.undrr.org/mangrove/${MANGROVE_VERSION}/js/copy-button.js`;

let modulePromise = null;

/**
 * Wire up every `[data-mg-copy-button]` within `scope`. Resolves to true when
 * the behaviour was applied, false when the module could not be loaded or
 * `signal` aborted first.
 * @param {ParentNode} [scope]
 * @param {object} [options]
 * @param {() => Promise<object>} [options.importImpl] - module loader (tests)
 * @param {AbortSignal} [options.signal] - aborting it before the module
 *   resolves skips initialisation; afterwards it calls a destroy export if the
 *   module has one.
 */
export async function initMangroveCopyButtons(scope = document, { importImpl, signal } = {}) {
  if (signal?.aborted) return false;
  try {
    // Only the real CDN import is memoised. An injected loader is per-call, so
    // tests (and any future caller passing its own loader) are not served a
    // module cached by an earlier call.
    let mod;
    if (importImpl) {
      mod = await importImpl();
    } else {
      modulePromise ??= import(/* @vite-ignore */ COPY_BUTTON_MODULE_URL);
      try {
        mod = await modulePromise;
      } catch (err) {
        modulePromise = null;
        throw err;
      }
    }
    if (signal?.aborted) return false;
    if (typeof mod?.mgCopyButton !== "function") return false;
    mod.mgCopyButton(scope);
    signal?.addEventListener(
      "abort",
      () => {
        try {
          mod.mgCopyButtonDestroy?.(scope);
        } catch (err) {
          console.warn("Mangrove copy button could not be destroyed:", err);
        }
      },
      { once: true },
    );
    return true;
  } catch {
    return false;
  }
}

export { COPY_BUTTON_MODULE_URL };
