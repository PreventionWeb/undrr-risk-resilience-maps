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
 * messages are remembered as a set rather than as the last one.
 *
 * The region has no id (several instances may live in one page), is
 * `mg-u-sr-only`, and is created by a factory with nothing running on import.
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
  element.setAttribute("aria-live", "polite");

  /** layer key → {record, messages} already said for that record. */
  const said = new Map();
  /** The layer whose message the region currently shows (null: none). */
  let owner = null;

  return {
    element,

    /**
     * Announce a layer's message, unless this is another row repeating what has
     * already been said for the same record. An empty message clears the region,
     * but only while it is still showing this layer's message: a layer settling
     * must not wipe another layer's "Loading…".
     * @param {string} key - the layer the message is about
     * @param {string} message - "" to clear
     * @param {object} [record] - the layers-store record it was derived from
     * @returns {boolean} whether the region was written to
     */
    announce(key, message, record) {
      const last = said.get(key);
      if (last && last.record === record) {
        if (last.messages.has(message)) return false;
        last.messages.add(message);
      } else {
        said.set(key, { record, messages: new Set([message]) });
      }
      if (message === "") {
        if (owner !== null && owner !== key) return false;
        owner = null;
        element.textContent = "";
        return true;
      }
      owner = key;
      // Assigned even when the text is unchanged: a failure that happens again
      // is a new event, and a live region only speaks when its content changes.
      element.textContent = message;
      return true;
    },

    /** Forget what was said and take the region out of the page. */
    destroy() {
      said.clear();
      owner = null;
      element.remove();
    },
  };
}
