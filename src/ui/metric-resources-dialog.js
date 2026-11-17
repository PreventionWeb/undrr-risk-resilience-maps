/** Supporting information for one metric, without leaving the current map. */
import { escapeHtml } from "../utils/html.js";
import { viewLabel } from "../utils/region-csv.js";
import { layerLinksHtml } from "../utils/layer-links.js";
import { mapShareHtml, attachMapShare } from "./map-share.js";
import { downloadListHtml } from "./download-links.js";
import { initMangroveCitations } from "./mangrove-cite-this.js";

export function createMetricResourcesDialog({
  doc = document,
  downloads = null,
  getMapShare = () => null,
} = {}) {
  const dialog = doc.createElement("dialog");
  dialog.className = "download-dialog metric-resources-dialog";
  const listeners = new AbortController();
  const { signal } = listeners;
  let opener = null;
  let contentListeners = null;
  let citationsLifetime = null;
  let shareSignature = null;
  let metricView = false;

  function close() {
    citationsLifetime?.abort();
    contentListeners?.abort();
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    if (opener?.isConnected) opener.focus();
  }

  async function copyCitationAndMap(button) {
    const share = getMapShare();
    if (!share?.url || share.pending) return;
    const lifetime = citationsLifetime.signal;
    const container = button.closest(".metric-resources-dialog__citation");
    const status = container.querySelector('[data-part="citation-map-status"]');
    const fallback = container.querySelector("textarea");
    const text = `${button.dataset.citation}\n\nMap link: ${share.url}`;
    const isCurrent = () => !lifetime.aborted && getMapShare()?.url === share.url && !getMapShare()?.pending;
    try {
      await doc.defaultView.navigator.clipboard.writeText(text);
      if (!isCurrent()) return;
      fallback.hidden = true;
      status.textContent = "Citation and map link copied.";
    } catch {
      if (!isCurrent()) return;
      status.textContent = "Could not copy. Select the citation and map link below and copy them manually.";
      fallback.value = text;
      fallback.hidden = false;
      fallback.focus();
      fallback.select();
    }
  }

  dialog.addEventListener(
    "cancel",
    (event) => {
      if (event.target !== dialog) return;
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target.closest('[data-action="close-resources"]')) close();
      else if (event.target.closest('[data-action="copy-citation-map"]'))
        copyCitationAndMap(event.target.closest('[data-action="copy-citation-map"]'));
      else downloads?.handleClick(event);
    },
    { signal },
  );
  if (downloads) dialog.addEventListener("auxclick", downloads.handleClick, { signal });
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.target.closest("dialog") !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...dialog.querySelectorAll(
          "a[href], button:not([disabled]), input:not([hidden]), textarea:not([hidden])",
        ),
      ].filter((control) => control.closest("dialog") === dialog && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (doc.activeElement === first || doc.activeElement === dialog.querySelector("h2"))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal },
  );

  function section(label, html, level = 3) {
    return html
      ? `<section class="metric-resources-dialog__section"><h${level} class="metric-resources-dialog__section-title">${label}</h${level}>${html}</section>`
      : "";
  }
  function linkedText(text, url) {
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
      : escapeHtml(text);
  }

  function citationHtml(citation) {
    if (/^(source to be confirmed\.?|tbd)$/i.test(citation.trim())) return `<p>${escapeHtml(citation)}</p>`;
    return `<div class="metric-resources-dialog__citation">
      <div class="mg-cite-this" data-mg-cite-this
      data-mg-cite-this-citation="${escapeHtml(citation)}"
      data-mg-cite-this-copy-url="false" data-mg-cite-this-export="none">
      <details class="mg-cite-this__fallback" open>
        <summary class="mg-cite-this__summary" hidden>Citation</summary>
        <div class="mg-cite-this__content">
          <p class="mg-cite-this__text" data-mg-cite-this-text>${escapeHtml(citation)}</p>
          <div class="mg-cite-this__actions">
            <button type="button" class="mg-cite-this__copy" data-mg-cite-this-copy hidden>Copy citation</button>
            <span class="mg-cite-this__status" data-mg-cite-this-status role="status" aria-live="polite"></span>
          </div>
        </div>
      </details>
      </div>
      <div class="metric-resources-dialog__citation-tools" hidden>
        <a data-part="citation-map-link" target="_blank" rel="noopener">Map link</a>
        <button type="button" class="mg-button mg-button-primary mg-button-outline"
          data-action="copy-citation-map" data-citation="${escapeHtml(citation)}" disabled>Copy citation and map link</button>
      </div>
      <p data-part="citation-map-status" role="status"></p>
      <textarea class="mg-form-textarea" readonly hidden rows="4" aria-label="Citation and map link for manual copying"></textarea>
    </div>`;
  }

  function refreshCitationLinks(share) {
    for (const container of dialog.querySelectorAll(".metric-resources-dialog__citation")) {
      container.querySelector(".metric-resources-dialog__citation-tools").hidden = !share?.url;
      const button = container.querySelector('[data-action="copy-citation-map"]');
      button.disabled = !share?.url || Boolean(share.pending);
      const link = container.querySelector('[data-part="citation-map-link"]');
      if (share?.url) link.href = share.url;
      else link.removeAttribute("href");
      link.hidden = Boolean(share?.pending);
      container.querySelector('[data-part="citation-map-status"]').textContent = "";
      const fallback = container.querySelector("textarea");
      if (doc.activeElement === fallback || (share?.pending && doc.activeElement === link))
        dialog.querySelector(".download-dialog__title").focus();
      fallback.hidden = true;
      fallback.value = "";
    }
  }

  function metricHtml(layer, source = null, level = 3, includeCitation = true) {
    const view = source ? { ...layer, ...source, sources: undefined } : layer;
    const links = layerLinksHtml(view, { downloadsEnabled: Boolean(downloads) });
    return `
      ${view.note || view.desc ? section("Notes", `<p>${escapeHtml(view.note || view.desc)}</p>`, level) : ""}
      ${view.source ? section("Source", `<p>${linkedText(view.source, view.sourceUrl)}</p>`, level) : ""}
      ${includeCitation && view.citation ? section("Citation", citationHtml(view.citation), level) : ""}
      ${view.license ? section("License", `<p>${linkedText(view.license, view.licenseUrl)}</p>`, level) : ""}
      ${section("Methodology and data", (links ? `<p>${links}</p>` : "") + (downloads ? downloadListHtml(layer, source) : ""), level)}`;
  }

  function mapResourcesHtml(layer, source) {
    const view = source ? { ...layer, ...source } : layer;
    return `<section class="metric-resources-dialog__map">
      <h4 class="metric-resources-dialog__map-title">${escapeHtml(viewLabel(layer, source))}</h4>
      ${view.citation ? section("Citation", citationHtml(view.citation), 5) : ""}
      <details class="mg-details metric-resources-dialog__metric">
        <summary>More map details</summary>
        <div>${metricHtml(layer, source, 5, false)}</div>
      </details>
    </section>`;
  }

  function shareMarkup(share) {
    if (!share) return "";
    if (share.pending)
      return '<section class="mg-share" role="status"><p>The map is updating. Sharing will be available when it finishes.</p></section>';
    return mapShareHtml(share.url, {
      deviceShare: Boolean(doc.defaultView.navigator.share),
      showHeading: metricView,
    });
  }

  function wireShare(share) {
    if (share && !share.pending)
      attachMapShare(dialog.querySelector(".mg-share"), share.url, { signal: contentListeners.signal });
  }

  function refreshShare() {
    if (!dialog.open) return;
    const share = getMapShare();
    const signature = JSON.stringify([share?.url, share?.pending]);
    if (signature === shareSignature) return;
    shareSignature = signature;
    const region = dialog.querySelector(".metric-resources-dialog__share");
    const focused = doc.activeElement;
    const action = region.contains(focused) ? focused.closest("[data-action]")?.dataset.action : null;
    const label = region.contains(focused) ? focused.getAttribute("aria-label") : null;
    contentListeners?.abort();
    contentListeners = new AbortController();
    region.innerHTML = shareMarkup(share);
    wireShare(share);
    refreshCitationLinks(share);
    if (action || label) {
      const replacement = [...region.querySelectorAll("button, a")].find((control) =>
        action ? control.dataset.action === action : control.getAttribute("aria-label") === label,
      );
      (replacement || dialog.querySelector("h2")).focus();
    }
  }

  return {
    element: dialog,
    refreshShare,
    open({ layer = null, source = null, opener: trigger = doc.activeElement } = {}) {
      opener = trigger;
      citationsLifetime?.abort();
      citationsLifetime = new AbortController();
      contentListeners?.abort();
      contentListeners = new AbortController();
      const share = getMapShare();
      metricView = Boolean(layer);
      shareSignature = JSON.stringify([share?.url, share?.pending]);
      const title = layer ? viewLabel(layer, source) : "Share this map";
      const shareHtml = `<div class="metric-resources-dialog__share">${shareMarkup(share)}</div>`;
      const metricsHtml = layer
        ? metricHtml(layer, source)
        : share?.metrics
            .map(({ layer: item, source: variant }) => mapResourcesHtml(item, variant))
            .join("") || "<p>No layers selected.</p>";
      const url = new URL(".", doc.defaultView.location.href);
      const setting = new URLSearchParams(doc.defaultView.location.search).get("downloads");
      if (!downloads) url.searchParams.set("downloads", "0");
      else if (setting !== null) url.searchParams.set("downloads", setting);
      url.hash = "sources";
      dialog.setAttribute("aria-label", layer ? `Resources: ${title}` : title);
      dialog.innerHTML = `
        <div class="download-dialog__header">
          <h2 class="download-dialog__title" tabindex="-1">${escapeHtml(title)}</h2>
          <button type="button" class="download-dialog__close" data-action="close-resources" aria-label="Close resources"><span class="mg-icon mg-icon-close" aria-hidden="true"></span></button>
        </div>
        <div class="metric-resources-dialog__body">
          ${layer ? metricsHtml + shareHtml : shareHtml + section("Map resources", metricsHtml)}
        </div>
        <div class="metric-resources-dialog__actions">
          <button type="button" class="mg-button mg-button-secondary" data-action="close-resources">Back to map</button>
          <a href="${escapeHtml(url.href)}" target="_blank" rel="noopener" aria-label="View all sources (opens in a new tab)">View all sources</a>
        </div>`;
      wireShare(share);
      refreshCitationLinks(share);
      if (!dialog.isConnected) doc.body.appendChild(dialog);
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else {
          dialog.setAttribute("open", "");
          dialog.setAttribute("aria-modal", "true");
        }
      }
      dialog.querySelector("h2").focus();
      initMangroveCitations(dialog, { signal: citationsLifetime.signal });
    },
    destroy() {
      citationsLifetime?.abort();
      contentListeners?.abort();
      listeners.abort();
      dialog.remove();
    },
  };
}
