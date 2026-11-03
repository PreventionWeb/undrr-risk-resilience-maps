import { DATA_REQUESTS } from "../config/data-requests.js";
import { escapeHtml } from "./html.js";
import { getLayerRegistry } from "../config/registry.js";
import { formatHash } from "../state/hash.js";

export function explainerUrl(layer) {
  try {
    const url = new URL(layer.explainerUrl);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function dataRequestUrl(layer, config = DATA_REQUESTS) {
  if (!config.recipient) return null;
  // Link the one selected map, including its compound source index. A public
  // viewer URL keeps requests usable when composed in an embed or local preview.
  const entry = getLayerRegistry().byViewId(layer.id);
  let mapLink = "[insert link]";
  if (entry) {
    const url = new URL(config.viewerUrl || DATA_REQUESTS.viewerUrl);
    const sourceIdx = entry.source ? entry.layer.sources.indexOf(entry.source) : 0;
    url.hash = formatHash(entry.tab.id, [{ key: entry.layer.key, sourceIdx }]);
    mapLink = url.href;
  }
  const body = [
    "Dear UNDRR team,",
    "",
    "I would like to request the underlying data needed to reproduce the following map from the Map Viewer:",
    "",
    `Map title: ${layer.label || "[insert title]"}`,
    "Country or region: [insert location]",
    `Map link: ${mapLink}`,
    "Intended use: [briefly describe how you plan to use the data]",
    "",
  ].join("\r\n");
  const cc = config.cc?.length ? `cc=${encodeURIComponent(config.cc.join(","))}&` : "";
  return `mailto:${encodeURIComponent(config.recipient).replace(/%40/g, "@")}?${cc}subject=${encodeURIComponent(config.subject)}&body=${encodeURIComponent(body)}`;
}

/** Shared by the layer accordion and Sources; spreadsheet notes remain plain text. */
export function layerLinksHtml(layer) {
  const links = [];
  const explainer = explainerUrl(layer);
  if (explainer)
    links.push(
      `<a href="${escapeHtml(explainer)}" target="_blank" rel="noopener">Learn more about this metric</a>`,
    );
  if (layer.r2rCategory === "GAR2026") {
    const request = dataRequestUrl(layer);
    if (request) links.push(`<a href="${escapeHtml(request)}">Request data</a>`);
  }
  return links.join(" · ");
}
