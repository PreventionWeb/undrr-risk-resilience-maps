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
 * MapX 1.14.2 takes `iframeTitle` in the Manager options, which initSDK()
 * passes. MapX 1.14.1 and earlier ignore it and build the iframe with no
 * `title`, which axe reports as a serious `frame-title` violation. This sets
 * the same title on those versions and leaves an existing one alone.
 *
 * MapX upstream: https://github.com/unep-grid/mapx/issues/1136.
 *
 * @param {HTMLElement|string} container - the element (or its id) the map is in
 * @returns {() => void} disposes the fallback watch (a no-op once it is done)
 */
export function titleMapXFrame(container) {
  const noop = () => {};
  const host = typeof container === "string" ? document.getElementById(container) : container;
  if (!host) return noop;
  const title = MAPX_FRAME_TITLE;
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

/**
 * The SDK version the Manager reports, e.g. "1.14.2-alpha.3" or "1.14.1".
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

/**
 * Whether a MapX version is at least `minimum`. Pre-release tags count as
 * their release ("1.14.2-alpha.3" satisfies "1.14.2"), since the alphas are
 * where the behaviour we gate on first appears.
 *
 * @param {string|null|undefined} version
 * @param {string} minimum - "major.minor.patch"
 * @returns {boolean} false when the version is missing or unparseable
 */
export function isMapXAtLeast(version, minimum) {
  const parse = (v) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");
    return match ? match.slice(1).map(Number) : null;
  };
  const have = parse(version);
  const want = parse(minimum);
  if (!have || !want) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
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
