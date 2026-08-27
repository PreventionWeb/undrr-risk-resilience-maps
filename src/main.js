/**
 * App entry point.
 *
 * Builds the sidebar UI immediately (nav, info pages), then initialises the
 * MapX SDK iframe. Layer-specific operations (add/remove views, feature
 * inspection, hash restore) are gated on the SDK "ready" event.
 */
import { initSDK, setSDKReady } from "./sdk/client.js";
import { TABS, PRIMARY_PROJECT } from "./config/layers.js";
import { validateLayers } from "./config/validate.js";
import { buildSidebar, restoreLayersFromHash, onViewsChanged } from "./ui/sidebar.js";
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

// Build the shell immediately -- nav, info pages, and sidebar panels don't
// require the SDK to be ready.
buildSidebar();
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

  const cancelReadyTimeout = watchForMapReady(() => {
    console.error("MapX did not become ready within the expected time");
    showMapFailure();
  });

  initInspection(mapx);

  onInspectionResult((result) => {
    showSiteInspector(result);
  });

  // Wire inspect toggle button
  const inspectToggle = document.getElementById("inspect-toggle");
  if (inspectToggle) {
    inspectToggle.addEventListener("click", () => {
      if (isInspectionActive()) {
        disableInspection();
        hideSiteInspector();
        document.getElementById("app-map")?.classList.remove("inspection-active");
        inspectToggle.classList.remove("is-active");
        inspectToggle.setAttribute("aria-pressed", "false");
      } else {
        closeInfobox();
        enableInspection();
        document.getElementById("app-map")?.classList.add("inspection-active");
        inspectToggle.classList.add("is-active");
        inspectToggle.setAttribute("aria-pressed", "true");
      }
    });
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
      await restoreLayersFromHash();
    } catch (err) {
      console.error("MapX ready-handler setup failed:", err);
    }

    // Enable the inspect button only if layers are already open (e.g. hash restore).
    if (inspectToggle) inspectToggle.disabled = store.openViews.size === 0;

    // Keep inspect button enabled/disabled in sync with active layers.
    onViewsChanged((count) => {
      if (!inspectToggle) return;
      inspectToggle.disabled = count === 0;
      if (count === 0 && isInspectionActive()) {
        disableInspection();
        hideSiteInspector();
        document.getElementById("app-map")?.classList.remove("inspection-active");
        inspectToggle.classList.remove("is-active");
        inspectToggle.setAttribute("aria-pressed", "false");
      }
    });
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
