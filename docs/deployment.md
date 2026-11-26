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

Build output has fixed file names (`assets/embed.js`, `assets/shared.js`, …) with no content
hashes in them, so a cached `embed.html` from an earlier release still finds files that
exist. With hashed names, each deploy deleted the files an older copy named, and a GAR
landing-page embed stayed blank on 404s
([#89](https://github.com/PreventionWeb/undrr-risk-resilience-maps/issues/89)).

Each build instead adds one cache buster to every reference between its own files:
`./assets/embed.js?v=7b098c438a`, `./shared.js?v=7b098c438a`, lazy imports included
(`buildQuery()` in `vite.config.js`). The id hashes the whole build's output, so it changes
whenever anything does. This matters because two builds' chunks don't fit together: their
internal export names differ, and pairing a new `embed.js` with an old `shared.js` fails
module linking. Under one build id, a new file only ever imports files cached under the same
id. CI checks that every reference carries the id, and only one id
(`scripts/check-build-references.mjs`).

The server keeps only the latest build, whatever the query says. A page using an old id
(an open tab, or a stale `embed.html`) can still receive new files under that old id. Caching
reduces this risk but can't remove it: a request can always straddle a deploy. Reloading
fixes it. Serve:

| Path                            | Cache-Control                                 | Why                                                                                                   |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/`, `index.html`, `embed.html` | `no-cache`                                    | With any query string. New visits get the new build id at once, so stale HTML lasts only in open tabs |
| `assets/*`                      | `public, max-age=31536000, immutable` is fine | New HTML always asks for the new id, so a stale copy under an old id is only reached by old pages     |

Cloudflare must keep the query string in the cache key (its default). After every deploy, purge
the cache for the map, HTML query variants included.

### First fixed-name release

Copies of `embed.html` from v0.0.16 and earlier still name hashed files such as
`assets/embed-BiCrkA-t.js`. The first deploy of this change must keep the previous release's
hashed files on the server until those copies have expired. Purge the map's HTML, query
variants included, in the same deploy. Later deploys replace the fixed-name files in place,
and nothing references hashed names any more.

The GitHub Pages preview sends `max-age=600` for everything and replaces the whole site on
each deploy, so a preview tab can break for up to ten minutes after a merge.

## Hosting and access

Both entry points open directly for the soft launch. After merging, confirm the GitHub Pages
viewer and embed load in a fresh browser context and a shared layer link restores its state.
Repeat those checks at the UNDRR URLs after the release tag is deployed. If the launch
includes an iframe on a UNDRR page, check it on that page too.

Embedding on other sites also depends on response headers and Cloudflare behavior;
see [which sites can embed it](embedding.md#which-sites-can-embed-it) for the unresolved
hosting checks. A successful local build does not verify that those hosts can display the frame.

Downstream build failures and rollback configuration are covered by drupal-microsites'
`AGENTS.md` ("External apps") and
[undrr/web-backlog#3105](https://gitlab.com/undrr/web-backlog/-/work_items/3105).
