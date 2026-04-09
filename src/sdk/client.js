/**
 * MapX SDK Manager singleton.
 *
 * The SDK UMD script (loaded in HTML before this module) sets window.mxsdk.
 * We create one Manager per project, which embeds an iframe and communicates
 * via postMessage.
 */

let _mapx = null;
let _sdkReady = false;

export function initSDK(container, projectId) {
  /* global mxsdk */
  _mapx = new mxsdk.Manager({
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
  return _mapx;
}

export function getSDK() {
  if (!_mapx) throw new Error("SDK not initialised -- call initSDK() first");
  return _mapx;
}

export function setSDKReady(ready) {
  _sdkReady = ready;
}

export function isSDKReady() {
  return _sdkReady;
}
