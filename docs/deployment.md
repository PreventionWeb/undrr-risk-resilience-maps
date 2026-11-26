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
hashes; see `build.rollupOptions.output` in `vite.config.js`. A cached copy of `embed.html`
from an earlier release therefore still finds its scripts after a deploy. With hashed names,
each deploy deleted the files an older copy named, and a GAR landing-page embed stayed blank
on 404s ([#89](https://github.com/PreventionWeb/undrr-risk-resilience-maps/issues/89)).

The trade-off: a file's URL no longer changes when its content does. The chunks import each
other, and the names they use internally change between builds, so an old cached chunk next
to a new one can break the app. The UNDRR host should therefore serve:

| Path                            | Cache-Control | Why                                                                                          |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `/`, `index.html`, `embed.html` | `no-cache`    | Any query string included. Visitors get the new release straight away                        |
| `assets/*`                      | `no-cache`    | A browser revalidates each file (a quick `304` when unchanged), so it never mixes two builds |

`no-cache` still lets browsers and Cloudflare keep the files; they only check with the server
before using them. Purging Cloudflare on deploy is a useful extra. The GitHub Pages preview
sends `max-age=600` for everything and can't be changed, so a preview visitor can see a broken
mix of builds for up to ten minutes after a merge.

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
