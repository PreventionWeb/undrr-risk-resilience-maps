/**
 * Waiting helpers for the jsdom suites, written so a busy machine cannot turn a
 * correct test red.
 *
 * Two things make these DOM suites sensitive to load. Every `await` costs an
 * event-loop turn, and a turn that costs 0.1 ms on an idle machine can cost
 * tens of milliseconds on one that is saturated; and `vi.waitFor`'s default
 * budget is a 1000 ms wall clock that does not grow with the machine. A test
 * that chains a few dozen turns then fails for no reason but the load, and a
 * different test fails each run. See unisdr/undrr-risk-resilience-maps#15.
 *
 * So: wait for the outcome, with a budget that has room, and never use a fixed
 * number of ticks as a stand-in for "everything has settled".
 */
import { vi } from "vitest";

/**
 * The budget for one wait. Ten seconds is absurd for work that takes under a
 * millisecond when the machine is idle — which is the point: the wait ends when
 * the outcome arrives, so the budget only has to cover the worst scheduling
 * delay we are willing to tolerate, and a failing assertion is reported by the
 * last error `vi.waitFor` saw either way.
 */
export const WAIT_TIMEOUT_MS = 10_000;

/**
 * `vi.waitFor` with that budget: poll until the callback stops throwing.
 *
 * @param {() => unknown} callback - assertions that hold once the outcome has arrived
 * @param {{ timeout?: number, interval?: number }} [options]
 */
export function waitFor(callback, options = {}) {
  return vi.waitFor(callback, { timeout: WAIT_TIMEOUT_MS, ...options });
}

/** One macrotask, for letting queued work run at all. */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Wait until the thing `snapshot` describes stops changing.
 *
 * For assertions about what did *not* happen — no extra history entry, no
 * second render, no further SDK call — there is no outcome to wait for, so the
 * test has to wait for quiet instead. A fixed `await tick()` is a guess at how
 * many turns the work needs; this keeps taking turns until the snapshot has
 * been the same `stableTurns` times running, which is the same guess on an idle
 * machine and a correct one on a loaded machine.
 *
 * @param {() => unknown} snapshot - anything JSON-serialisable that the pending work would change
 * @param {{ stableTurns?: number, timeout?: number }} [options]
 */
export async function settle(snapshot, { stableTurns = 3, timeout = WAIT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeout;
  let previous = null;
  let stable = 0;
  while (stable < stableTurns) {
    await tick();
    const current = JSON.stringify(snapshot() ?? null);
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    if (Date.now() > deadline) {
      throw new Error(`settle() timed out after ${timeout}ms; last snapshot: ${current}`);
    }
  }
}
