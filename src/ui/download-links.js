/**
 * Download controls markup (prototype, behind `?downloads=1`; #64).
 *
 * `downloadListHtml(layer, source)` draws a view's download controls: a link
 * per hosted file (format, size, a warning over 1 GB) and a "Download CSV"
 * button for region-level vector views. The layer row and the Sources table
 * both use it; the button's click is handled by the caller's delegated
 * listener (`createDownloads().handleClick`, src/ui/downloads.js).
 *
 * Pure markup: no listeners, no SDK.
 */
import { formatBytes, getViewDownloads } from "../config/downloads.js";
import { escapeHtml } from "../utils/html.js";

import { viewLabel } from "../utils/region-csv.js";

const DOWNLOAD_ICON = '<span class="mg-icon mg-icon-download" aria-hidden="true"></span>';

/**
 * Ids for the large-file warnings a link's aria-describedby points at. A
 * counter, not a view id: the same view can be drawn in its home row, a
 * cross-tab row and the Sources table at once, and ids must stay unique.
 */
let warningIds = 0;

/**
 * A view's download controls as an HTML list, or "" when it has none.
 *
 * Each control's accessible name (aria-label) carries the view's label
 * ("Download CSV: Losses to housing – AAL Current (values per region)"), so
 * the many controls on the Sources page and in the panel can be told apart out
 * of context. The name starts with the visible words (WCAG 2.5.3). An
 * aria-label rather than visually hidden text: browsers put a space before a
 * hidden span ("CSV : Losses…").
 *
 * @param {object} layer - layer config
 * @param {object|null} [source] - the compound source shown
 * @param {{ prefix?: string }} [options] - a label before each item (the
 *   Sources table names the compound source a file belongs to)
 */
export function downloadListHtml(layer, source = null, { prefix = "" } = {}) {
  const { viewId, files, csv } = getViewDownloads(layer, source);
  const lead = prefix ? `<span class="layer-downloads__source">${escapeHtml(prefix)}:</span> ` : "";
  const name = viewLabel(layer, source);
  const items = files.map((file) => {
    const size = formatBytes(file.bytes);
    const warningId = file.large ? `layer-download-warning-${++warningIds}` : "";
    const warning = file.large
      ? `<span class="layer-downloads__warning mg-form-help" id="${warningId}"><span class="mg-icon mg-icon-exclamation-triangle" aria-hidden="true"></span> Over 1 GB: a fast, unmetered connection is recommended.</span>`
      : "";
    const describedBy = warningId ? ` aria-describedby="${warningId}"` : "";
    return `<li class="layer-downloads__item">${lead}<a class="layer-downloads__link" href="${escapeHtml(file.url)}" download="${escapeHtml(file.filename)}" data-bytes="${file.bytes}"${describedBy} aria-label="${escapeHtml(`Download ${file.filename}: ${name} (${file.format}, ${size})`)}">${DOWNLOAD_ICON}Download ${escapeHtml(file.filename)} <span class="layer-downloads__meta">(${escapeHtml(file.format)}, ${escapeHtml(size)})</span></a>${warning}</li>`;
  });
  if (csv) {
    items.push(
      `<li class="layer-downloads__item">${lead}<button type="button" class="layer-downloads__csv" data-action="download-csv" data-view-id="${escapeHtml(viewId)}" aria-label="${escapeHtml(`Download CSV: ${name} (values per region)`)}">${DOWNLOAD_ICON}Download CSV <span class="layer-downloads__meta">(values per region)</span></button></li>`,
    );
  }
  return items.length ? `<ul class="layer-downloads">${items.join("")}</ul>` : "";
}

/**
 * Every view's downloads for a Sources table row: one list for a simple layer,
 * or each compound source's, named by the source label.
 */
export function sourcesRowDownloadsHtml(layer) {
  if (layer.sources?.length) {
    return layer.sources
      .map((source) => downloadListHtml(layer, source, { prefix: source.label }))
      .filter(Boolean)
      .join("");
  }
  return downloadListHtml(layer);
}
