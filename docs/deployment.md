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

## Caching across releases

Every build gives its bundles new hashed names (`assets/embed-<hash>.js`). The HTML entries
(`index.html` and `embed.html`) keep their URLs, and each names one build's bundles. A page
opened before a release, or an older HTML copy still in a browser, proxy or Cloudflare
cache, keeps asking for the previous build's bundles. Its JavaScript also loads more of
them later (the EDRA and citation chunks). If those files are gone, the embed stays blank.
During the v0.0.16 rollout a GAR page requested `embed-BiCrkA-t.js` and
`shared-D7Qa7H7m.js` and got HTML 404 pages back
([#89](https://github.com/PreventionWeb/undrr-risk-resilience-maps/issues/89)).

The UNDRR host has to keep this contract. It is configured in drupal-microsites, not here
([undrr/web-backlog#3116](https://gitlab.com/undrr/web-backlog/-/work_items/3116)):

| Path                                     | Cache-Control                               | Notes                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `index.html`, `embed.html`          | `no-cache` (or `max-age=0` at the edge too) | Applies with any query string. Cloudflare must revalidate HTML, not cache it by URL. Changing the URL query does not help, because embed URLs carry layer parameters. |
| `assets/*`                               | `public, max-age=31536000, immutable`       | Hashed, so they never change                                                                                                                                          |
| `assets/*` from the **previous** release | (same)                                      | Keep them deployed for at least 7 days after a release, longer than any HTML can stay cached. Remove them in a later deploy, not the one that replaces them.          |
| Missing `assets/*`                       | n/a                                         | Return a real 404, not the HTML fallback page, so the failure is visible                                                                                              |

Check a deployment with `yarn test:release-assets <base-url>`
([scripts/check-release-assets.mjs](../scripts/check-release-assets.mjs)). It reads each
HTML entry, with and without layer parameters, checks that the HTML revalidates and that
every bundle it reaches loads as JavaScript or CSS, and reports bundles with a short cache
lifetime. To confirm that a page opened before a release still loads afterward, record the
live bundles before the tag deploys and require them afterward:

```bash
yarn test:release-assets https://www.undrr.org/m/risk-and-resilience-maps/ --record before.json
# … release deploys …
yarn test:release-assets https://www.undrr.org/m/risk-and-resilience-maps/ --expect before.json
```

The first run passes with the new build; `--expect` fails while the previous build's bundles
are missing. www.undrr.org answers scripted requests with a Cloudflare bot challenge (403),
so pass a header the zone allowlists with `--header "Name: value"`, or check in a browser:
open the embed before the release, then reload it and confirm it uses the new bundles. The
GitHub Pages preview fails the HTML check by design. Pages sends `max-age=600` and replaces
the whole site on each deploy, so a preview embed can break for up to ten minutes after a
merge.

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
