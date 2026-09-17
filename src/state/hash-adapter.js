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
 * @param {{ target?: EventTarget }} [options] - where `hashchange` fires (default: window)
 */
export function createHashAdapter({ target = window } = {}) {
  const unsubscribers = new Set();

  return {
    /** Current URL state. */
    read: () => parseHash(),

    /**
     * Write state to the hash. Pushes a history entry unless `replace` is set;
     * a hash that is already current is left alone.
     */
    write({ tab, layers }, { replace = false } = {}) {
      writeHash(tab, layers, { replace });
    },

    /**
     * Call `fn(state)` on every `hashchange` (back/forward, links, typed URLs).
     * Classifying the change is up to the caller (see `hashChangeAction`).
     * @returns {() => void} unsubscribe
     */
    subscribe(fn) {
      const controller = new AbortController();
      target.addEventListener("hashchange", () => fn(parseHash()), { signal: controller.signal });
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
