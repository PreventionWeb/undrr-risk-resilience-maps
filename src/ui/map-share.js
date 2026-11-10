/** Mangrove ShareButtons markup, with links supplied by this viewer's state. */
import { escapeHtml } from "../utils/html.js";

export function mapShareHtml(url, { deviceShare = false, showHeading = true } = {}) {
  const encoded = encodeURIComponent(url);
  const links = [
    ["Share on LinkedIn", "linkedin", `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`],
    ["Share on Facebook", "facebook", `https://facebook.com/sharer/sharer.php?u=${encoded}`],
    ["Share on X", "x-social", `https://twitter.com/intent/tweet?text=${encoded}`],
    [
      "Share via email",
      "envelope",
      `mailto:?subject=${encodeURIComponent("Risk and resilience map")}&body=${encoded}`,
    ],
  ];
  return `<section class="mg-share" aria-label="Share current map">
    ${showHeading ? '<header class="mg-share__header">Share this map</header>' : ""}
    <p>Includes all active layers and their selected scenarios.</p>
    <div class="mg-share__buttons">
      ${deviceShare ? '<button type="button" class="mg-share__button" data-action="share-device" aria-label="Share using your device" title="Share using your device"><span class="mg-icon mg-icon-share" aria-hidden="true"></span></button>' : ""}
      ${links.map(([label, icon, href]) => `<a class="mg-share__button" href="${escapeHtml(href)}" target="_blank" rel="noopener" aria-label="${label}" title="${label}"><span class="mg-icon mg-icon-${icon}" aria-hidden="true"></span></a>`).join("")}
    </div>
    <button type="button" class="mg-share__copy-button" data-action="copy-map-link" aria-label="Copy map link" title="Copy map link">
      <span class="mg-share__clip-icon"><span class="mg-icon mg-icon-link" aria-hidden="true"></span></span>
      <span class="mg-share__copy-text">${escapeHtml(url.replace(/^https?:\/\//, ""))}</span>
      <span class="mg-share__stack-icon"><span class="mg-icon mg-icon-clone" aria-hidden="true"></span></span>
    </button>
    <span class="mg-u-sr-only" role="status" data-part="share-status"></span>
    <input class="mg-form-control" type="text" readonly hidden aria-label="Map link for manual copying" value="${escapeHtml(url)}">
  </section>`;
}

/** No global location/shortlink changes: embeds share a standalone viewer URL. */
export function attachMapShare(scope, url, { signal } = {}) {
  const nav = scope.ownerDocument.defaultView.navigator;
  const status = scope.querySelector('[data-part="share-status"]');
  const copyText = scope.querySelector(".mg-share__copy-text");
  const fallback = scope.querySelector("input[readonly]");
  let timer;
  signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
  scope.addEventListener(
    "click",
    async (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "copy-map-link") {
        try {
          await nav.clipboard.writeText(url);
          if (signal?.aborted) return;
          status.textContent = "Map link copied.";
          copyText.textContent = "Link copied";
          clearTimeout(timer);
          timer = setTimeout(() => {
            copyText.textContent = url.replace(/^https?:\/\//, "");
          }, 2000);
        } catch {
          if (signal?.aborted) return;
          status.textContent = "Could not copy the link. Select the link below and copy it manually.";
          fallback.hidden = false;
          fallback.focus();
          fallback.select();
        }
      } else if (action === "share-device") {
        try {
          await nav.share({ title: "Risk and resilience map", url });
        } catch (error) {
          if (!signal?.aborted && error.name !== "AbortError")
            status.textContent = "Could not share the map. Use Copy map link instead.";
        }
      }
    },
    { signal },
  );
}
