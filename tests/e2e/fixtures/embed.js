/**
 * The embed suite's fixture: the app fixture's stubbed MapX, plus two little
 * static servers that host the embed from *other origins*.
 *
 * Why real servers rather than `page.route` interception, which is how this
 * suite fakes everything else: Chrome's local-network-access checks refuse to
 * let a page whose response did not come from the local network load anything
 * from `localhost`, and an intercepted response counts as exactly that. The
 * frame is then blocked (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`) and the
 * suite proves nothing. Two throwaway HTTP servers on ports of their own are
 * both genuinely cross-origin and genuinely local — and they are the same
 * arrangement a person reproducing this by hand would use (see the comment at
 * the top of `embed-host.html`).
 *
 * - `origins.host` serves `embed-host.html`: the host page, which frames the
 *   embed, records its messages and can send commands back.
 * - `origins.unrelated` serves `embed-unrelated.html`: a third party on the host
 *   page, on a third origin, used to prove the embed answers only its parent.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { expect, test as base } from "./app.js";
import { PORT } from "../dev-server.js";

/** Where the embed itself is served from, as a host page has to address it. */
export const EMBED_ORIGIN = `http://localhost:${PORT}`;

const PAGES = {
  "/embed-host.html": readFileSync(new URL("./embed-host.html", import.meta.url), "utf8"),
  "/embed-unrelated.html": readFileSync(new URL("./embed-unrelated.html", import.meta.url), "utf8"),
};

/** A one-page static server on an ephemeral port; resolves to its origin. */
async function startPageServer() {
  const server = createServer((request, response) => {
    const body = PAGES[new URL(request.url, "http://localhost").pathname];
    if (!body) {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://localhost:${server.address().port}`, close: () => server.close() };
}

export const test = base.extend({
  /** `{ host, unrelated }` — one server each, shared by every test in the worker. */
  origins: [
    // Playwright reads the fixture's parameter list to work out what it depends
    // on, so the empty destructuring is load-bearing: a named parameter is
    // rejected at run time ("First argument must use the object destructuring
    // pattern").
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const [host, unrelated] = await Promise.all([startPageServer(), startPageServer()]);
      await use({ host: host.origin, unrelated: unrelated.origin });
      host.close();
      unrelated.close();
    },
    { scope: "worker" },
  ],
});

export { expect };

/**
 * Open `embed.html` directly (no host page).
 * @param {import("@playwright/test").Page} page
 * @param {string} [search] - the embed's query string, e.g. `"?tab=hazard"`
 * @param {{ waitForMap?: boolean }} [options] - `false` for an embed that never
 *   builds a map: one still behind the PIN gate, or one whose parameters select
 *   nothing and which renders the empty state instead.
 */
export async function gotoEmbed(page, search = "", { waitForMap = true } = {}) {
  await page.goto(`/embed.html${search}`);
  if (waitForMap) await page.waitForFunction(() => window.__mapxStub?.ready === true);
  return page;
}

/** The host page's URL for a given embed query string. */
export function hostUrl(origins, search = "", { unrelated = false, parentOrigin } = {}) {
  const embedSearch = new URLSearchParams(search.replace(/^\?/, ""));
  // `!== undefined`, not truthiness: `parentOrigin: ""` is a case a spec tests
  // (a supplied-but-unparseable value has to disable the bridge).
  if (parentOrigin !== undefined) embedSearch.set("parentOrigin", parentOrigin);
  const query = embedSearch.toString();
  const params = new URLSearchParams({ src: `${EMBED_ORIGIN}/embed.html${query ? `?${query}` : ""}` });
  if (unrelated) params.set("evil", `${origins.unrelated}/embed-unrelated.html`);
  return `${origins.host}/embed-host.html?${params}`;
}

/**
 * Open the host page with the embed framed inside it, and wait until the host
 * has seen the embed's `ready` message.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ host: string, unrelated: string }} origins - the `origins` fixture
 * @param {string} [search] - the embed's query string
 * @param {{ unrelated?: boolean, parentOrigin?: string }} [options] - also frame
 *   the unrelated third party; override the `parentOrigin` parameter (it
 *   defaults to the host that is really framing the embed)
 * @returns {Promise<import("@playwright/test").FrameLocator>} the embed's frame
 */
export async function gotoHost(page, origins, search = "", options = {}) {
  await page.goto(hostUrl(origins, search, { parentOrigin: origins.host, ...options }));
  // The embed's own `ready` message is the signal: it is posted once MapX is
  // ready and the embed has restored its state, and its arrival is itself part
  // of what these specs are about.
  await page.waitForFunction(() => window.__harness?.messages.some((message) => message.name === "ready"));
  return page.frameLocator("#map");
}

/** Every message the host page has received, newest last. */
export function hostMessages(page) {
  return page.evaluate(() => window.__harness.messages);
}

/** Send a command to the embed the way a host page does. */
export function hostSend(page, name, payload = {}, extra = {}) {
  return page.evaluate(({ name: n, payload: p, extra: e }) => window.__harness.send(n, p, e), {
    name,
    payload,
    extra,
  });
}
