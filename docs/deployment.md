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

## Hosting and access

The preview PIN gate is present in both `index.html` and `embed.html`, configured through
Mangrove's `data-mg-preview-*` attributes. It stores unlock state in `sessionStorage`.
It must be replaced with production access control before launch. For framed storage
behavior and gate removal, see [the embed preview gate](embedding.md#the-preview-gate-in-an-embed).

Embedding on other sites also depends on response headers and Cloudflare behavior;
see [which sites can embed it](embedding.md#which-sites-can-embed-it) for the unresolved
hosting checks. A successful local build does not verify that those hosts can display the frame.

Downstream build failures and rollback configuration are covered by drupal-microsites'
`AGENTS.md` ("External apps") and
[undrr/web-backlog#3105](https://gitlab.com/undrr/web-backlog/-/work_items/3105).
