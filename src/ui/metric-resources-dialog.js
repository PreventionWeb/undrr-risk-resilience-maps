/** Supporting information for one metric, without leaving the current map. */
import { escapeHtml } from "../utils/html.js";
import { viewLabel } from "../utils/region-csv.js";
import { layerLinksHtml } from "../utils/layer-links.js";
import { mapShareHtml, attachMapShare } from "./map-share.js";
import { downloadListHtml } from "./download-links.js";

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
  let shareSignature = null;
  let metricView = false;

  function close() {
    contentListeners?.abort();
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    if (opener?.isConnected) opener.focus();
  }

  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      close();
    },
    { signal },
  );
  dialog.addEventListener(
    "click",
    (event) => {
      if (event.target.closest('[data-action="close-resources"]')) close();
      else downloads?.handleClick(event);
    },
    { signal },
  );
  if (downloads) dialog.addEventListener("auxclick", downloads.handleClick, { signal });
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("a[href], button:not([disabled]), input:not([hidden])")];
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

  function section(label, html) {
    return html ? `<section><h3>${label}</h3>${html}</section>` : "";
  }
  function linkedText(text, url) {
    return url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`
      : escapeHtml(text);
  }

  function metricHtml(layer, source = null) {
    const view = source ? { ...layer, ...source, sources: undefined } : layer;
    const links = layerLinksHtml(view, { downloadsEnabled: Boolean(downloads) });
    return `
      ${view.note || view.desc ? section("Notes", `<p>${escapeHtml(view.note || view.desc)}</p>`) : ""}
      ${view.source ? section("Source", `<p>${linkedText(view.source, view.sourceUrl)}</p>`) : ""}
      ${view.citation ? section("Citation", `<p>${escapeHtml(view.citation)}</p>`) : ""}
      ${view.license ? section("License", `<p>${linkedText(view.license, view.licenseUrl)}</p>`) : ""}
      ${section("Methodology and data", (links ? `<p>${links}</p>` : "") + (downloads ? downloadListHtml(layer, source) : ""))}`;
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
            .map(
              ({ layer: item, source: variant }) =>
                `<details class="mg-details metric-resources-dialog__metric"><summary>${escapeHtml(viewLabel(item, variant))}</summary><div>${metricHtml(item, variant)}</div></details>`,
            )
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
        ${layer ? metricsHtml + shareHtml : shareHtml + section("Map resources", metricsHtml)}
        <div class="metric-resources-dialog__actions">
          <button type="button" class="mg-button mg-button-secondary" data-action="close-resources">Back to map</button>
          <a href="${escapeHtml(url.href)}" target="_blank" rel="noopener" aria-label="View all sources (opens in a new tab)">View all sources</a>
        </div>`;
      wireShare(share);
      if (!dialog.isConnected) doc.body.appendChild(dialog);
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else {
          dialog.setAttribute("open", "");
          dialog.setAttribute("aria-modal", "true");
        }
      }
      dialog.querySelector("h2").focus();
    },
    destroy() {
      contentListeners?.abort();
      listeners.abort();
      dialog.remove();
    },
  };
}
