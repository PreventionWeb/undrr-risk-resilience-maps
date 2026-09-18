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
 * How long the fallback observer below is allowed to watch for the iframe.
 * The SDK appends it synchronously, so this budget should never be spent.
 */
export const FRAME_TITLE_WATCH_MS = 10000;

/**
 * Name the iframe the SDK embeds.
 *
 * The Manager builds it itself and gives it no `title`, which axe reports as a
 * serious `frame-title` violation and which leaves screen-reader users with an
 * unnamed frame in the frames list.
 *
 * `Manager._build()` appends the iframe inside the constructor, so the first
 * attempt below always succeeds today. The observer is cheap insurance against
 * that becoming asynchronous upstream, and it is bounded so it can never sit
 * watching the container for the life of the page if the iframe never arrives.
 *
 * @param {HTMLElement|string} container - the element (or its id) the map is in
 * @returns {() => void} disposes the fallback watch (a no-op once it is done)
 */
export function titleMapXFrame(container) {
  const noop = () => {};
  const host = typeof container === "string" ? document.getElementById(container) : container;
  if (!host) return noop;
  const title = "Interactive map (MapX)";
  const apply = () => {
    const frame = host.querySelector("iframe");
    if (!frame) return false;
    if (!frame.title) frame.title = title;
    return true;
  };
  if (apply()) return noop;

  let timer = null;
  const observer = new MutationObserver(() => {
    if (apply()) dispose();
  });
  const dispose = () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  observer.observe(host, { childList: true, subtree: true });
  timer = setTimeout(dispose, FRAME_TITLE_WATCH_MS);
  return dispose;
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
