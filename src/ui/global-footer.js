/**
 * UNDRR global footer, syndicated from PreventionWeb.
 *
 * Mangrove documents a `widget.js` embed for this (see the Footer component's
 * `vanillaHtmlEmbed`), but that script chains its content request inside a
 * `publish.preventionweb.net/widget-body.php` fetch which currently returns 403
 * to every origin, so the documented embed injects nothing. We therefore call
 * the same syndication endpoint the widget would ultimately have called, with
 * the same page id, and inject the markup it returns. That endpoint sends
 * `Access-Control-Allow-Origin: *`, so it works from any host.
 *
 * The response body already contains a complete `<footer class="mg-footer">`
 * styled by the Mangrove stylesheet, so it is injected verbatim — the footer
 * structure is a UNDRR branding requirement and must not be reshaped locally.
 *
 * The footer is decorative chrome: if syndication fails the container stays
 * empty and the rest of the app is unaffected.
 */

/** PreventionWeb node id for the "Footer: UNDRR.org" landing page. */
const FOOTER_PAGE_ID = "83835";
const SYNDICATION_ORIGIN = "https://www.undrr.org";
const REQUEST_TIMEOUT_MS = 8000;

export function footerSyndicationUrl(pageId = FOOTER_PAGE_ID) {
  return `${SYNDICATION_ORIGIN}/api/v2/content/landingpage?id=${encodeURIComponent(pageId)}&suffixid=footer`;
}

/**
 * Fetch the syndicated footer markup. Resolves to null on any failure
 * (network, timeout, non-OK status, unexpected payload shape).
 */
export async function fetchGlobalFooterHtml({ fetchImpl = globalThis.fetch, pageId } = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(footerSyndicationUrl(pageId), {
      signal: controller?.signal,
    });
    if (!res?.ok) return null;
    const data = await res.json();
    const body = data?.results?.[0]?.body;
    return typeof body === "string" && body.includes("mg-footer") ? body : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Populate the global footer container. Safe to call when the element is
 * absent, and a no-op once the footer has already been injected.
 */
export async function initGlobalFooter({ container, fetchImpl } = {}) {
  const el = container ?? document.getElementById("global-footer");
  if (!el || el.dataset.loaded === "true") return false;

  const html = await fetchGlobalFooterHtml({ fetchImpl });
  if (!html) return false;

  el.innerHTML = html;
  el.dataset.loaded = "true";
  return true;
}

/** Show the global footer on content pages only; the map view is full-bleed. */
export function setGlobalFooterVisible(visible, container) {
  const el = container ?? document.getElementById("global-footer");
  if (el) el.hidden = !visible;
}
