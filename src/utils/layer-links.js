import { DATA_REQUESTS } from "../config/data-requests.js";
import { escapeHtml } from "./html.js";

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
  const views = layer.sources || [layer];
  const body = [
    config.placeholder ? "PREVIEW: recipient is a placeholder. Replace before sending.\n" : "",
    "I would like to request access to the following map data:",
    `Layer: ${layer.label}`,
    ...views.map((source) => `Map: ${source.label} (${source.id || "ID pending"})`),
    "",
    "Name: [your name]",
    "Organisation: [your organisation]",
    "Email: [your email]",
    "Geographic area: [country or region]",
    "Required resolution / format: [specify]",
    "Intended use: [describe why you need the data]",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
  return `mailto:${encodeURIComponent(config.recipient)}?subject=${encodeURIComponent(config.subject)}&body=${encodeURIComponent(body)}`;
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
    if (request)
      links.push(
        `<a href="${escapeHtml(request)}"${DATA_REQUESTS.placeholder ? ' title="Placeholder recipient: replace before sending"' : ""}>Request data${DATA_REQUESTS.placeholder ? " (placeholder)" : ""}</a>`,
      );
  }
  return links.join(" · ");
}
