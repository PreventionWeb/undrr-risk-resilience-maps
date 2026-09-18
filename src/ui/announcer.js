/**
 * One polite live region for layer announcements.
 *
 * A layer can have several rows in one sidebar — its own tab's full row and a
 * compact row in every other tab's cross-tab section — and all of them render
 * the same store record. When each row owned a live region, a screen reader
 * heard "Could not load Population. It is off." once per row.
 *
 * So the sidebar owns one region per instance and the rows announce through it.
 * The alternative, letting only the row in the visible tab speak, drops the
 * message entirely in two cases the rows cannot see: while an information page
 * is shown no row is visible at all, and a cross-tab row's region sits inside a
 * collapsed `<details>`, which is not rendered and so never announced.
 *
 * `announce(key, message, record)` takes the record the message was derived
 * from, which is how it tells a repeat from a duplicate: every row of a layer is
 * handed the *same* record object by the store, so a message already said for
 * that record is the second row saying it again and is dropped, while the same
 * failure happening again arrives with a new record and is announced again.
 * A record can carry more than one message (a call that settled into a failure
 * clears the busy sentence and then says what went wrong), so each record's
 * messages are remembered as a set rather than as the last one. A call that
 * passes no record is always a new event: two unrelated events would otherwise
 * both compare equal on `undefined` and the second would be dropped.
 *
 * **One region, several layers.** Because the region is shared, two layers can
 * have something to say at the same time (two failing together, or a shared
 * link restoring both while MapX is down). Writing each message over the last
 * one would leave the region holding only the newest, and the earlier one would
 * very likely never be spoken. So the region carries *every* layer's current
 * message at once, joined oldest first, and a layer's message is removed from
 * the line when that layer's call settles. That also means a layer settling
 * cannot wipe another layer's standing "Loading…", whichever of the two settles
 * first: the remaining messages are written back. A clear writes only when it
 * changes the line, so removing a message no layer was carrying does not
 * re-speak what is still there.
 *
 * The region has no id (several instances may live in one page), is
 * `mg-u-sr-only`, and is created by a factory with nothing running on import.
 * It is a `role="status"` region, as rc.2's own `switch-pending.js` uses, so
 * assistive technology treats it as a status line rather than a bare live node.
 * The visible half of a message stays per row: its `.layer-error` line.
 */

/**
 * Create a live region and the rule for writing to it.
 * @param {Document} [doc] - the document to create the element in
 * @returns {{
 *   element: HTMLElement,
 *   announce: (key: string, message: string, record?: object) => boolean,
 *   destroy: () => void,
 * }}
 */
export function createLayerAnnouncer(doc = document) {
  const element = doc.createElement("p");
  element.className = "layer-announcer mg-u-sr-only";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  /** layer key → {record, messages} already said for that record. */
  const said = new Map();
  /**
   * layer key → the message the region is currently carrying for that layer,
   * in the order the messages arrived (a Map keeps insertion order, and a
   * re-announced layer is re-inserted so its newest message reads last).
   */
  const standing = new Map();

  /** The whole line: every layer's current message, oldest first. */
  const line = () => [...standing.values()].join(" ");

  return {
    element,

    /**
     * Announce a layer's message, unless this is another row repeating what has
     * already been said for the same record. An empty message drops this
     * layer's message from the line, leaving any other layer's in place; a new
     * message is added to the end of the line.
     * @param {string} key - the layer the message is about
     * @param {string} message - "" to drop this layer's message
     * @param {object} [record] - the layers-store record it was derived from;
     *   a call without one is always treated as a new event
     * @returns {boolean} whether the region was written to
     */
    announce(key, message, record) {
      const last = said.get(key);
      if (record !== undefined && last && last.record === record) {
        if (last.messages.has(message)) return false;
        last.messages.add(message);
      } else {
        said.set(key, { record, messages: new Set([message]) });
      }
      standing.delete(key);
      if (message === "") {
        // Only a real change is written: a layer whose message was never in the
        // line must not cause another layer's message to be spoken again.
        const next = line();
        if (next === element.textContent) return false;
        element.textContent = next;
        return true;
      }
      standing.set(key, message);
      // Assigned even when the line is unchanged: a failure that happens again
      // is a new event, and a live region only speaks when its content changes.
      element.textContent = line();
      return true;
    },

    /** Forget what was said and take the region out of the page. */
    destroy() {
      said.clear();
      standing.clear();
      element.remove();
    },
  };
}
