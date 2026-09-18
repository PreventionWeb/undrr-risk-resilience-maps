/**
 * In-memory state adapter: the same `read/write/subscribe/destroy` contract as
 * `hash-adapter.js` (see docs/embedding.md §3), holding state in a closure
 * instead of in `location`.
 *
 * This is what makes the iframe embed safe to drop into someone else's page:
 * the embed's router reads and writes state through this, so nothing the user
 * does inside the frame touches the **host tab's** URL or its joint session
 * history (blocker B5). It is also the adapter unit tests use, because it needs
 * no jsdom `location` and no history stack.
 *
 * `subscribe()` exists to satisfy the contract and never fires: an in-memory URL
 * has no back button and nothing outside the instance can change it. A host
 * command is not an external URL change either -- it arrives through
 * `createRiskMap().setState()`, which hands it to `router.applyState()`. So the
 * embed and the standalone app share one reconcile path instead of the embed
 * having a pushed-subscription path of its own (a deliberate simplification of
 * the doc's `postMessageAdapter` sketch; see docs/embedding.md).
 *
 * Nothing runs on import, and the module holds no state: every call returns a
 * fresh adapter.
 */

/** A defensive copy, so a caller cannot mutate the adapter's state in place. */
function cloneState({ tab = null, layers = [] } = {}) {
  return {
    tab: tab ?? null,
    layers: layers.map(({ key, sourceIdx = 0, settings }) =>
      settings ? { key, sourceIdx, settings } : { key, sourceIdx },
    ),
  };
}

/**
 * @param {object} [options]
 * @param {{ tab?: string|null, layers?: Array<{key: string, sourceIdx?: number, settings?: object}> }} [options.initial] -
 *   the state `read()` returns before anything is written
 * @returns {{
 *   read(): { tab: string|null, layers: Array<object> },
 *   write(state: object, options?: { replace?: boolean }): void,
 *   subscribe(fn: (state: object) => void): () => void,
 *   destroy(): void,
 * }}
 */
export function createMemoryAdapter({ initial } = {}) {
  let state = cloneState(initial);
  let destroyed = false;

  const read = () => cloneState(state);

  return {
    /** Current state (a copy). */
    read,

    /**
     * Store `state`. `replace` is part of the contract and meaningless here:
     * there is no history to push onto, which is the entire point of this
     * adapter, so it is accepted and ignored.
     */
    write(next) {
      if (destroyed) return;
      state = cloneState(next);
    },

    /**
     * Part of the contract; never called back. See the module comment: nothing
     * outside the instance can change an in-memory URL.
     * @returns {() => void} unsubscribe
     */
    subscribe() {
      return () => {};
    },

    /** Later writes are ignored; reads still answer with the last state. */
    destroy() {
      destroyed = true;
    },
  };
}
