/**
 * Shared selection state for source-switching widgets.
 *
 * Widgets show a new selection immediately, but the switch is async.
 * `onSourceChange` resolves to the source index the layer ends up on (the
 * layer controller applies the latest pick, or keeps the previous source if
 * the switch fails), and the widget shows that. `false` or a rejection means
 * the pick was not applied: the widget shows the last source it confirmed.
 * Any other result (e.g. `undefined`) accepts the pick.
 *
 * When picks overlap, an older pick that settles later shows the newest pick
 * (its index while in flight, its outcome once settled), so a slow earlier
 * pick never overwrites a later one.
 *
 * @param {number} initialIndex
 * @param {(index: number) => number|boolean|void|Promise<number|boolean|void>} onSourceChange
 * @returns {(index: number) => Promise<number>} resolves to the index to show
 */
export function createSourceSelection(initialIndex, onSourceChange) {
  let confirmedIndex = initialIndex;
  let latest = null;

  return async function select(index) {
    const pick = { index, shown: null };
    latest = pick;

    let result;
    try {
      result = await onSourceChange(index);
    } catch {
      result = false;
    }

    if (Number.isInteger(result)) confirmedIndex = result;
    else if (result !== false) confirmedIndex = index;
    pick.shown = confirmedIndex;

    return latest === pick ? pick.shown : (latest.shown ?? latest.index);
  };
}
