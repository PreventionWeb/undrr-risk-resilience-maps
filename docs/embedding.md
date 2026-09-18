# Embedding the map viewer in other sites

- Status: **Phase 1 built** (`createRiskMap()` and the iframe embed at `embed.html`); phase 2 (script
  embed and web component) deliberately not built — see [Decision summary](#decision-summary) and
  [Roadmap](#7-roadmap-and-open-questions)
- Date: 2026-09-17; phase 1 built 2026-09-18
- Tracker: unisdr/undrr-risk-resilience-maps#14, built under #15
- **Using it:** jump to [How to embed](#8-how-to-embed-phase-1)
- Related: [docs/product-spec.md](product-spec.md) open question 1 ("Hosting path"),
  [docs/external-layers.md](external-layers.md), [docs/legends.md](legends.md)

## Context

UNDRR properties (PreventionWeb, undrr.org), partner sites and Drupal Gutenberg pages will want to
place the viewer inside their own pages. Today the app assumes it owns the whole document: one
`index.html`, fixed ids, a URL hash router, module singletons, global Mangrove CSS, a PIN overlay and
a syndicated footer.

This document fixed the target so the layer-state refactor (`layers-store`, `layer-controller`,
render-from-state rows, the `sidebar.js` split) moved toward it instead of away from it. Line
references are to `main` at the time of writing (2026-09-17), before phase 1 was built.

**What is built now** (2026-09-18): `createRiskMap(root, options)` in `src/app/create-risk-map.js`,
with `src/main.js` as its first consumer and `embed.html` (`src/embed/`) as its second — an iframe
embed with URL parameters, an in-memory state adapter, the v1 `postMessage` API and an
`embed_loaded` analytics event. [How to embed](#8-how-to-embed-phase-1) is the reference for hosts.
The script embed and the web component are **not** built; the reasoning below for why they might one
day be needed is kept as it was, because nothing about it has changed.

## Decision summary

1. **Phase 1: iframe embed of the hosted app** (`/embed?…`), with URL config, no PIN, no footer,
   no history writes, and a small versioned `postMessage` API. It is cheap, isolates CSS and globals
   completely, and keeps every network request on our origin.
2. **Phase 2 (only if a host needs it): a web component `<undrr-risk-map>` over a
   `createRiskMap(root, options)` factory**, rendering into a Shadow DOM and distributed as a
   versioned ESM bundle. A bare script embed without Shadow DOM is not offered.
3. **Now:** the refactor PRs follow the [constraints checklist](#6-constraints-for-the-refactor-prs)
   so the app becomes an instantiable module. The standalone `index.html` becomes the first consumer
   of `createRiskMap()`, and the iframe embed becomes the second.

## 1. Embed modes compared

| Concern             | (a) iframe of hosted app                                                                                        | (b) script embed, light DOM                                                           | (c) web component, Shadow DOM, over (b)                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CSS isolation       | Complete                                                                                                        | None. Mangrove 2.0.0-rc.1, `body {}` and `:root` tokens leak both ways                | Good. Mangrove CSS must load inside the shadow root; inherited properties and fonts still leak |
| JS/global isolation | Complete                                                                                                        | Shares `window.mxsdk`, `document` listeners, `location`                               | Same as (b); Shadow DOM does not isolate JS                                                    |
| Nesting             | Host → our app → MapX (two iframes)                                                                             | Host → MapX (one iframe)                                                              | Host → MapX (one iframe)                                                                       |
| Security            | Strongest; host can't touch our DOM. Needs a `frame-ancestors` policy and origin-checked messages               | Our code runs with host privileges, and the host must trust our CDN (SRI, CSP)        | Same as (b)                                                                                    |
| Network origin      | Our origin (unchanged from today)                                                                               | Host origin. Host CSP must allow MapX, EDRA and the mirror                            | Same as (b)                                                                                    |
| Performance         | Extra document, and a second copy of Mangrove CSS/JS if the host also uses it. The app is small; MapX dominates | Can reuse host Mangrove only if versions match                                        | Mangrove CSS parsed per shadow root (can share via constructable stylesheets)                  |
| Sizing              | Host must set a height; no auto-resize without our `resize` message                                             | Flows with the page                                                                   | Flows with the page                                                                            |
| SEO                 | Content not attributed to host. The map is not indexable in any mode                                            | Info pages indexable only if rendered, and they are JS-built today                    | Same as (b)                                                                                    |
| a11y                | Needs `title`, and focus moves between documents. Escape handlers stay inside the frame                         | Our `document` keydown handlers see host keystrokes; ids can collide with host ids    | Ids scoped by shadow root; still needs care with focus and landmarks                           |
| Host effort         | Paste one `<iframe>`; a CMS block is trivial                                                                    | Load CSS and JS, provide a sized element, match CSP                                   | One `<script type="module">` plus one tag, and CSP                                             |
| Versioning/caching  | Always latest unless we publish versioned embed paths; our cache headers apply                                  | Host pins a version (`/embed/1.2.3/`) and can use SRI; we must keep old versions live | Same as (b)                                                                                    |
| Upgrade risk        | Low; we control both sides                                                                                      | High; every host page is a new CSS/JS environment we don't test                       | Medium                                                                                         |

**MapX is itself an iframe.** The MapX SDK creates it (`document.createElement("iframe")` in
`mxsdk.umd.js`) inside the element we pass to `initSDK` (`src/sdk/client.js:14`). It posts
messages with `targetOrigin "*"` and filters incoming messages by a per-manager `sdkToken`, not by
origin. Several managers on one page therefore work, and `Manager.destroy()` removes the iframe and
its listener. Nesting it inside our iframe adds no new cross-origin rules because each hop is its own
`postMessage` channel.

**Recommendation:** phased, iframe first. The iframe covers every known host (Drupal pages, partner
sites) with near-zero host effort and no CSS or CSP negotiation. Its costs (fixed height, double
iframe, history coupling) have known fixes. A script or web-component embed only pays off if a host
needs tight integration: flowing layout, host-driven filters without messaging, or several maps per
page sharing one bundle. Build (c), never (b) alone, because Mangrove class names (`mg-*`) and our
generic ids (`#sidebar`, `#infobox`) would collide with PreventionWeb and undrr.org, which already
load Mangrove.

## 2. Current blockers inventory

Severity per mode: **H** must fix before shipping that mode, **M** visible defect or risk, **L**
cosmetic or edge case, **–** not applicable.

| #   | Blocker                                                                                                                                                                                                                                                                                                                                                                                                    | iframe | script (b)            | web comp. (c) |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------- | ------------- |
| B1  | Import-time side effects: `validateLayers()`, `buildSidebar()`, `buildSiteInspectorPanel()`, `initBuildInfo()`, `initMapServiceRetry()`, `startMapX()` all run on import (`src/main.js:35-42,141`)                                                                                                                                                                                                         | –      | H                     | H             |
| B2  | Markup lives in `index.html` (nav, `#app-map`, `#sidebar`, `#infobox`, `#map-service-notice`), and code finds it with global `document.getElementById`/`querySelector` (`src/ui/sidebar.js:213-218,349,354-371,407,424-478,535`; `src/main.js:55,74,84`; `src/ui/infobox.js:15,85`; `src/ui/site-inspector.js:85,109,115,230,239`; `src/sdk/availability.js:49,54,59,70,72`; `src/ui/build-info.js:31-32`) | –      | H                     | H             |
| B3  | Document-wide queries that cross instances: slider sync `document.querySelectorAll("input.mg-range[data-view-id]")` (`src/ui/layer-controls.js:93`)                                                                                                                                                                                                                                                        | –      | M                     | M             |
| B4  | `hashchange` listener on `window` (`src/ui/sidebar.js:395-399`). A host anchor link (e.g. Drupal `#main-content`) parses as zero layers and `reconcileLayersFromHash` turns every layer off (`sidebar.js:586-600`). Never removed                                                                                                                                                                          | –      | H                     | H             |
| B5  | History writes: `history.pushState`/`replaceState` and `location.hash` reads (`src/state/hash.js:43,106-110`). In an iframe, pushes join the **host tab's** joint session history, so host Back steps through map states first                                                                                                                                                                             | M      | H                     | H             |
| B6  | `navigate-tab` CustomEvent on `document` (`src/ui/home.js:100`, `src/ui/sidebar.js:402`); Escape `keydown` on `document` (`src/ui/infobox.js:80`, `src/ui/site-inspector.js:153`)                                                                                                                                                                                                                          | –      | M                     | M             |
| B7  | `location.reload()` for MapX retry and countdown (`src/sdk/availability.js:60,87`) reloads the **host page**                                                                                                                                                                                                                                                                                               | L      | H                     | H             |
| B8  | Global SDK: `window.mxsdk` loaded by script injection into `document.head` (`src/sdk/availability.js:11,31-39`), required by `client.js:13`. A host that loads another SDK version shares the global                                                                                                                                                                                                       | –      | M                     | M             |
| B9  | Single-instance module state: `store.js:2-15`; `client.js:9-10`; `inspect.js:18-24`; `external/index.js:24-25`; `sidebar.js:34,66-83`; `infobox.js:12`; `site-inspector.js:81`; `legends.js:21-22`; `views.js:21`                                                                                                                                                                                          | –      | M (one map) / H (two) | M / H         |
| B10 | Global CSS: Mangrove stylesheet `<link>` (`index.html:7`), CDN tabs module (`src/ui/mangrove-tabs.js:19,36`), `body {}` rule (`src/styles/components/layout.css:5`), tokens on `:root` (`src/styles/tokens.css:8`)                                                                                                                                                                                         | –      | H                     | M             |
| B11 | PIN gate: Mangrove `preview-access.js` (`index.html:16-23,283`) overlays `document.body`, makes siblings inert, and stores the unlock in `sessionStorage`                                                                                                                                                                                                                                                  | H      | H                     | H             |
| B12 | Syndicated footer: `PW_Widget` global script (`index.html:257-274`), toggled by `src/ui/global-footer.js:15`. Duplicates the host footer                                                                                                                                                                                                                                                                   | M      | H                     | H             |
| B13 | Page chrome and layout: UNDRR header and nav in `index.html:26-122`; map height `calc(100vh - header - nav - build-info)` (`layout.css:11,113`); build-info footer (`index.html:276-281`)                                                                                                                                                                                                                  | M      | H                     | H             |
| B14 | Hard-coded config: MapX URL, `language: "en"`, `theme` (`src/sdk/client.js:16-20`); `PRIMARY_PROJECT` import (`main.js:9`); nav tabs duplicated in HTML and `TABS` (tracker F6)                                                                                                                                                                                                                            | M      | M                     | M             |
| B15 | `document.body` fallbacks for drag and download (`src/utils/panels.js:31,88`, `src/utils/export-layers.js:167`)                                                                                                                                                                                                                                                                                            | –      | L                     | L             |
| B16 | Storage: no `localStorage` in `src/`. The only storage is the PIN gate's `sessionStorage` (B11)                                                                                                                                                                                                                                                                                                            | L      | L                     | L             |

The iframe column is short: B5, B11, B12, B13 and B14 are handled by an embed profile of the same
build, and the iframe needs no instance boundary. The script modes need all of it.

## 3. Target instantiation architecture

### App-instance boundary

As built (`src/app/create-risk-map.js`):

```js
import { createRiskMap } from "./app/create-risk-map.js";

const map = createRiskMap(rootElement, {
  initialTab: "hazard", // tab shown when the adapter names none
  layers: [{ key: "earthquake-pga", sourceIdx: 2 }], // seeded into the adapter
  tabs: ["hazard", "exposure"], // tab-id allowlist (default: every tab)
  layerAllowlist: ["earthquake-pga"], // layer-key allowlist (default: every layer)
  stateAdapter: createMemoryAdapter(), // default: a hash adapter it owns
  mapxProject: PRIMARY_PROJECT,
  validate: true, // run validateLayers() first
  buildInfo: true, // wire the build-info footer if the page has one
  reload: () => window.location.reload(), // how the map-service notice retries
});

map.setLayers([{ key: "population" }]); // desired state; the controller reconciles
map.setTab("exposure"); // a user action: one history entry
map.setState({ tab: "exposure", layers: [] }); // both, as one change in place
map.getState(); // { tab, layers: [{ key, sourceIdx, settings? }] }
const off = map.on("state", (state) => {}); // also "ready" and "error"
map.destroy(); // listeners, MapX iframe, DOM, timers, adapter
```

`createRiskMap` is the only place allowed to touch `document` and `window`, and only through the
`root` it was given, `root.ownerDocument` and the injected adapter. `src/main.js` is three lines:
`createRiskMap(document.body)`.

Two deliberate differences from the sketch this replaced. There is **no `chrome` option**: which
chrome an instance has is decided by which `data-ui` hooks its markup carries, so `embed.html`
simply has no information page, header or footer and the sidebar builds none — one mechanism instead
of two. And the events are `ready`, `state` and `error` rather than `layers-changed`, because this
document asks the DOM events, the host messages and these to share one vocabulary, and the message
names are the ones a host already has to know. `language`, `theme`, `baseUrl` and `previewGate` are
phase 2 or later; `language` is explicitly a nice-to-have (answer 8).

### State adapter

```ts
/** @typedef {{ tab: string|null, layers: Array<{key, sourceIdx, settings?}> }} UrlState */
interface StateAdapter {
  read(): UrlState; // initial state
  write(state: UrlState, { replace: boolean }): void; // after a user action or batch
  subscribe(fn: (state: UrlState) => void): () => void; // external navigation (back, host command)
  destroy(): void;
}
```

| Adapter              | Use                               | Behaviour                                                                                                                     |
| -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `hashAdapter`        | Standalone site (**built**)       | Today's `hash.js` format; `pushState`/`replaceState`; `hashchange` ignores hashes whose tab isn't one of ours (fixes B4)      |
| `memoryAdapter`      | The iframe embed (**built**)      | Never touches `location` or `history`; seeded from the embed URL's parameters                                                 |
| `postMessageAdapter` | Not built                         | Unnecessary: the embed posts `state` from `createRiskMap`'s `state` event, and host commands go through `router.applyState()` |
| `queryParamAdapter`  | Host wants deep links on its page | Owns a single namespaced param (`?riskmap=hazard;earthquake-pga:2`) via `replaceState`, and leaves other params alone         |

The iframe embed defaults to `postMessageAdapter` with `write` using replace semantics, so the host
tab's history is never touched (B5). A host that wants shareable URLs mirrors `state` messages into
its own URL.

### How the refactor plugs in

```
createRiskMap(root, options)
 ├─ registry      = shared, immutable (TABS index: byKey / byViewId / tabOf)
 ├─ sdk           = createMapxClient(root.querySelector("[data-mapx]"), options)   per instance
 ├─ store         = createLayersStore(registry)                                    per instance
 ├─ controller    = createLayerController({ store, sdk, external: createExternalRegistry(sdk) })
 ├─ router        = createRouter({ store, adapter: options.stateAdapter })         store subscriber
 ├─ ui            = mountNav / mountLayerPanel / mountSiteInspector (root-scoped)  store subscribers
 └─ disposers[]   → destroy()
```

The router is the only module that talks to the adapter. The UI never writes the hash; it sets
desired state, and the router serialises `applied` state once a batch settles.

### Multiple instances: what may stay module-level

| State                                                                         | Scope                  | Reason                                                                                                                 |
| ----------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `TABS` config and layer registry                                              | Module, shared         | Immutable                                                                                                              |
| EDRA geometry, values and config promises (`edra-agriculture.js:33-35`)       | Module, shared         | Pure HTTP data keyed by URL; failures already evicted                                                                  |
| Raster legend resolution cache (`raster-legends.js:59`)                       | Module, shared         | Keyed by provider URL                                                                                                  |
| MapX `get_views` catalogue (`legends.js:21-22`)                               | Shared **per project** | Today keyed by SDK manager. Key by `mapxProject`; keep per-instance refresh-on-miss for `view_add` cross-project views |
| Legend images (`views.js:21`)                                                 | Shared by `idView`     | Style is static per view; the fetch must use the calling instance's SDK                                                |
| Mangrove tabs module promise (`mangrove-tabs.js:21`)                          | Module, shared         | Idempotent loader                                                                                                      |
| Store, `openViews`, `activeSourceIndex`, router, UI maps (`sidebar.js:66-83`) | Per instance           | User state                                                                                                             |
| SDK manager and ready flag (`client.js:9-10`)                                 | Per instance           | One MapX iframe each                                                                                                   |
| External runtime registry (`external/index.js:24-25`)                         | Per instance           | `MX-GJ-*` view ids exist only in one MapX iframe                                                                       |
| Inspection batch and generation (`inspect.js:18-24`), Escape handlers         | Per instance           | Tied to one map and one panel                                                                                          |

### Host ↔ iframe message schema (v1)

Every message is an object `{ type: "undrr-risk-map", v: 1, id?, instance, name, payload }`.
`instance` is an opaque id from the embed URL (`?instance=`), so a page with two iframes can route
replies.

| Direction    | `name`      | Payload                                       |
| ------------ | ----------- | --------------------------------------------- |
| embed → host | `ready`     | `{ version, tabs, layers }`                   |
| embed → host | `state`     | `{ tab, layers }` after each settled change   |
| embed → host | `resize`    | `{ height }` (optional auto-height)           |
| embed → host | `error`     | `{ code, message }` (e.g. `mapx-unavailable`) |
| host → embed | `set-state` | `{ tab?, layers? }`                           |
| host → embed | `get-state` | `{}`; reply is `state` with the same `id`     |

**As built** (see [How to embed](#8-how-to-embed-phase-1) for the current reference), with two
deviations from the sketch above:

- `set-state` is two commands, `set-tab` and `set-layers`. One message that may or may not carry
  layers is ambiguous at exactly the point where it matters: layers are a desired state, so
  "change the tab" and "change the tab, and turn everything else off" must not look alike.
- The embed's state adapter is `memoryAdapter`, not a `postMessageAdapter`. A host command is not an
  external URL change; it is delivered to `router.applyState()`, which is the same reconcile path a
  back/forward navigation takes. So the embed and the standalone app share one path instead of the
  embed having a pushed-subscription path of its own, and `postMessageAdapter` is not needed.

Rules: the embed posts only to `document.referrer`'s origin after checking it against the embed
allowlist, never `"*"`. It accepts messages only when `event.source === window.parent` and
`event.origin` is in that allowlist. Unknown `v` gets an `error` with `code: "unsupported-version"`.
Payloads are validated like hash input today (unknown keys dropped, source indices clamped). The
same names become DOM `CustomEvent`s on the web component (`riskmap:state`), so both modes share a
vocabulary.

## 4. Cross-origin and security

**Where requests run.** In iframe mode every `fetch` runs from our origin, exactly as today. In
script mode it runs from the host origin. Headers checked with `curl -I` and
`Origin: https://www.preventionweb.net` on 2026-09-17:

| Request                                  | Code                        | CORS today                                     | Script-embed impact                                                       |
| ---------------------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| MapX SDK `app.mapx.org/sdk/mxsdk.umd.js` | `availability.js:1`         | `Access-Control-Allow-Origin: *`               | None (CSP `script-src`)                                                   |
| MapX app iframe `app.mapx.org`           | `client.js:16`              | No `X-Frame-Options`/`frame-ancestors` seen    | Frameable from any origin today; **unknown** whether MapX guarantees this |
| EDRA WFS, values, config (Copernicus)    | `edra-agriculture.js:15-19` | `ACAO: *`                                      | Works; host CSP `connect-src` must list it                                |
| GIRI GeoServer legend JSON               | `raster-legends.js:32-57`   | `ACAO: *` but **HTTP 403** to non-MapX origins | Same as today: falls back through the mirror                              |
| MapX mirror `api.mapx.org/get/mirror`    | `raster-legends.js:21`      | `ACAO: *`                                      | Works; host CSP `connect-src`                                             |
| PreventionWeb footer widget              | `index.html:265`            | `ACAO: *`, but Cloudflare challenge            | Not loaded in embeds                                                      |

**No proxy is needed for any mode today.** A proxy would be justified only if Copernicus narrows its
CORS policy or a new provider denies browser origins without an approved mirror path. That is
already a migration trigger in `docs/external-layers.md`.

**CSP a script-embed host must allow:** `script-src` our CDN, `app.mapx.org` and
`assets.undrr.org`; `frame-src https://app.mapx.org`; `connect-src drought.emergency.copernicus.eu
giri.unepgrid.ch api.mapx.org`; `img-src data:` (legend PNGs arrive as base64); and `style-src` our
CDN plus Mangrove. For the iframe embed the host only needs `frame-src <our embed origin>`. We should
also ship our own CSP on the embed page with the same list.

**Framing policy.** Production is GitHub Pages (`.github/workflows/deploy.yml`), which cannot set
response headers. `server.js:38-40` sets only `Content-Type`. The viewer is therefore frameable by
any site, and `<meta http-equiv>` cannot set `frame-ancestors`. Clickjacking impact is low (no
login, no state-changing actions), but an allowlisted embed needs a host that sets
`Content-Security-Policy: frame-ancestors 'self' https://*.undrr.org https://*.preventionweb.net …`
on `/embed`, for example a CDN or Cloudflare in front of Pages. Keep the standalone app framable only
by `'self'` once headers are possible.

**`postMessage`.** MapX's SDK uses `"*"` and token filtering (above), which we can't change and which
is acceptable because it carries only map state. Our host API must use explicit `targetOrigin` and
origin checks (section 3).

**Permissions-Policy.** Coordinate copy uses `navigator.clipboard.writeText`
(`src/ui/site-inspector.js:131`), which needs `allow="clipboard-write"` on the host iframe; it already
fails silently. Recommend `allow="fullscreen; clipboard-write"`. The SDK creates the MapX iframe
without an `allow` attribute, so geolocation and fullscreen inside MapX are unavailable in any mode.
Immersive mode hides those controls anyway.

**Storage partitioning.** Browsers partition storage and cookies in third-party iframes by top-level
site. The app stores nothing itself (B16). MapX in a nested frame works anonymously for public views
today (the standalone app is already a third-party context for MapX). **Unknown:** whether any MapX
feature we may adopt later (private projects, logged-in views) relies on unpartitioned cookies. If so,
it will break in every embed mode and needs the Storage Access API or a MapX token.

**PIN gate.** Embeds never render the preview gate. It would lock the host page in script mode,
and in an iframe it prompts per host site. Until production access control exists, the embed route
should be undeployed or restricted with `frame-ancestors` to review hosts.

**Subresource Integrity.** Exact-version paths (`/embed/1.2.3/risk-map.js`) publish an SRI hash.
SRI covers only the entry file: lazy chunks (EDRA and `proj4`) are loaded by `import()` and can't
carry host-supplied integrity. Mitigate with content-hashed, immutable chunk filenames on the same
versioned path. Major aliases (`/embed/1/`) are unpinned and documented as such.

## 5. Build and distribution

- **Iframe embed:** a second Vite HTML entry, `embed.html`, next to `index.html`
  (`vite.config.js:32-34`). Both call `createRiskMap` with different options. It uses the same bundle
  and cache headers, with no extra pipeline.
- **Library build (phase 2):** Vite `build.lib` with `formats: ["es"]`, entry `src/embed/index.js`
  exporting `createRiskMap` and defining `<undrr-risk-map>`. CSS is emitted as a file and adopted
  into the shadow root (`?inline` import or constructable stylesheet). Relative dynamic `import()`
  in an ES module resolves against the importing module's URL, so the lazy EDRA chunk loads from the
  CDN path, not the host. The CDN must send `Access-Control-Allow-Origin` because module scripts are
  CORS requests. Non-JS assets use `new URL(…, import.meta.url)` or `options.baseUrl`, never the
  root-relative `base` used for Pages (`vite.config.js:19`).
- **Versioned paths:** `https://assets.undrr.org/risk-map/<semver>/` (immutable, long cache, SRI)
  and `/risk-map/<major>/` (short cache). Mangrove stays on its own versioned CDN path. The embed
  pins the Mangrove version it was tested with rather than inheriting the host's.
- **Drupal Gutenberg block:** a `undrr/risk-map` block whose attributes are `tab`, `layers`,
  `tabs`, `height` and `mode`. `save()` outputs either an `<iframe src="…/embed.html?tab=…&layers=…"
title="…" loading="lazy" allow="fullscreen; clipboard-write">` or, in phase 2,
  `<undrr-risk-map tab="…" layers="…">` with the script registered as a library in the module's
  `*.libraries.yml`. The editor preview can be the live iframe. Keeping iframe output in phase 1 means
  no CSP change on Drupal sites.
- **Embed-code generator:** an "Embed this map" action in the standalone app that serialises the
  current `getState()` into the embed URL and shows copyable iframe (and later web component)
  snippets, with a height field. It reuses the adapter serialisers, so embed URLs and share links
  can't drift.

## 6. Constraints for the refactor PRs

Every PR in the layer-state refactor is reviewed against this list. A deviation must be named in the
PR description with its reason and the follow-up issue.

Phase 1 meets every line, with one named carry-over: **one instance per document.** The MapX client
(`sdk/client.js`), the inspection batch (`sdk/inspect.js`), the infobox and the site-inspector panel
are still module singletons that find their elements by document id. `createRiskMap` is a factory
and takes its adapter, registry and tabs as arguments, which is what this checklist asks for, and
both of phase 1's consumers are a single instance per document, so nothing exercises the gap. Two
maps on one page is phase 2b (see the roadmap), and it is what has to finish this.

- [x] **No new globals or import-time side effects.** New modules export functions or factories;
      nothing runs on import except constant definitions. No new `window.*` or `document`-level
      custom events.
- [x] **Store and controller are instantiable.** `createLayersStore()` and `createLayerController()`
      are factories taking their dependencies (registry, SDK client, external registry). A module
      singleton wrapper for the standalone app is acceptable for now if the factory exists and tests
      use it.
- [x] **Router/state adapter is injectable.** Hash reading and writing live behind the
      `read/write/subscribe/destroy` adapter. The store and controller never import `hash.js`.
- [x] **DOM queries are scoped to a root.** New or moved UI code receives a root element or
      component elements and uses `root.querySelector`. No new `document.getElementById`, no
      `document.querySelectorAll` across instances, no new hard-coded ids (use `data-` hooks or
      classes).
- [x] **Listeners are `destroy()`-able.** Every `addEventListener`, `subscribe`, `setInterval` or SDK
      `on` registered outside a disposable element returns or records a disposer that a `destroy()`
      path calls. Prefer `AbortController` signals.
- [x] **No reliance on `location` or `history` outside the hash adapter.** This includes
      `location.reload()` (pass a `reload` callback instead).
- [x] **Shared caches are keyed, not implicit.** A module-level cache must key by project, view id or
      URL (see the table in section 3), never by "the current SDK".

## 7. Roadmap and open questions

| Phase | Work                                                                                                                            | Status                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0     | Refactor PRs honour section 6; `hashchange` ignores foreign hashes (B4)                                                         | **Done** (#14)                 |
| 1a    | `createRiskMap` boundary: the standalone app is its first consumer; injected adapter, allowlists, `destroy()`                   | **Done** (#15)                 |
| 1b    | `embed.html` with `tab`, `tabs`, `allow`, `layers`, `panel` URL params, in-memory adapter, v1 message API, no PIN or footer     | **Done** (#15)                 |
| 1c    | Hosting with headers (`frame-ancestors`, CSP) and a Gutenberg block emitting the iframe                                         | 2–4 days, plus infra lead time |
| 2     | Web component, Shadow DOM CSS, library build, versioned CDN, SRI, embed-code generator                                          | 1.5–2 weeks, conditional       |
| 2b    | Two maps on one page (shared caches keyed per section 3, per-instance SDK client and inspect); ties in with side-by-side panels | 3–5 days                       |

Carried over from 1a on purpose: the markup still lives in `index.html` and `embed.html` rather than
being built by mount functions, and the SDK client, the inspection batch, the infobox and the site
inspector are still document-level singletons. Both are only in the way of _two instances in one
document_, which is 2b, and building the markup in JavaScript would have meant rewriting the page in
the same PR that introduced the boundary.

Answered by the maintainer (2026-09-18, PreventionWeb/undrr-risk-resilience-maps#15):

1. **Target hosts.** UNDRR.org and PreventionWeb.net first. Neither restricts iframes through CSP.
2. **Is the script embed truly needed?** No — start with the iframe and see how far it goes. That
   settles the phasing below: build phase 1, and treat phase 2 as conditional on a host needing
   something the iframe cannot give.
3. **Access control in embeds.** Embeds may ship before the PIN gate is replaced, and a
   `frame-ancestors` allowlist is acceptable as the prototype barrier.
4. **Hosting.** Not yet decided. Likely still GitHub Pages, possibly mapped to a subdomain such as
   `riskmaps.undrr.org`. So the embed must not depend on response headers until hosting can send
   them — `frame-ancestors` is a follow-up, not a prerequisite.
5. **Chrome and branding.** Attribution can be subtle. The info pages are not required in embeds.
6. **Deep links.** Host-URL state is a nice-to-have, not phase 1. The embed must still never write
   to the host's history.
7. **Analytics.** Track on the embed — usage is logged to the map platform — and record which host
   the embed is running on.
8. **Language.** Nice-to-have, not phase 1.
9. **MapX terms.** No policy or rate limit on being framed by third parties.

Still open:

- Whether a `frame-ancestors` allowlist can be set at all depends on question 4 landing.

## 8. How to embed (phase 1)

### The snippet

```html
<iframe
  src="https://<host>/embed.html?tab=hazard&layers=river-flooding:1,landslides&parentOrigin=https://www.undrr.org"
  title="Risk and resilience metrics map"
  width="100%"
  height="600"
  loading="lazy"
  allow="fullscreen; clipboard-write"
  style="border: 0"
></iframe>
```

`title` is required for screen-reader users: a frame with no name is announced as an unnamed frame.
`allow="clipboard-write"` is what lets the site inspector's "copy coordinates" button work; without
it the copy fails silently. Give the frame a height — the embed is a map, so it has no natural one
(the `resize` message below is for hosts that would rather size it to the content).

### Parameters

Everything is validated against the layer config, unknown parameters are ignored, and an invalid
value falls back to its default rather than failing the embed.

| Parameter      | Value                                                                                  | Default                       |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| `tab`          | a data tab id (`risk-resilience`, `resilience`, `hazard`, `exposure`, `vulnerability`) | the first tab the embed shows |
| `layers`       | `key[:sourceIdx]`, comma separated — the share-link syntax                             | none                          |
| `variants`     | JSON of per-layer provider settings, as in a share link                                | none                          |
| `tabs`         | tab-id allowlist, comma separated                                                      | every tab                     |
| `allow`        | layer-key allowlist, comma separated                                                   | every layer of the shown tabs |
| `panel`        | `collapsed` or `expanded`                                                              | `expanded`                    |
| `parentOrigin` | the host origin the embed exchanges messages with                                      | `document.referrer`'s origin  |
| `instance`     | opaque id (`[A-Za-z0-9_-]`, ≤ 64) echoed in every message                              | none                          |

A source index the layer does not have falls back to its first source, at most 12 layers are opened,
a tab allowlist that leaves nothing shows the whole config rather than an empty frame, and info tabs
(`home`, `sources`, `about`) are not addressable: an embed has no information pages.

### The message API (v1)

Every message, both ways, is `{ type: "undrr-risk-map", v: 1, instance?, id?, name, payload }`.

| Direction    | `name`       | Payload                                                                                          |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------ |
| embed → host | `ready`      | `{ version, tabs, layers }` — the tab ids and layer keys this embed can show                     |
| embed → host | `state`      | `{ tab, layers }` after each settled change                                                      |
| embed → host | `resize`     | `{ height }` — the height the content would like, in px                                          |
| embed → host | `error`      | `{ code, message }`: `mapx-unavailable`, `layer-failed`, `unsupported-version`, `command-failed` |
| host → embed | `set-tab`    | `{ tab }`                                                                                        |
| host → embed | `set-layers` | `{ tab?, layers }` — a desired state, reconciled                                                 |
| host → embed | `get-state`  | `{}` — answered by a `state` message carrying the same `id`                                      |

```js
const frame = document.getElementById("risk-map");
const EMBED_ORIGIN = "https://<host>";

window.addEventListener("message", (event) => {
  if (event.origin !== EMBED_ORIGIN) return; // the host has to check too
  const message = event.data;
  if (!message || message.type !== "undrr-risk-map" || message.v !== 1) return;
  if (message.name === "ready") {
    frame.contentWindow.postMessage(
      { type: "undrr-risk-map", v: 1, name: "set-layers", payload: { layers: [{ key: "landslides" }] } },
      EMBED_ORIGIN,
    );
  }
});
```

Rules a host can rely on:

- **Wait for `ready`.** Commands that arrive before MapX can accept layer changes are ignored, as a
  back/forward navigation would be.
- **Commands are a desired state, not a diff.** `set-layers` turns off anything not in the list.
- **Everything is clamped** exactly as a URL parameter is: unknown keys dropped, indices checked,
  layers outside the embed's allowlist refused, at most 12 at a time.
- **Malformed traffic is ignored**, never answered and never thrown. Only an unrecognised `v` gets a
  reply (`unsupported-version`), so a host can tell an old embed from a silent one.

### Security model

- The embed posts **only** to the configured parent origin, with an explicit `targetOrigin`, never
  `"*"`. The browser drops the message if the real parent is not that origin.
- The embed accepts a command only when it comes from `window.parent` **and** from that origin. A
  third-party frame on the same host page cannot drive it, even though it can reach the embed's
  window through `parent.frames[…]`.
- **With no parent origin** — no `parentOrigin` parameter and no readable `document.referrer`
  (a strict `Referrer-Policy`, or the embed opened directly) — the embed refuses in both directions:
  it posts nothing and accepts no command. It still renders and still works for the person looking at
  it; it is simply not addressable. Add `&parentOrigin=<your origin>` to fix it.
- A host can set layers, set the tab and read state. It **cannot** reach inside the embed's DOM, read
  anything the schema above does not list, make the embed navigate, or make it touch the host page's
  URL or history: the embed's state lives in an in-memory adapter (`src/state/memory-adapter.js`).
- Prove it locally with the host harness in `tests/e2e/fixtures/embed-host.html` (it explains how to
  serve itself from a second port); `tests/e2e/embed.spec.js` is the same thing automated.

### Framing policy, pending hosting

Where the viewer is hosted is still open (answer 4 above), and GitHub Pages cannot set response
headers, so **nothing in the embed depends on one**. Once hosting can send headers, the embed route
should carry

```
Content-Security-Policy: frame-ancestors 'self' https://*.undrr.org https://*.preventionweb.net
```

and the standalone app `frame-ancestors 'self'`. Until then the embed is frameable by any site, which
is the same exposure the standalone app already has: no login, no state-changing actions, and the PIN
gate stays on the standalone app as the prototype barrier. The embed deliberately does **not** render
that gate — it would prompt once per host site and is not a barrier a host's visitor can answer.

### Analytics

The embed records one event on load, `embed_loaded`, with
`{ host, framed, tab, layers }` — `host` being `document.referrer`'s origin, because
`window.parent.location` is unreadable across origins, and `null` when the browser sends no referrer.
The repository has no analytics platform yet (see `docs/resourcing-plan.md`), so the default sink
writes the event to the console at debug level; pointing `createAnalytics({ sink })` at Matomo or
whatever UNDRR standardises on is a one-line change in `src/embed/main.js`.
