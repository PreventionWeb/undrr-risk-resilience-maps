/**
 * URL-hash state adapter: the only way the UI reads, writes or watches the
 * hash. It wraps `hash.js` behind the `read/write/subscribe/destroy` contract
 * from docs/embedding.md, so an embed can swap in a memory or postMessage
 * adapter without the sidebar or the layers store knowing about `location`.
 *
 * State shape: `{ tab: string|null, layers: Array<{ key, sourceIdx, settings? }> }`.
 */
import { parseHash, writeHash } from "./hash.js";

/**
 * @param {{ target?: Window }} [options] - the window whose URL the adapter
 *   owns (default: the global window). Reads use `target.location`, writes use
 *   `target.location` and `target.history`, and `hashchange` is watched on
 *   `target`, so any object with those three works (e.g. an iframe's window).
 */
export function createHashAdapter({ target = window } = {}) {
  const unsubscribers = new Set();
  const read = () => parseHash({ location: target.location });

  return {
    /** Current URL state. */
    read,

    /**
     * Write state to the hash. Pushes a history entry unless `replace` is set;
     * a hash that is already current is left alone.
     */
    write({ tab, layers }, { replace = false } = {}) {
      writeHash(tab, layers, { replace, location: target.location, history: target.history });
    },

    /**
     * Call `fn(state)` on every `hashchange` (back/forward, links, typed URLs).
     * Classifying the change is up to the caller (see `hashChangeAction`).
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      const controller = new AbortController();
      target.addEventListener("hashchange", () => fn(read()), { signal: controller.signal });
      const unsubscribe = () => {
        controller.abort();
        unsubscribers.delete(unsubscribe);
      };
      unsubscribers.add(unsubscribe);
      return unsubscribe;
    },

    /** Remove every listener this adapter added. */
    destroy() {
      for (const unsubscribe of [...unsubscribers]) unsubscribe();
    },
  };
}
