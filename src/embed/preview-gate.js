/**
 * Is the Mangrove preview gate still locked, and when does it open?
 *
 * `embed.html` carries the same `data-mg-preview-access` gate as `index.html`
 * (same id, same PIN), because publishing the embed to GitHub Pages publishes a
 * frameable, UNDRR-branded prototype to the whole web and Pages cannot send
 * `frame-ancestors`. The gate is Mangrove's: a stylesheet rule hides every child
 * of `<body>` (`visibility: hidden`) and marks them `inert` until
 * `preview-access.js` accepts the PIN and adds `mg-preview-access--unlocked` to
 * the gate element.
 *
 * The embed has to know about that state for one reason: the host message
 * bridge. A locked embed must not be drivable or readable over `postMessage` —
 * otherwise a host page could set tabs and layers on, and read the state of, a
 * prototype nobody has been let into. So the bridge reports `ready` with
 * `locked: true` (a host can then show its own message) and answers every
 * command with `error: locked` until this says otherwise.
 *
 * This module only *reads* the gate. It never unlocks it, never styles it and
 * never re-implements it: the class the Mangrove script adds is the single
 * source of truth, so a page with no gate element, or a gate already unlocked
 * from `sessionStorage`, is simply not locked.
 *
 * Nothing runs on import.
 */

/** The gate element Mangrove's `preview-access.js` looks for. */
export const GATE_SELECTOR = "[data-mg-preview-access]";

/** The class that script adds once the PIN is accepted. */
export const UNLOCKED_CLASS = "mg-preview-access--unlocked";

/**
 * Watch the preview gate in `doc`.
 *
 * @param {Document} [doc]
 * @returns {{
 *   readonly locked: boolean,
 *   onUnlock(fn: () => void): () => void,
 *   destroy(): void,
 * }}
 */
export function watchPreviewGate(doc = document) {
  const gate = doc.querySelector(GATE_SELECTOR);
  let locked = Boolean(gate) && !gate.classList.contains(UNLOCKED_CLASS);
  const listeners = new Set();
  let observer = null;

  function unlock() {
    if (!locked) return;
    locked = false;
    observer?.disconnect();
    observer = null;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("A preview-gate unlock listener failed:", error);
      }
    }
    listeners.clear();
  }

  const MutationObserverRef = doc.defaultView?.MutationObserver;
  if (locked && MutationObserverRef) {
    observer = new MutationObserverRef(() => {
      if (gate.classList.contains(UNLOCKED_CLASS)) unlock();
    });
    observer.observe(gate, { attributes: true, attributeFilter: ["class"] });
  }

  return {
    /** Is the page still behind the gate right now? */
    get locked() {
      return locked;
    },
    /**
     * Call `fn` when the gate opens. A gate that is already open never calls it,
     * so callers branch on `locked` first; the returned function unsubscribes.
     */
    onUnlock(fn) {
      if (!locked || typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      observer?.disconnect();
      observer = null;
      listeners.clear();
    },
  };
}
