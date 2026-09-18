import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapWarming, shouldWarmUpMap, supportsInert } from "./map-warming.js";
import { canMapLoad, isMapOnScreen } from "../sdk/availability.js";

/** Let a MutationObserver deliver its records. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUpPage() {
  document.body.innerHTML = `
    <a href="#app-map" class="mg-skip-link" data-ui="skip-link">Skip to map</a>
    <div id="info-page" data-ui="info-page"></div>
    <div class="app-map" id="app-map" data-ui="app-map" tabindex="-1">
      <div id="mapx"></div>
      <div id="sidebar"><button id="panel-toggle" type="button"></button></div>
    </div>
  `;
  return {
    appMap: document.getElementById("app-map"),
    skipLink: document.querySelector('[data-ui="skip-link"]'),
    infoTarget: document.getElementById("info-page"),
  };
}

describe("map warm-up state", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders the map out of reach while an information page is shown", () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });

    warming.set(true);

    expect(appMap.classList.contains("is-warming")).toBe(true);
    expect(appMap.getAttribute("aria-hidden")).toBe("true");
    expect(appMap.hasAttribute("inert")).toBe(true);
    expect([...appMap.children].every((el) => el.hasAttribute("inert"))).toBe(true);
    // Rendered, so MapX keeps loading.
    expect(appMap.style.display).toBe("");
    expect(canMapLoad(document)).toBe(true);
    // But not the view the user is on.
    expect(isMapOnScreen(document)).toBe(false);
  });

  it("hands the map back when a data tab is opened", () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });

    warming.set(true);
    warming.set(false);

    expect(appMap.classList.contains("is-warming")).toBe(false);
    expect(appMap.hasAttribute("aria-hidden")).toBe(false);
    expect(appMap.hasAttribute("inert")).toBe(false);
    expect([...appMap.children].some((el) => el.hasAttribute("inert"))).toBe(false);
    expect(skipLink.hidden).toBe(false);
    expect(isMapOnScreen(document)).toBe(true);
  });

  // Finding 1: Mangrove's preview-access.js removes `inert` from every direct
  // child of <body> when the PIN is accepted, `#app-map` is one of them, and
  // nothing upstream puts it back.
  it("re-asserts inert after the preview gate strips it", async () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });
    warming.set(true);

    for (const child of document.body.children) child.removeAttribute("inert");
    appMap.removeAttribute("aria-hidden");
    await flush();

    expect(appMap.hasAttribute("inert")).toBe(true);
    expect(appMap.getAttribute("aria-hidden")).toBe("true");
  });

  // Finding 2: buildSiteInspectorPanel() appends its panel after createSidebar()
  // has already switched to the home tab, so it missed the initial pass.
  it("makes a child appended after the warm-up started inert", async () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });
    warming.set(true);

    const panel = document.createElement("div");
    panel.id = "site-inspector";
    panel.innerHTML = `<button type="button">Copy</button>`;
    appMap.append(panel);
    await flush();

    expect(panel.hasAttribute("inert")).toBe(true);
  });

  it("stops re-asserting once the map is handed back", async () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });
    warming.set(true);
    warming.set(false);

    const panel = document.createElement("div");
    appMap.append(panel);
    await flush();

    expect(panel.hasAttribute("inert")).toBe(false);
    expect(appMap.hasAttribute("inert")).toBe(false);
  });

  // Finding 1 (second half): the skip link's target is `#app-map`, which has
  // `tabindex="-1"`, so Enter on it put focus inside the invisible region. It is
  // also the page's only bypass-blocks mechanism, so it is re-pointed at the
  // information page rather than hidden.
  it("points the skip link at the information page while that is the view", () => {
    const { appMap, skipLink, infoTarget } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, infoTarget, inertSupported: true });

    warming.set(true);
    expect(skipLink.hidden).toBe(false);
    expect(skipLink.getAttribute("href")).toBe("#info-page");
    expect(skipLink.textContent).toBe("Skip to content");
    // A fragment link only moves focus to something focusable.
    expect(infoTarget.getAttribute("tabindex")).toBe("-1");

    warming.set(false);
    expect(skipLink.hidden).toBe(false);
    expect(skipLink.getAttribute("href")).toBe("#app-map");
    expect(skipLink.textContent).toBe("Skip to map");
  });

  it("hides the skip link when there is no information page to point it at", () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });

    warming.set(true);
    expect(skipLink.hidden).toBe(true);
    expect(skipLink.getAttribute("href")).toBe("#app-map");

    warming.set(false);
    expect(skipLink.hidden).toBe(false);
  });

  // Finding 3: `pointer-events: none` covers the pointer only, so without
  // `inert` the map's controls stay tab stops inside an invisible overlay.
  it("hides the map outright where inert is unsupported", () => {
    const { appMap, skipLink } = setUpPage();
    const warming = createMapWarming(appMap, { skipLink, inertSupported: false });

    warming.set(true);

    expect(appMap.style.display).toBe("none");
    expect(appMap.classList.contains("is-warming")).toBe(false);
    // Nothing inside an element that is not rendered can be tabbed to, and
    // the ready budget is not spent on a map that cannot load.
    expect(canMapLoad(document)).toBe(false);
    expect(isMapOnScreen(document)).toBe(false);

    warming.set(false);
    expect(appMap.style.display).toBe("");
    expect(canMapLoad(document)).toBe(true);
  });

  it("detects inert support from the window", () => {
    expect(supportsInert({ HTMLElement: { prototype: { inert: false } } })).toBe(true);
    expect(supportsInert({ HTMLElement: { prototype: {} } })).toBe(false);
    expect(supportsInert({})).toBe(false);
  });

  describe("gating", () => {
    it("skips the warm-up when it is not worth its cost", () => {
      const { appMap, skipLink } = setUpPage();
      const warming = createMapWarming(appMap, {
        skipLink,
        inertSupported: true,
        shouldWarmUp: () => false,
      });

      warming.set(true);

      expect(appMap.style.display).toBe("none");
      expect(appMap.classList.contains("is-warming")).toBe(false);
      // Still out of reach, and still handed back on a data tab.
      expect(appMap.getAttribute("aria-hidden")).toBe("true");
      expect(canMapLoad(document)).toBe(false);

      warming.set(false);
      expect(appMap.style.display).toBe("");
    });

    it("declines on save-data, slow connections, narrow viewports and coarse pointers", () => {
      const media = (matched) => (query) => ({ matches: query === matched });

      expect(shouldWarmUpMap({ navigator: {} })).toBe(true);
      expect(shouldWarmUpMap({ navigator: { connection: { saveData: true } } })).toBe(false);
      expect(shouldWarmUpMap({ navigator: { connection: { effectiveType: "2g" } } })).toBe(false);
      expect(shouldWarmUpMap({ navigator: { connection: { effectiveType: "slow-2g" } } })).toBe(false);
      expect(shouldWarmUpMap({ navigator: { connection: { effectiveType: "4g" } } })).toBe(true);
      expect(shouldWarmUpMap({ navigator: {}, matchMedia: media("(max-width: 768px)") })).toBe(false);
      expect(shouldWarmUpMap({ navigator: {}, matchMedia: media("(pointer: coarse)") })).toBe(false);
      expect(shouldWarmUpMap({ navigator: {}, matchMedia: media("(prefers-color-scheme: dark)") })).toBe(
        true,
      );
    });

    it("waits for an idle moment before it starts loading", () => {
      const { appMap, skipLink, infoTarget } = setUpPage();
      let idleTask = null;
      const warming = createMapWarming(appMap, {
        skipLink,
        infoTarget,
        inertSupported: true,
        schedule: (task) => {
          idleTask = task;
          return vi.fn();
        },
      });

      warming.set(true);
      // Nothing is loading until the browser is idle.
      expect(appMap.style.display).toBe("none");
      expect(appMap.classList.contains("is-warming")).toBe(false);

      idleTask();
      expect(appMap.style.display).toBe("");
      expect(appMap.classList.contains("is-warming")).toBe(true);
    });

    it("gives a pending warm-up up on a data tab", () => {
      const { appMap, skipLink, infoTarget } = setUpPage();
      const cancel = vi.fn();
      const warming = createMapWarming(appMap, {
        skipLink,
        infoTarget,
        inertSupported: true,
        schedule: () => cancel,
      });

      warming.set(true);
      warming.set(false);
      expect(cancel).toHaveBeenCalled();
    });

    // Finding 4: `cancelIdleCallback` is optional, so a browser can have
    // `requestIdleCallback` without a way to cancel. The task itself has to know
    // it is stale, or it re-applies the warming state -- here, while the map is
    // the current view, leaving an invisible inert map on a data tab.
    it("does nothing when a cancelled warm-up runs anyway", () => {
      const { appMap, skipLink, infoTarget } = setUpPage();
      let idleTask = null;
      const warming = createMapWarming(appMap, {
        skipLink,
        infoTarget,
        inertSupported: true,
        // A browser without `cancelIdleCallback`: nothing can stop the task.
        schedule: (task) => {
          idleTask = task;
          return () => {};
        },
      });

      warming.set(true);
      warming.set(false);
      idleTask();

      expect(appMap.classList.contains("is-warming")).toBe(false);
      expect(appMap.hasAttribute("inert")).toBe(false);
      expect(appMap.hasAttribute("aria-hidden")).toBe(false);
      expect(isMapOnScreen(document)).toBe(true);
    });
  });

  // Finding 2: `renderTab` calls this on every tab change, information page to
  // information page included. Starting over hid the map and re-scheduled behind
  // `requestIdleCallback`, so Home to Sources to About stalled MapX -- up to 2s
  // with no map rendered -- on every click.
  it("keeps one warm-up running across information-page navigations", async () => {
    const { appMap, skipLink, infoTarget } = setUpPage();
    let scheduled = 0;
    let idleTask = null;
    const cancel = vi.fn();
    const warming = createMapWarming(appMap, {
      skipLink,
      infoTarget,
      inertSupported: true,
      schedule: (task) => {
        scheduled += 1;
        idleTask = task;
        return cancel;
      },
    });

    warming.set(true);
    idleTask();
    expect(appMap.classList.contains("is-warming")).toBe(true);

    // Home -> Sources -> About.
    warming.set(true);
    warming.set(true);

    // Still rendered, still loading, and not scheduled again.
    expect(appMap.style.display).toBe("");
    expect(appMap.classList.contains("is-warming")).toBe(true);
    expect(canMapLoad(document)).toBe(true);
    expect(scheduled).toBe(1);
    expect(cancel).not.toHaveBeenCalled();

    // The invariants the observer holds are untouched by the extra calls.
    expect(appMap.hasAttribute("inert")).toBe(true);
    expect(appMap.getAttribute("aria-hidden")).toBe("true");
    const panel = document.createElement("div");
    appMap.append(panel);
    await flush();
    expect(panel.hasAttribute("inert")).toBe(true);
  });

  // The one thing a repeated call must still act on: the gate can answer
  // differently than it did at the last tab change (a window dragged across
  // 768px), and "don't restart the warm-up" must not mean "never stop it".
  it("acts on a gate that answers differently at the next information page", () => {
    const { appMap, skipLink, infoTarget } = setUpPage();
    let wanted = true;
    let idleTask = null;
    const warming = createMapWarming(appMap, {
      skipLink,
      infoTarget,
      inertSupported: true,
      shouldWarmUp: () => wanted,
      schedule: (task) => {
        idleTask = task;
        return () => {};
      },
    });

    warming.set(true);
    idleTask();
    expect(appMap.classList.contains("is-warming")).toBe(true);

    // The window is now phone-sized: the next information page hides the map.
    wanted = false;
    warming.set(true);
    expect(appMap.classList.contains("is-warming")).toBe(false);
    expect(appMap.style.display).toBe("none");
    expect(canMapLoad(document)).toBe(false);
    // Still out of reach while it is hidden.
    expect(appMap.hasAttribute("inert")).toBe(true);

    // And back again.
    wanted = true;
    warming.set(true);
    idleTask();
    expect(appMap.classList.contains("is-warming")).toBe(true);
    expect(appMap.style.display).toBe("");
  });

  it("leaves the page as it found it", () => {
    const { appMap, skipLink } = setUpPage();
    skipLink.hidden = true;
    const warming = createMapWarming(appMap, { skipLink, inertSupported: true });

    warming.set(true);
    warming.destroy();

    expect(appMap.classList.contains("is-warming")).toBe(false);
    expect(appMap.style.display).toBe("");
    expect(appMap.hasAttribute("inert")).toBe(false);
    expect(appMap.hasAttribute("aria-hidden")).toBe(false);
    expect(skipLink.hidden).toBe(true);
  });
});
