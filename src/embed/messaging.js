/**
 * The versioned `postMessage` API between an embed and its host page
 * (docs/embedding.md §3, "Host ↔ iframe message schema (v1)").
 *
 * Every message, both ways, is
 *
 *   { type: "undrr-risk-map", v: 1, instance?, id?, name, payload }
 *
 * | direction    | name         | payload                                     |
 * | ------------ | ------------ | ------------------------------------------- |
 * | embed → host | `ready`      | `{ version, tabs, layers, locked }`         |
 * | embed → host | `state`      | `{ tab, layers }` after each settled change |
 * | embed → host | `error`      | `{ code, message }`                         |
 * | host → embed | `set-layers` | `{ tab?, layers }`                          |
 * | host → embed | `set-tab`    | `{ tab }`                                   |
 * | host → embed | `get-state`  | `{}` — answered by `state` with the same id  |
 *
 * ## Security model
 *
 * - **Outbound** messages are posted with an explicit `targetOrigin` — the
 *   configured parent origin — and never `"*"`. The browser then delivers them
 *   only if the real parent is that origin.
 * - **Inbound** messages are accepted only when `event.source === window.parent`
 *   *and* `event.origin` is the configured parent origin, the envelope is this
 *   protocol's, the version is one we speak, the `instance` (when either side
 *   names one) matches, and the payload validates. Anything else is ignored
 *   without throwing: an unrecognised message on the host page is normal traffic
 *   (analytics, video players, dev tools), not an error.
 * - **With no parent origin configured** — no `parentOrigin` parameter and no
 *   readable `document.referrer` (a strict referrer policy, or a directly opened
 *   embed page) — the bridge refuses in both directions: it posts nothing and
 *   accepts no command. The embed still works; it is simply not addressable. The
 *   host fixes it by adding `&parentOrigin=<its origin>` to the iframe `src`.
 * - The bridge exposes only the fields listed above. It never forwards config,
 *   DOM, errors from other modules or anything the table does not name.
 *
 * Nothing runs on import, and `destroy()` removes the one `message` listener.
 */

/** Envelope discriminator, so host pages can tell our traffic from everything else. */
export const MESSAGE_TYPE = "undrr-risk-map";

/** The protocol version this build speaks. */
export const MESSAGE_VERSION = 1;

/**
 * Names the embed sends.
 *
 * No `resize`: the schema carried an auto-sizing hint in the first draft of
 * phase 1, and it did nothing. The embed fills the frame (`min-height: 100dvh`),
 * so `root.scrollHeight` is the height the iframe already has — a host following
 * the hint received one message telling it what it had just set. Measuring
 * something a host could act on means measuring a content box that does not
 * exist for a map, so the honest version of the feature is not shipping it.
 * Hosts give the frame a height (docs/embedding.md §8).
 */
export const OUTBOUND = ["ready", "state", "error"];

/** Names the embed accepts. */
export const INBOUND = ["set-layers", "set-tab", "get-state"];

/** Largest accepted `id`, which is echoed back verbatim. */
const MAX_ID_LENGTH = 64;

/**
 * Is `value` a plain-ish object (not null, not an array)? `postMessage` delivers
 * structured clones, so a hostile "object" is still just data.
 */
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Classify an incoming `message` event without acting on it.
 *
 * Exported because it is the whole security surface and is unit-tested directly:
 * `{ ok: true, name, payload, id }`, or `{ ok: false, reason }` where `reason`
 * is one of `"foreign-source"`, `"foreign-origin"`, `"not-ours"`,
 * `"unsupported-version"`, `"other-instance"`, `"unknown-name"` or
 * `"malformed"`. Only `"unsupported-version"` deserves an answer; the rest are
 * silence.
 *
 * @param {MessageEvent} event
 * @param {{ parentOrigin: string|null, parent: Window|null, instance: string|null }} context
 */
export function classifyMessage(event, { parentOrigin, parent, instance }) {
  if (!parentOrigin) return { ok: false, reason: "foreign-origin" };
  // No parent to compare against is a refusal, not a free pass. The bridge
  // installs no listener when `parent` is null, so this is unreachable through
  // it today — but this function is exported as the security surface, and a
  // check that fails open when its input is missing is the wrong shape for one.
  if (!parent || event.source !== parent) return { ok: false, reason: "foreign-source" };
  if (event.origin !== parentOrigin) return { ok: false, reason: "foreign-origin" };

  const data = event.data;
  if (!isObject(data) || data.type !== MESSAGE_TYPE) return { ok: false, reason: "not-ours" };
  if (data.v !== MESSAGE_VERSION) return { ok: false, reason: "unsupported-version" };
  // A message may address one frame among several. A message with no `instance`
  // is for whoever is listening; one that names a different frame is not ours.
  if (data.instance != null && instance != null && data.instance !== instance) {
    return { ok: false, reason: "other-instance" };
  }
  if (typeof data.name !== "string" || !INBOUND.includes(data.name)) {
    return { ok: false, reason: "unknown-name" };
  }
  if (data.payload != null && !isObject(data.payload)) return { ok: false, reason: "malformed" };
  const id = typeof data.id === "string" && data.id.length <= MAX_ID_LENGTH ? data.id : undefined;

  return { ok: true, name: data.name, payload: data.payload ?? {}, id };
}

/**
 * Create the bridge.
 *
 * @param {object} options
 * @param {Window} options.windowRef - the embed's own window
 * @param {string|null} options.parentOrigin - the one origin messages are
 *   exchanged with; `null` disables the bridge in both directions
 * @param {string|null} [options.instance] - opaque id echoed in every message
 * @param {(command: { name: string, payload: object, id?: string }) => void} [options.onCommand] -
 *   a validated host command. Throwing from it is caught and reported as an
 *   `error` message rather than escaping into the `message` listener.
 * @returns {{
 *   post(name: string, payload?: object, options?: { id?: string }): boolean,
 *   readonly enabled: boolean,
 *   readonly parentOrigin: string|null,
 *   destroy(): void,
 * }}
 */
export function createMessageBridge({ windowRef, parentOrigin, instance = null, onCommand }) {
  const parent = windowRef?.parent && windowRef.parent !== windowRef ? windowRef.parent : null;
  const enabled = Boolean(parentOrigin && parent);
  const controller = new AbortController();
  let destroyed = false;
  /** Has the one `unsupported-version` answer already been sent? */
  let versionAnswered = false;

  /**
   * Send a message to the host. Returns whether it was sent: `false` when the
   * bridge is disabled (no configured origin, or the page is not framed), which
   * is a normal state and not an error.
   */
  function post(name, payload = {}, { id } = {}) {
    if (destroyed || !enabled || !OUTBOUND.includes(name)) return false;
    const message = { type: MESSAGE_TYPE, v: MESSAGE_VERSION, name, payload };
    if (instance != null) message.instance = instance;
    if (id !== undefined) message.id = id;
    try {
      parent.postMessage(message, parentOrigin);
      return true;
    } catch (error) {
      // A serialisation failure or a closed parent must not take the embed down.
      console.warn(`Could not post the "${name}" message to the host:`, error);
      return false;
    }
  }

  if (enabled) {
    windowRef.addEventListener(
      "message",
      (event) => {
        const result = classifyMessage(event, { parentOrigin, parent, instance });
        if (!result.ok) {
          // One answer per bridge. A host talking a version this build does not
          // speak is a deployment mismatch, not an event: telling it once is
          // what lets it distinguish an old embed from a silent one, and a reply
          // per message just turns its own loop into our noise.
          if (result.reason === "unsupported-version" && !versionAnswered) {
            versionAnswered = true;
            console.warn(
              `A host sent a message in a version this embed does not speak; it speaks version ${MESSAGE_VERSION}. Reported once.`,
            );
            post("error", {
              code: "unsupported-version",
              message: `This embed speaks message version ${MESSAGE_VERSION}`,
            });
          }
          return;
        }
        try {
          onCommand?.(result);
        } catch (error) {
          console.error(`The "${result.name}" command failed:`, error);
          post(
            "error",
            { code: "command-failed", message: `The "${result.name}" command failed` },
            {
              id: result.id,
            },
          );
        }
      },
      { signal: controller.signal },
    );
  }

  return {
    post,
    /** Whether messages can be exchanged at all (see the security model above). */
    get enabled() {
      return enabled;
    },
    get parentOrigin() {
      return parentOrigin ?? null;
    },
    destroy() {
      destroyed = true;
      controller.abort();
    },
  };
}
