/**
 * MapX SDK Manager singleton.
 *
 * The SDK UMD script (loaded in HTML before this module) sets window.mxsdk.
 * We create one Manager per project, which embeds an iframe and communicates
 * via postMessage.
 */

let _mapx = null;
let _sdkReady = false;
// Listeners told when readiness flips, so UI that is disabled until the map
// can accept layer changes (the layer switches) can re-render itself.
const _readyListeners = new Set();

export function initSDK(container, projectId) {
  if (!window.mxsdk?.Manager) throw new Error("MapX SDK is unavailable");
  _mapx = new window.mxsdk.Manager({
    container,
    url: `https://app.mapx.org/?project=${projectId}`,
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
  titleMapXFrame(container);
  return _mapx;
}

/**
 * Name the iframe the SDK embeds.
 *
 * The Manager builds it itself and gives it no `title`, which axe reports as a
 * serious `frame-title` violation and which leaves screen-reader users with an
 * unnamed frame in the frames list. The element may not exist yet when the
 * Manager returns, so watch the container until it does.
 *
 * @param {HTMLElement|string} container - the element (or its id) the map is in
 */
function titleMapXFrame(container) {
  const host = typeof container === "string" ? document.getElementById(container) : container;
  if (!host) return;
  const title = "Interactive map (MapX)";
  const apply = () => {
    const frame = host.querySelector("iframe");
    if (!frame) return false;
    if (!frame.title) frame.title = title;
    return true;
  };
  if (apply()) return;
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(host, { childList: true, subtree: true });
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
