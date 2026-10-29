/**
 * MapX SDK Manager singleton.
 *
 * The SDK UMD script (loaded in HTML before this module) sets window.mxsdk.
 * We create one Manager per project, which embeds an iframe and communicates
 * via postMessage.
 */
import { getMapXBaseUrl } from "./availability.js";

export const MAPX_FRAME_TITLE = "Interactive map";

let _mapx = null;
let _sdkReady = false;
// Listeners told when readiness flips, so UI that is disabled until the map
// can accept layer changes (the layer switches) can re-render itself.
const _readyListeners = new Set();

export function initSDK(container, projectId, options = {}) {
  if (!window.mxsdk?.Manager) throw new Error("MapX SDK is unavailable");
  const baseUrl = options.baseUrl ?? getMapXBaseUrl(typeof window !== "undefined" ? window : undefined);
  _mapx = new window.mxsdk.Manager({
    container,
    url: `${baseUrl}/?project=${projectId}`,
    iframeTitle: MAPX_FRAME_TITLE,
    params: {
      closePanels: true,
      language: "en",
      theme: "color_light",
    },
    style: {
      width: "100%",
      height: "100%",
      border: "none",
    },
  });
  return _mapx;
}

/**
 * The SDK version the Manager reports, e.g. "1.14.2".
 *
 * The UMD exposes no module-level version; it is a getter on the Manager
 * instance. Null before initSDK() or if the SDK stops reporting one.
 *
 * @returns {string|null}
 */
export function getMapXVersion() {
  const version = _mapx?.version;
  return typeof version === "string" ? version : null;
}

export function getSDK() {
  if (!_mapx) throw new Error("SDK not initialised -- call initSDK() first");
  return _mapx;
}

export function setSDKReady(ready) {
  if (_sdkReady === ready) return;
  _sdkReady = ready;
  for (const listener of [..._readyListeners]) {
    try {
      listener(ready);
    } catch (error) {
      console.warn("An SDK-ready listener failed:", error);
    }
  }
}

/**
 * Subscribe to readiness changes.
 * @param {(ready: boolean) => void} listener
 * @param {{ signal?: AbortSignal }} [options] - aborting it unsubscribes
 * @returns {() => void} unsubscribe
 */
export function onSDKReadyChange(listener, { signal } = {}) {
  _readyListeners.add(listener);
  const off = () => _readyListeners.delete(listener);
  signal?.addEventListener("abort", off, { once: true });
  return off;
}

export function isSDKReady() {
  return _sdkReady;
}
