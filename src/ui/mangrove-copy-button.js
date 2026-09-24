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
 * The 2.0.0 module's only export is `mgCopyButton(scope)`: there is no
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
 * Unlike mangrove-tabs.js, "never applied, never broken" does NOT hold here.
 * Without the tabs module every panel renders in sequence, so the content is
 * still reachable; without this module the copy button is present, focusable,
 * not disabled and announced as "Copy coordinates" — and does nothing at all.
 * An inert affordance is worse than the hand-rolled control it replaced, and
 * the window is real: a slow CDN leaves clicks made in the first seconds after
 * the inspector opens unanswered. So `attachCopyButtonFallback()` below wires a
 * local click handler at render time, and the caller drops it only once
 * `initMangroveCopyButtons()` has resolved true — the two are never both live,
 * so nothing is copied or announced twice.
 */

const MANGROVE_VERSION = "2.0.0";
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

/** How long the copied state stays up, matching 2.0.0's copy-button module. */
const FEEDBACK_MS = 2000;
const FAILURE_MS = 5000;

/**
 * Wire a local click handler on one `[data-mg-copy-button]`, doing what the
 * Mangrove module would: write `data-text-to-copy`, raise the copied state and
 * its tooltip, and put the copied label into the button's own `aria-live`
 * region, with the failure wording on a rejected write. It reads the same
 * `data-*` attributes as the module, so the two behave identically.
 *
 * This exists only to cover the window before the CDN module resolves (and the
 * case where it never does). Detach it as soon as the module is in.
 * @param {HTMLElement | null} button
 * @returns {() => void} detach
 */
export function attachCopyButtonFallback(button) {
  if (!button?.addEventListener) return () => {};

  let timer = null;
  const feedbackEl = button.querySelector(".mg-copy-button__feedback");
  const liveRegion = button.querySelector(".mg-u-sr-only");

  const reset = () => {
    button.classList.remove("mg-copy-button--copied");
    feedbackEl?.classList.remove("mg-copy-button__feedback--visible", "mg-copy-button__feedback--error");
    if (liveRegion) liveRegion.textContent = "";
  };

  const onClick = async () => {
    const { textToCopy = "", tooltipLabel, copiedLabel, failedTooltipLabel, failedLabel } = button.dataset;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(textToCopy);
      button.classList.add("mg-copy-button--copied");
      if (feedbackEl) {
        feedbackEl.textContent = tooltipLabel || "Copied!";
        feedbackEl.classList.add("mg-copy-button__feedback--visible");
      }
      if (liveRegion) liveRegion.textContent = copiedLabel || "Copied to clipboard.";
      clearTimeout(timer);
      timer = setTimeout(reset, FEEDBACK_MS);
    } catch {
      if (feedbackEl) {
        feedbackEl.textContent = failedTooltipLabel || "Copy failed";
        feedbackEl.classList.add("mg-copy-button__feedback--visible", "mg-copy-button__feedback--error");
      }
      if (liveRegion) {
        liveRegion.textContent = failedLabel || "Copy failed. Select the text and copy it manually.";
      }
      clearTimeout(timer);
      timer = setTimeout(reset, FAILURE_MS);
    }
  };

  button.addEventListener("click", onClick);
  // The pending timer is left to run: it only clears the transient state, and
  // cancelling it here would freeze a "Copied!" tooltip on screen.
  return () => button.removeEventListener("click", onClick);
}

export { COPY_BUTTON_MODULE_URL };
