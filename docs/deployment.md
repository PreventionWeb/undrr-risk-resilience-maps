# Deploying the viewer

The app is a static build with standalone and iframe entrypoints. Local build instructions
are in the [README](../README.md#developing); tag and rollback steps are in
[Contributing](../CONTRIBUTING.md#releasing).

## Deployment targets

| Target                | URL                                                           | Trigger                                                                                                                             |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Pages preview  | <https://preventionweb.github.io/undrr-risk-resilience-maps/> | Every push to `main`, via [deploy.yml](../.github/workflows/deploy.yml)                                                             |
| UNDRR released viewer | <https://www.undrr.org/m/risk-and-resilience-maps/>           | Highest plain `vX.Y.Z` tag on `main`, with the next [drupal-microsites](https://gitlab.com/undrr/drupal-microsites) `main` pipeline |

Merging here updates the preview. A release tag makes a version eligible for the downstream
UNDRR build; it does not run that pipeline itself. Follow the [release procedure](../CONTRIBUTING.md#releasing)
to ship immediately or check the live version.

## Downstream build requirements

- **Relative URLs only.** drupal-microsites runs `vite build --base=./`, so the same files work
  under `/undrr/risk-and-resilience-maps/` on its dev server and
  `/m/risk-and-resilience-maps/` in production. A root-relative asset or embed URL resolves
  to the site root and breaks there. Resolve URLs relative to the built app.
- **Node 24 Alpine, within the range in `package.json`.** The downstream `build-maps` job
  must use Node 24 with these dependencies.
- **Install without lifecycle scripts.** The build uses
  `yarn install --frozen-lockfile --ignore-scripts`, then `vite build`. Keep `yarn.lock`
  in sync and the build independent of install hooks.

To check the relative-base artifact locally after installing dependencies:

```bash
yarn build --base=./
```

This checks the build contract; it does not exercise the downstream Alpine job or hosting headers.
The GitHub Pages workflow uses its own base path from `vite.config.js`.

## Caching

Scripts and styles have fixed file names (`assets/embed.js`, `assets/shared.js`, …) with no
content hashes in them, so a cached `embed.html` from an earlier release still finds files
that exist. With hashed names, each deploy deleted the files an older copy named, and a GAR
landing-page embed stayed blank on 404s
([#89](https://github.com/PreventionWeb/undrr-risk-resilience-maps/issues/89)).

Each build instead adds one cache buster to every reference between its own scripts and
styles: `./assets/embed.js?v=7b098c438a`, `./shared.js?v=7b098c438a`, lazy imports included
(`buildQuery()` in `vite.config.js`). The id hashes the whole build's output, so it changes
whenever anything does. Two builds' chunks don't fit together: their internal export names
are assigned per build, so a mixed pair can fail to load or, worse, call the wrong code. Under
one build id, a new file only ever imports files cached under the same id. CI checks that
every reference carries the id, and only one id (`scripts/check-build-references.mjs`).
Images and fonts, if the build ever emits any, keep a content hash in their names instead.

The server holds only the latest build, whatever the query says. A page on an old id (an open
tab, or a stale `embed.html`) can still receive new files under that old id, and a request can
always straddle a deploy. Caching reduces this risk but can't remove it. Serve **everything**
under the map, HTML, `assets/*` and root files such as `logo-grar.svg`, with:

```
Cache-Control: no-cache
```

`no-cache` still lets browsers and Cloudflare keep the files; they check with the server
(a quick `304` when unchanged) before each use. That is what lets a wrong copy correct
itself. Don't use `immutable` or a long `max-age` on `assets/*`: if a deploy publishes the
new HTML before every new asset is in place, a visitor can cache an old file under the new id,
and an immutable copy would stay wrong in their browser for the cache's lifetime, past any
purge.

On each deploy:

1. Copy the new `assets/` first and the HTML last, so new HTML never names a file that isn't
   there yet.
2. Purge Cloudflare for the map, HTML query variants included. Cloudflare must keep the query
   string in the cache key, which is its default.

### First fixed-name release

Copies of `embed.html` from v0.0.16 and earlier still name hashed files such as
`assets/embed-BiCrkA-t.js`. Which cache served the stale copy in #89 is still unknown, so keep
v0.0.16's hashed `assets/*` files on the server until the release after this one has
deployed, and purge the map's HTML, query variants included. After that, nothing references
hashed script names.

The GitHub Pages preview sends `max-age=600` for everything and replaces the whole site on
each deploy, so a preview tab can break for up to ten minutes after a merge.

## Hosting and access

Both entry points open without a PIN. After merging, confirm the GitHub Pages
viewer and embed load in a fresh browser context and a shared layer link restores its state.
Repeat those checks at the UNDRR URLs after the release tag is deployed. If a UNDRR page embeds the viewer, check it on that page too.

Embedding on other sites also depends on response headers and Cloudflare behavior;
see [which sites can embed it](embedding.md#which-sites-can-embed-it) for the unresolved
hosting checks. A successful local build does not verify that those hosts can display the frame.

Downstream build failures and rollback configuration are covered by drupal-microsites'
`AGENTS.md` ("External apps") and
[undrr/web-backlog#3105](https://gitlab.com/undrr/web-backlog/-/work_items/3105).
