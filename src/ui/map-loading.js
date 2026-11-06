/**
 * Initial MapX feedback, shared by standalone and embedded viewers.
 *
 * A map has no useful skeleton before its basemap exists. Keep the iframe
 * rendering and the layer panel usable; show Mangrove's decorative Loader
 * beside visible text instead of covering the map with invented geography.
 */
import { setLoadingText } from "./inline-loader.js";
import { createLayerAnnouncer } from "./announcer.js";

// Match the layer rows: a fast, already-warm map needs no flashing indicator.
export const MAP_LOADING_DELAY_MS = 450;

export function createMapLoading(appMap, mapFrame) {
  if (!appMap || !mapFrame) return { finish() {}, destroy() {} };
  const doc = appMap.ownerDocument;
  const previousBusy = mapFrame.getAttribute("aria-busy");
  mapFrame.setAttribute("aria-busy", "true");

  const feedback = doc.createElement("div");
  feedback.className = "map-loading map-loading--floating";
  feedback.hidden = true;
  const message = doc.createElement("p");
  message.className = "map-loading__message";
  const help = doc.createElement("p");
  help.className = "map-loading__help";
  help.textContent = "You can browse the map categories while it loads.";
  feedback.append(message, help);
  // The floating panel occupies most of a narrow map. Give it an in-flow
  // status line there instead of letting the desktop card sit behind it.
  const panel = appMap.querySelector('[data-ui="layer-panel"]');
  const panelFeedback = doc.createElement("div");
  panelFeedback.className = "map-loading map-loading--panel";
  panelFeedback.hidden = true;
  const panelMessage = doc.createElement("p");
  panelMessage.className = "map-loading__message";
  panelFeedback.append(panelMessage);
  const panelHeader = panel?.querySelector(".layer-panel-header");
  if (panelHeader) {
    panelHeader.after(panelFeedback);
    feedback.classList.add("map-loading--with-panel");
  }
  const announcer = createLayerAnnouncer(doc);
  appMap.append(feedback, announcer.element);

  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    setLoadingText(message, "Loading map…");
    setLoadingText(panelMessage, "Loading map…");
    feedback.hidden = false;
    panelFeedback.hidden = false;
    announcer.announce("map-loading", "Loading map…");
  }, MAP_LOADING_DELAY_MS);

  function finish({ failed = false } = {}) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const wasVisible = !feedback.hidden && appMap.getAttribute("aria-hidden") !== "true";
    feedback.remove();
    panelFeedback.remove();
    if (previousBusy === null) mapFrame.removeAttribute("aria-busy");
    else mapFrame.setAttribute("aria-busy", previousBusy);
    // Failure already has an alert in the service notice. A hidden warm-up
    // completing should not interrupt somebody reading an information page.
    announcer.announce("map-loading", wasVisible && !failed ? "Map ready." : "");
  }

  return {
    finish,
    destroy() {
      finish({ failed: true });
      announcer.destroy();
    },
  };
}
