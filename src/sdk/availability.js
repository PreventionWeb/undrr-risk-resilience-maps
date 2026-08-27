export const MAPX_SDK_URL = "https://app.mapx.org/sdk/mxsdk.umd.js";

const SDK_LOAD_TIMEOUT_MS = 15_000;
const SDK_READY_TIMEOUT_MS = 30_000;

export function loadMapXSdk({
  documentRef = document,
  windowRef = window,
  timeoutMs = SDK_LOAD_TIMEOUT_MS,
} = {}) {
  if (windowRef.mxsdk?.Manager) return Promise.resolve(windowRef.mxsdk);

  return new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve(windowRef.mxsdk);
    };

    const timeout = setTimeout(() => finish(new Error("MapX SDK load timed out")), timeoutMs);

    script.src = MAPX_SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (windowRef.mxsdk?.Manager) finish();
      else finish(new Error("MapX SDK did not initialise"));
    };
    script.onerror = () => finish(new Error("MapX SDK could not be loaded"));
    documentRef.head.appendChild(script);
  });
}

export function watchForMapReady(onTimeout, timeoutMs = SDK_READY_TIMEOUT_MS) {
  const timeout = setTimeout(onTimeout, timeoutMs);
  return () => clearTimeout(timeout);
}

export function showMapServiceNotice(documentRef = document) {
  const notice = documentRef.getElementById("map-service-notice");
  if (notice) notice.hidden = false;
}

export function hideMapServiceNotice(documentRef = document) {
  const notice = documentRef.getElementById("map-service-notice");
  if (notice) notice.hidden = true;
}

export function initMapServiceRetry(documentRef = document, locationRef = window.location) {
  documentRef.getElementById("map-service-retry")?.addEventListener("click", () => {
    locationRef.reload();
  });
}

export function startMapServiceRetryCountdown({
  documentRef = document,
  locationRef = window.location,
  seconds = 60,
  shouldCountDown = () =>
    documentRef.visibilityState !== "hidden" &&
    documentRef.getElementById("app-map")?.style.display !== "none",
} = {}) {
  const countdown = documentRef.getElementById("map-service-countdown");
  let remaining = seconds;

  const render = () => {
    if (countdown) {
      countdown.textContent = `Retrying in ${remaining} ${remaining === 1 ? "second" : "seconds"}`;
    }
  };

  render();
  const interval = setInterval(() => {
    if (!shouldCountDown()) return;
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      locationRef.reload();
      return;
    }
    render();
  }, 1_000);

  return () => clearInterval(interval);
}
