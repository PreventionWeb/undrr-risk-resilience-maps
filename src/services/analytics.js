/**
 * Analytics events, and where they go.
 *
 * **The repository has no analytics platform yet.** `docs/resourcing-plan.md`
 * lists "add UNDRR-approved analytics (Matomo or equivalent — check UNDRR's
 * existing analytics platform before adding anything new)" as production work,
 * and nothing in `src/` loads a tracker today. So this module defines the event
 * shape and a sink that only writes to the console at debug level; adopting a
 * real platform is one function — pass a `sink` that forwards to it.
 *
 * The maintainer asked for one thing specifically (docs/embedding.md, answer 7):
 * record that an embed loaded, and which host it is running in. Inside a
 * cross-origin iframe `window.parent.location` is unreadable, so the host is
 * taken from `document.referrer`'s origin, which is the only thing the browser
 * will tell us. It can be absent (a strict `Referrer-Policy`, or the embed
 * opened directly), and then the host is reported as `null` rather than guessed.
 *
 * Factory, no singleton, nothing on import, no globals.
 */

/** The embed-loaded event's name. */
export const EMBED_LOADED = "embed_loaded";

/**
 * The origin of the page an embed is framed in, from `document.referrer`.
 * `null` when the browser did not send one, or it is not an http(s) URL.
 * @param {string|null|undefined} referrer
 * @returns {string|null}
 */
export function hostOrigin(referrer) {
  if (!referrer || typeof referrer !== "string") return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin && url.origin !== "null" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The default sink: a console record, so the event is observable in a browser
 * and in the E2E suite without pretending a platform exists.
 * @param {{ name: string, props: object }} event
 */
export function debugSink(event) {
  console.debug("[analytics]", event.name, event.props);
}

/**
 * @param {object} [options]
 * @param {(event: { name: string, props: object }) => void} [options.sink] -
 *   where events go (default: `debugSink`). Pass `() => {}` to drop them.
 * @returns {{ track(name: string, props?: object): void }}
 */
export function createAnalytics({ sink = debugSink } = {}) {
  return {
    /**
     * Record an event. Never throws: a broken tracker must not break the map.
     * @param {string} name
     * @param {object} [props]
     */
    track(name, props = {}) {
      try {
        sink({ name, props });
      } catch (error) {
        console.warn(`Analytics sink failed for "${name}":`, error);
      }
    },
  };
}

/**
 * The properties of an `embed_loaded` event.
 * @param {object} context
 * @param {string|null|undefined} context.referrer - `document.referrer`
 * @param {string} context.tab - the tab the embed opened on
 * @param {string[]} context.layers - the layer keys it opened with
 * @param {boolean} context.framed - is it actually inside a frame?
 * @returns {{ host: string|null, framed: boolean, tab: string, layers: string[] }}
 */
export function embedLoadedProps({ referrer, tab, layers, framed }) {
  return { host: hostOrigin(referrer), framed: Boolean(framed), tab, layers: [...layers] };
}
