/** Supporting information for one metric, without leaving the current map. */
import { escapeHtml } from "../utils/html.js";
import { viewLabel } from "../utils/region-csv.js";
import { layerLinksHtml } from "../utils/layer-links.js";
import { downloadListHtml } from "./download-links.js";

export function createMetricResourcesDialog({ doc = document, downloads = null } = {}) {
  const dialog = doc.createElement("dialog");
  dialog.className = "download-dialog metric-resources-dialog";
  const listeners = new AbortController();
  const { signal } = listeners;
  let opener = null;

  function close() {
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
        close();
      }
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("a[href], button:not([disabled])")];
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

  return {
    element: dialog,
    open({ layer, source = null, opener: trigger = doc.activeElement }) {
      opener = trigger;
      const view = source ? { ...layer, ...source, sources: undefined } : layer;
      const title = viewLabel(layer, source);
      const url = new URL(".", doc.defaultView.location.href);
      const setting = new URLSearchParams(doc.defaultView.location.search).get("downloads");
      if (setting !== null) url.searchParams.set("downloads", setting);
      url.hash = "sources";
      const links = layerLinksHtml(view, { downloadsEnabled: Boolean(downloads) });
      dialog.setAttribute("aria-label", `Resources: ${title}`);
      dialog.innerHTML = `
        <div class="download-dialog__header">
          <h2 class="download-dialog__title" tabindex="-1">${escapeHtml(title)}</h2>
          <button type="button" class="download-dialog__close" data-action="close-resources" aria-label="Close resources"><span class="mg-icon mg-icon-close" aria-hidden="true"></span></button>
        </div>
        ${view.note || view.desc ? section("Notes", `<p>${escapeHtml(view.note || view.desc)}</p>`) : ""}
        ${view.source ? section("Source", `<p>${linkedText(view.source, view.sourceUrl)}</p>`) : ""}
        ${view.citation ? section("Citation", `<p>${escapeHtml(view.citation)}</p>`) : ""}
        ${view.license ? section("License", `<p>${linkedText(view.license, view.licenseUrl)}</p>`) : ""}
        ${section("Methodology and data", (links ? `<p>${links}</p>` : "") + (downloads ? downloadListHtml(layer, source) : ""))}
        <div class="metric-resources-dialog__actions">
          <button type="button" class="mg-button mg-button-secondary" data-action="close-resources">Back to map</button>
          <a href="${escapeHtml(url.href)}" target="_blank" rel="noopener" aria-label="View all sources (opens in a new tab)">View all sources</a>
        </div>`;
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
      listeners.abort();
      dialog.remove();
    },
  };
}
