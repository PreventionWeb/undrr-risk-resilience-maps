/**
 * Mangrove's inline loading pattern: a 1em spinner beside visible status text.
 *
 * Mangrove 2.0.1 added `mg-loader--inline`, a spinner sized in em that takes
 * the text colour of whatever it sits in. Its docs pair it with visible text
 * ("Saving…") and mark it decorative, because the text already says what is
 * happening and is what assistive technology reads. The spinner is therefore
 * `aria-hidden` here, and an element's `textContent` is still exactly the
 * message, so the region's announcement (where it has one) is unchanged.
 *
 * The spinner goes when the text does: writing the outcome with `textContent`
 * ("Could not load…", or "" to clear) replaces both, so a finished load can
 * never leave a spinner standing.
 */

/** A decorative inline spinner. */
export function createInlineLoader() {
  const spinner = document.createElement("span");
  spinner.className = "mg-loader mg-loader--inline";
  spinner.setAttribute("aria-hidden", "true");
  return spinner;
}

/**
 * Show `text` in `el` with an inline spinner before it.
 * @param {Element} el - the status element
 * @param {string} text - the loading message
 */
export function setLoadingText(el, text) {
  el.replaceChildren(createInlineLoader(), document.createTextNode(text));
}
