/**
 * Loader for Mangrove's on-this-page-nav behaviour.
 *
 * `js/on-this-page-nav.js` is a self-contained ES module. In explicit mode
 * (a `<ul>` is already inside the container) it wires scroll-spy with
 * IntersectionObserver, adds horizontal overflow scroll buttons, and publishes
 * `--mg-on-this-page-nav-block-size` on `:root` so the browser's
 * `scroll-padding-top` always lands below the sticky bar. The script is
 * fetched from the CDN to stay in step with the stylesheet. Keep
 * MANGROVE_VERSION aligned with the `<link>` in index.html.
 *
 * Enhancement is optional: the authored markup renders all nav links in
 * sequence without it, so a load failure degrades to a static bar.
 */

const MANGROVE_VERSION = "2.3.0";
const ON_THIS_PAGE_NAV_MODULE_URL = `https://assets.undrr.org/mangrove/${MANGROVE_VERSION}/js/on-this-page-nav.js`;

let modulePromise = null;

/**
 * Initialise Mangrove on-this-page-nav elements found inside `scope`.
 * Resolves to true when the behaviour was applied, false otherwise.
 * @param {ParentNode} [scope]
 * @param {object} [options]
 * @param {() => Promise<object>} [options.importImpl] - module loader (tests)
 * @param {AbortSignal} [options.signal] - aborting calls `mgOnThisPageNavDestroy`
 *   on each container; abort while the containers are still in the document.
 */
export async function initMangroveOnThisPageNav(scope = document, { importImpl, signal } = {}) {
  if (signal?.aborted) return false;

  const selector = "[data-mg-on-this-page-nav]";
  const containers = [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
  if (containers.length === 0) return false;

  let mod;
  const destroy = () => {
    for (const el of containers) {
      try {
        mod?.mgOnThisPageNavDestroy?.(el);
      } catch (err) {
        console.warn("Mangrove on-this-page-nav could not be destroyed:", err);
      }
    }
  };
  try {
    if (importImpl) {
      mod = await importImpl();
    } else {
      modulePromise ??= import(/* @vite-ignore */ ON_THIS_PAGE_NAV_MODULE_URL);
      try {
        mod = await modulePromise;
      } catch (err) {
        modulePromise = null;
        throw err;
      }
    }
    if (signal?.aborted) return false;
    if (typeof mod?.mgOnThisPageNav !== "function") return false;
    try {
      mod.mgOnThisPageNav(containers);
    } catch {
      // A partial enhancement can already own window listeners and observers.
      destroy();
      return false;
    }
    signal?.addEventListener("abort", destroy, { once: true });
    return true;
  } catch {
    return false;
  }
}

export { ON_THIS_PAGE_NAV_MODULE_URL };
