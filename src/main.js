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
import { buildSidebar, restoreLayersFromHash } from "./ui/sidebar.js";
import { showInfobox } from "./ui/infobox.js";
import "./styles/shared.css";

// Fail fast if layer config has problems (typos, missing IDs, wrong project, etc.)
validateLayers(TABS, PRIMARY_PROJECT);

// Build the shell immediately -- nav, info pages, and sidebar panels don't
// require the SDK to be ready.
buildSidebar();

const mapx = initSDK(document.getElementById("mapx"), PRIMARY_PROJECT);

mapx.on("ready", async () => {
  setSDKReady(true);

  // Enable click-to-inspect on vector features in the map
  await mapx.ask("set_vector_highlight", { enable: true });

  // Restore any layers encoded in the URL hash (e.g. shared link)
  await restoreLayersFromHash();
});

// Normalize click_attributes payloads before passing to the infobox.
// The SDK emits varying arg shapes; always produce { attributes: ... }.
mapx.on("click_attributes", (...args) => {
  let data = args.length === 1 ? args[0] : null;
  if (!data && args.length > 0) {
    // Multi-arg form: treat as array of attribute objects
    data = { attributes: args };
  }
  showInfobox(data);
});
