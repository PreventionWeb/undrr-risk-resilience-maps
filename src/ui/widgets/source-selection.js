/**
 * Shared selection state for source-switching widgets.
 *
 * Widgets show a new selection immediately, but the switch is async and may
 * be rejected (another switch is in flight) or fail. `onSourceChange` resolves
 * to `false` in those cases; the widget then shows the source that is actually
 * on the map (or still loading) instead of drifting from it.
 *
 * @param {number} initialIndex
 * @param {(index: number) => boolean|void|Promise<boolean|void>} onSourceChange
 * @returns {(index: number) => Promise<number>} resolves to the index to show
 */
export function createSourceSelection(initialIndex, onSourceChange) {
  let confirmedIndex = initialIndex;
  let inFlightIndex = null;

  return async function select(index) {
    const owns = inFlightIndex === null;
    if (owns) inFlightIndex = index;

    let accepted;
    try {
      accepted = (await onSourceChange(index)) !== false;
    } catch {
      accepted = false;
    }

    if (owns) inFlightIndex = null;
    if (accepted) confirmedIndex = index;
    return accepted ? index : (inFlightIndex ?? confirmedIndex);
  };
}
