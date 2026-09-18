/**
 * The map container's two states while an information page is shown.
 *
 * The map is never simply "hidden" behind an information page: MapX renders in
 * a cross-origin iframe that the browser throttles to a standstill unless it is
 * laid out inside the viewport, so hiding it means MapX only starts loading on
 * the first data-tab click. This module owns the alternative -- keeping the map
 * rendered but invisible and out of reach -- and everything that has to be true
 * for that to be safe:
 *
 * - **warming** (the default on a capable, unmetered, pointer-and-space device):
 *   `is-warming` in `layout.css` pins the map in the viewport and makes it
 *   `opacity: 0`; `aria-hidden` keeps screen readers out and `inert` keeps the
 *   pointer and the keyboard out, on the container *and* on each child.
 * - **hidden** (`display: none`, the pre-warm-up behaviour): used where `inert`
 *   is unsupported, or where the warm-up is not worth its cost. `canMapLoad()`
 *   then reports that the map cannot load, so the ready budget is not spent on
 *   a map that is not rendering.
 *
 * Three things make this harder than setting attributes once:
 *
 * 1. Mangrove's `preview-access.js` calls `removeAttribute("inert")` on **every
 *    direct child of `<body>`** when the PIN is accepted, and `#app-map` is one.
 *    Nothing upstream re-asserts it, so the container's `inert` disappears in
 *    the session in which the PIN is entered.
 * 2. Children appear after the warm-up starts (`buildSiteInspectorPanel()` runs
 *    after `createSidebar()`), and they are not covered by the container's
 *    `inert` once the gate has stripped it.
 * 3. `inert` is not everywhere: without it the layer switches, the collapse
 *    button, the inspect toggle and the MapX iframe would all be tab stops
 *    inside an invisible overlay.
 *
 * (1) and (2) are handled by a `MutationObserver` that re-asserts the state for
 * as long as the map is warming; (3) by the feature detection above.
 *
 * Three things this deliberately does not do:
 *
 * - **One container, one instance.** Like the availability predicates it shares
 *   `MAP_WARMING_CLASS` with, this assumes it is the only owner of the
 *   container's warm-up state. Two sidebars over one `#app-map` would fight:
 *   the warming one's observer re-asserts `inert` on the container the other
 *   has just handed back, and an instance constructed while the map is hidden
 *   captures `display: none` as the value to restore. A page with more than one
 *   sidebar root needs a map (and an availability watch) per root; `createSidebar`
 *   is public API, and the embedding guide's multiple-instance example is a
 *   single-map page.
 * - **Re-evaluate the gate between tab changes.** `shouldWarmUpMap()` is asked
 *   on every tab change, one information page to the next included, and a warm-up
 *   in flight is stopped (or started) when the answer has changed. It is not
 *   asked on resize or on a connection change, so a desktop window dragged down
 *   to phone width keeps warming until the next tab change. Conservative in the
 *   direction that matters (a narrow *first* view never warms up), and a
 *   `matchMedia` listener would have to unpick a warm-up already in flight.
 * - **Watch the subtree.** The observer watches the container's own attributes
 *   and child list, not the whole subtree: `inert` on the container covers
 *   every descendant, so only the container and its direct children need their
 *   own attribute, and a deeper node cannot become reachable on its own.
 */
import { MAP_WARMING_CLASS } from "../sdk/availability.js";

/** Connection types on which the warm-up's ~4.3 MB is not a fair trade. */
const SLOW_CONNECTIONS = ["slow-2g", "2g"];

/** Below this the map is not the desktop-sized main event, and data is likelier to be metered. */
const NARROW_VIEWPORT = "(max-width: 768px)";

/** A touch device: same reasoning, and it is where the WebGL context costs most. */
const COARSE_POINTER = "(pointer: coarse)";

/** How long the warm-up may wait for an idle moment before it happens anyway. */
const IDLE_TIMEOUT_MS = 2_000;

/** What "Skip to map" says while an information page, not the map, is the view. */
const SKIP_TO_CONTENT_LABEL = "Skip to content";

/**
 * Is the warm-up worth its cost here?
 *
 * Measured on `#home` over 25s without ever opening a data tab, the warm-up
 * costs +47 requests, +4.33 MB and +14 MB of JS heap on every visit, including
 * a bounce, and it multiplies load on `app.mapx.org` by the share of visitors
 * who never open a map. It buys 2.5-2.9s off the first data-tab click. That is
 * a good trade on a desktop on an unmetered connection, and a bad one for
 * someone who asked for less data or is on a phone.
 *
 * @param {Window} [windowRef]
 * @returns {boolean}
 */
export function shouldWarmUpMap(windowRef = window) {
  const connection = windowRef.navigator?.connection;
  if (connection?.saveData) return false;
  if (SLOW_CONNECTIONS.includes(connection?.effectiveType)) return false;
  // No `matchMedia` (jsdom): nothing says this is a small or touch screen.
  const matches = (query) => Boolean(windowRef.matchMedia?.(query)?.matches);
  if (matches(NARROW_VIEWPORT) || matches(COARSE_POINTER)) return false;
  return true;
}

/**
 * Does this browser implement `inert`? Safari before 15.5 and Firefox before
 * ~April 2023 do not, and `pointer-events: none` only covers the pointer there.
 *
 * @param {Window} [windowRef]
 * @returns {boolean}
 */
export function supportsInert(windowRef = window) {
  return "inert" in (windowRef.HTMLElement?.prototype ?? {});
}

/**
 * Run `task` when the browser is idle, so the warm-up's requests and WebGL
 * context do not compete with the information page the user is reading.
 * Browsers without `requestIdleCallback` (Safari before 17.4) run it now, which
 * is what every browser did before this was scheduled at all.
 *
 * @param {Window} windowRef
 * @returns {(task: () => void) => () => void} schedule, returning a canceller
 */
function idleScheduler(windowRef) {
  return (task) => {
    if (typeof windowRef?.requestIdleCallback !== "function") {
      task();
      return () => {};
    }
    const handle = windowRef.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    return () => windowRef.cancelIdleCallback?.(handle);
  };
}

/**
 * Own `appMap`'s warm-up state for the life of a sidebar.
 *
 * @param {HTMLElement} appMap - the map container (root-scoped `data-ui="app-map"`)
 * @param {object} [options]
 * @param {HTMLElement|null} [options.skipLink] - "Skip to map", re-pointed at
 *   the information page while that is the view
 * @param {HTMLElement|null} [options.infoTarget] - the information page the skip
 *   link points at while it is the view; without one (or without an `id` to
 *   link to) the link is hidden instead
 * @param {boolean} [options.inertSupported] - override the feature detection (tests)
 * @param {() => boolean} [options.shouldWarmUp] - override the gating (tests, embeds)
 * @param {(task: () => void) => () => void} [options.schedule] - override the
 *   idle scheduling (tests)
 * @returns {{ set(warming: boolean): void, destroy(): void }}
 */
export function createMapWarming(
  appMap,
  { skipLink = null, infoTarget = null, inertSupported, shouldWarmUp, schedule } = {},
) {
  const windowRef = appMap.ownerDocument?.defaultView ?? null;
  const inertOk = inertSupported ?? supportsInert(windowRef ?? {});
  const warmUpWanted = shouldWarmUp ?? (() => shouldWarmUpMap(windowRef ?? {}));
  const scheduleTask = schedule ?? idleScheduler(windowRef);
  const MutationObserverRef = windowRef?.MutationObserver ?? null;

  // Restored by destroy(), so the page is as the next instance finds it.
  const initialDisplay = appMap.style.display;
  const initialSkipLinkHidden = skipLink?.hidden;
  const initialSkipLinkHref = skipLink?.getAttribute("href");
  const initialSkipLinkLabel = skipLink?.textContent;
  // A fragment link only moves focus to something focusable, and the
  // information page is a plain `<div>`. Done here rather than in the markup so
  // an embed's own information container gets it too.
  const infoTargetId = infoTarget?.id || null;
  const addedInfoTabIndex = Boolean(infoTargetId) && !infoTarget.hasAttribute("tabindex");

  let cancelScheduled = null;
  let observer = null;
  let isWarming = false;
  // Is the warm-up itself scheduled or running? Distinct from `isWarming`,
  // which only says an information page is the view: the gate can decline, and
  // then the map is hidden rather than warming.
  let warmUpLive = false;
  // Bumped whenever a scheduled warm-up is given up on. `cancelIdleCallback` is
  // optional (a browser may have `requestIdleCallback` without it), so the task
  // has to be able to tell that it is stale rather than trusting the canceller:
  // running late, it would re-apply the warming state -- possibly while the map
  // is the current view, leaving an invisible, inert map on a data tab.
  let generation = 0;

  /**
   * Put `inert` and `aria-hidden` back wherever they are missing. Only ever
   * adds, and only when the attribute is not already as it should be, so it
   * cannot loop the observer: the guarded `setAttribute` calls below record no
   * mutation when there is nothing to change.
   */
  const assertOutOfReach = () => {
    if (!appMap.hasAttribute("inert")) appMap.setAttribute("inert", "");
    if (appMap.getAttribute("aria-hidden") !== "true") appMap.setAttribute("aria-hidden", "true");
    for (const child of appMap.children) {
      if (!child.hasAttribute("inert")) child.setAttribute("inert", "");
    }
  };

  const stopObserving = () => {
    observer?.disconnect();
    observer = null;
  };

  const startObserving = () => {
    if (observer || !MutationObserverRef) return;
    observer = new MutationObserverRef(assertOutOfReach);
    // `inert` and `aria-hidden` because the preview gate strips the first and
    // nothing guarantees the second; `childList` because a panel built after
    // the sidebar (the site inspector) would otherwise arrive reachable. No
    // `subtree`: the container's own `inert` covers every descendant, so a
    // deeper node cannot become reachable while the container's is in place.
    observer.observe(appMap, {
      attributes: true,
      attributeFilter: ["inert", "aria-hidden"],
      childList: true,
    });
  };

  const cancelPending = () => {
    generation += 1;
    cancelScheduled?.();
    cancelScheduled = null;
  };

  /**
   * The bypass-blocks mechanism, pointed at whatever the view actually is.
   *
   * The link is the page's only way past the header and the category nav, so
   * hiding it on the information pages would leave a keyboard user tabbing
   * through both every time with nothing to skip (WCAG 2.4.1). Instead it is
   * re-pointed at the information page while that is the view -- same safety,
   * since `#app-map` is then the invisible warm-up region, but it goes
   * somewhere useful. Without an information page to point at there is nothing
   * to offer, so it is hidden.
   *
   * @param {boolean} warming
   */
  const retargetSkipLink = (warming) => {
    if (!skipLink) return;
    if (!warming) {
      skipLink.hidden = false;
      if (initialSkipLinkHref !== null && initialSkipLinkHref !== undefined) {
        skipLink.setAttribute("href", initialSkipLinkHref);
      }
      if (initialSkipLinkLabel !== undefined) skipLink.textContent = initialSkipLinkLabel;
      if (addedInfoTabIndex) infoTarget.removeAttribute("tabindex");
      return;
    }
    if (!infoTargetId) {
      skipLink.hidden = true;
      return;
    }
    skipLink.hidden = false;
    skipLink.setAttribute("href", `#${infoTargetId}`);
    skipLink.textContent = SKIP_TO_CONTENT_LABEL;
    if (addedInfoTabIndex) infoTarget.setAttribute("tabindex", "-1");
  };

  /**
   * @param {boolean} warming - is an information page the view?
   */
  function set(warming) {
    if (!warming) {
      isWarming = false;
      warmUpLive = false;
      cancelPending();
      stopObserving();
      appMap.classList.remove(MAP_WARMING_CLASS);
      appMap.style.display = initialDisplay;
      appMap.removeAttribute("aria-hidden");
      appMap.removeAttribute("inert");
      for (const child of appMap.children) child.removeAttribute("inert");
      retargetSkipLink(false);
      return;
    }

    const wanted = inertOk && warmUpWanted();

    if (isWarming) {
      // Information page to information page is still the same warm-up.
      // Starting over would cancel it, hide the map and wait for another idle
      // moment -- up to 2s with MapX throttled to a standstill, which is the one
      // thing the warm-up exists to avoid, so browsing Home to Sources to About
      // would stall it on every click. Only a gate that now answers differently
      // (the window was resized across 768px since the last tab change) is
      // worth acting on.
      assertOutOfReach();
      if (wanted === warmUpLive) return;
    } else {
      // Out of reach first, and kept there: the map is about to be rendered
      // without being visible, which is the one state that could hand it back to
      // the pointer, the keyboard or a screen reader.
      assertOutOfReach();
      startObserving();
      retargetSkipLink(true);
      isWarming = true;
    }

    cancelPending();
    warmUpLive = wanted;

    // Not rendered yet: hidden until the warm-up is actually scheduled in, and
    // left hidden if it is not wanted here. `canMapLoad()` reads this inline
    // `display` and reports that MapX cannot make progress, so the ready
    // budget is not spent on a map that is not loading.
    appMap.classList.remove(MAP_WARMING_CLASS);
    appMap.style.display = "none";
    if (!wanted) return;

    const scheduledFor = generation;
    cancelScheduled = scheduleTask(() => {
      // Cancelled while this was queued, and the canceller may not exist.
      if (scheduledFor !== generation) return;
      cancelScheduled = null;
      appMap.style.display = initialDisplay;
      appMap.classList.add(MAP_WARMING_CLASS);
      // The class change is one more chance for a child to have appeared.
      assertOutOfReach();
    });
  }

  function destroy() {
    set(false);
    if (skipLink && initialSkipLinkHidden !== undefined) skipLink.hidden = initialSkipLinkHidden;
  }

  return { set, destroy };
}
