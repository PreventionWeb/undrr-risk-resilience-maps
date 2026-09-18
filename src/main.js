/**
 * App entry point (standalone site).
 *
 * Builds the sidebar UI immediately (nav, info pages), then initialises the
 * MapX SDK iframe. Layer-specific operations (add/remove views, feature
 * inspection, hash restore) are gated on the SDK "ready" event.
 *
 * This is the one module that owns the page: it passes `document.body` as the
 * sidebar's root and looks up the map container and inspect toggle by id. UI
 * modules receive a root or elements instead (see docs/embedding.md).
 */
import { initSDK, setSDKReady } from "./sdk/client.js";
import { TABS, PRIMARY_PROJECT } from "./config/layers.js";
import { validateLayers } from "./config/validate.js";
import { createSidebar } from "./ui/sidebar.js";
import { showInfobox, closeInfobox } from "./ui/infobox.js";
import {
  initInspection,
  enableInspection,
  disableInspection,
  isInspectionActive,
  onInspectionResult,
  handleClickEvent,
} from "./sdk/inspect.js";
import { buildSiteInspectorPanel, showSiteInspector, hideSiteInspector } from "./ui/site-inspector.js";
import { initBuildInfo } from "./ui/build-info.js";
import {
  hideMapServiceNotice,
  initMapServiceRetry,
  loadMapXSdk,
  showMapServiceNotice,
  startMapServiceRetryCountdown,
  watchForMapReady,
} from "./sdk/availability.js";
import * as store from "./state/store.js";
import "./styles/shared.css";

// Fail fast if layer config has problems (typos, missing IDs, wrong project, etc.)
validateLayers(TABS, PRIMARY_PROJECT);

const inspectToggle = document.getElementById("inspect-toggle");
const appMap = document.getElementById("app-map");

function setInspectionMode(active) {
  if (active) {
    closeInfobox();
    enableInspection();
  } else {
    disableInspection();
    hideSiteInspector();
  }
  appMap?.classList.toggle("inspection-active", active);
  inspectToggle?.classList.toggle("is-active", active);
  inspectToggle?.setAttribute("aria-pressed", String(active));
}

// Build the shell immediately -- nav, info pages, and sidebar panels don't
// require the SDK to be ready.
const sidebar = createSidebar(document.body, {
  // Keep the inspect button enabled/disabled in sync with the layers on the map.
  onViewsChanged(count) {
    if (!inspectToggle) return;
    inspectToggle.disabled = count === 0;
    if (count === 0 && isInspectionActive()) setInspectionMode(false);
  },
});
buildSiteInspectorPanel();
initBuildInfo();
initMapServiceRetry();

async function startMapX() {
  let stopAutoRetry = () => {};
  const showMapFailure = () => {
    showMapServiceNotice();
    stopAutoRetry();
    stopAutoRetry = startMapServiceRetryCountdown();
  };

  let mapx;
  try {
    await loadMapXSdk();
    mapx = initSDK(document.getElementById("mapx"), PRIMARY_PROJECT);
  } catch (error) {
    console.error("MapX SDK startup failed:", error);
    showMapFailure();
    return;
  }

  // The budget only runs while the map is actually on screen, so reaching this
  // really does mean MapX had its full loading time and never answered.
  const cancelReadyTimeout = watchForMapReady(() => {
    console.error("MapX did not become ready within the expected loading time (30s of visible loading)");
    showMapFailure();
  });

  initInspection(mapx);

  onInspectionResult((result) => {
    showSiteInspector(result);
  });

  // Wire inspect toggle button
  if (inspectToggle) {
    inspectToggle.addEventListener("click", () => setInspectionMode(!isInspectionActive()));
  }

  mapx.on("ready", async () => {
    cancelReadyTimeout();
    stopAutoRetry();
    hideMapServiceNotice();
    setSDKReady(true);

    try {
      // Hide all MapX native UI chrome (notifications, controls panel, main panel,
      // toolbar buttons) — we provide our own sidebar and tool controls.
      await mapx.ask("set_immersive_mode", { enable: true });

      // Enable click-to-inspect on vector features in the map
      await mapx.ask("set_vector_highlight", { enable: true });

      // Restore any layers encoded in the URL hash (e.g. shared link)
      await sidebar.restoreFromUrl();
    } catch (err) {
      console.error("MapX ready-handler setup failed:", err);
    }

    // Enable the inspect button only if layers are already open (e.g. hash restore).
    if (inspectToggle) inspectToggle.disabled = store.openViews.size === 0;
  });

  // Route click_attributes based on inspection mode.
  // When active: batch-collect events and show site inspector.
  // When inactive: show the basic infobox (legacy behaviour).
  mapx.on("click_attributes", (...args) => {
    let data = args.length === 1 ? args[0] : null;
    if (!data && args.length > 0) {
      data = { attributes: args };
    }
    if (!data) return;

    if (isInspectionActive()) {
      handleClickEvent(data, store.openViews);
    } else {
      showInfobox(data);
    }
  });
}

startMapX();
