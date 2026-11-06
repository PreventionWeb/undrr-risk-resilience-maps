# UNDRR Risk & Resilience Map Viewer

An interactive geospatial explorer for UNDRR's Risk & Resilience Metrics initiative. Five data categories — Risk, Resilience, Hazard, Exposure, Vulnerability — backed by MapX (UNEP/GRID-Geneva), with toggleable layers, site inspection, and a content pipeline for non-developer inventory updates.

**Status: Prototype complete — V1 definition in progress.**  
See [docs/product-spec.md](docs/product-spec.md) for the V1 scope and [docs/resourcing-plan.md](docs/resourcing-plan.md) for the production work plan.

## Preview access

The prototype is behind a PIN gate for stakeholder review. Access details are shared separately. The gate is Mangrove's `preview-access` component, configured from `data-mg-preview-*` attributes on a `<div>` in `index.html`; it stores auth state in `sessionStorage` so it only prompts once per browser tab. `embed.html` carries the same gate, with the same id and PIN; on another site's page a visitor enters the PIN inside the frame (see [docs/embedding.md §8](docs/embedding.md#the-preview-gate-in-an-embed)). It will be replaced with production access control before launch.

## Developing

Use Node 24 (24.15.0 or newer) and Yarn 1.22.22. `.nvmrc` selects the Node 24 line for local development and both GitHub workflows; `package.json` enforces the supported major.

```bash
nvm use        # if using nvm
yarn install
yarn dev        # Vite dev server at http://localhost:3001
yarn build      # Production build to dist/
yarn preview    # Preview production build
yarn test       # Vitest unit tests
yarn test:e2e   # Playwright smoke suite in Chromium, MapX stubbed
                # (first run: npx playwright install chromium)
yarn test:all   # Both suites
yarn test:edra-contract         # Optional live check of all 15 EDRA variants
yarn test:mapx-raster-contract  # Optional live MapX/GIRI/mirror legend check
yarn test:downloads-contract    # Optional live check of hosted files and CSV views (docs/downloads.md)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow conventions (PRs, conventional commits, changelog).

### Claude Code

When working in this repo with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), use the **MapX SDK skill** (`/mapx-sdk-dev`) for MapX embedding, view management, or SDK integration. It has current reference material for the SDK's postMessage bridge, view queries, and map controls.

## Deployment

The app is published in two places from the same source:

| Where         | URL                                                           | What deploys it                                                                                     | When                                                                  |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| GitHub Pages  | <https://preventionweb.github.io/undrr-risk-resilience-maps/> | `.github/workflows/deploy.yml`                                                                      | Every push to `main`                                                  |
| www.undrr.org | <https://www.undrr.org/m/risk-and-resilience-maps/>           | [undrr/drupal-microsites](https://gitlab.com/undrr/drupal-microsites) CI, at the latest release tag | After a `vX.Y.Z` tag, with the next drupal-microsites `main` pipeline |

**Merging here does not update www.undrr.org; tagging a release does.** drupal-microsites builds the highest `vX.Y.Z` tag on `main`. See [CONTRIBUTING § Releasing](CONTRIBUTING.md#releasing) for how to release, and drupal-microsites' `AGENTS.md` ("External apps") for rolling back and what to do if its build fails ([undrr/web-backlog#3105](https://gitlab.com/undrr/web-backlog/-/work_items/3105)).

What that build requires of this repo:

- **Relative URLs only.** drupal-microsites runs `vite build --base=./`, so the same files work under `/undrr/risk-and-resilience-maps/` on its dev server and under `/m/risk-and-resilience-maps/` in production. A root-relative path in source (`"/assets/..."`, `"/embed.html"`) resolves to the site root and breaks there.
- **`yarn install --frozen-lockfile --ignore-scripts` then `vite build`, on Node 24 Alpine.** The downstream `build-maps` job must use Node 24 before deploying a release with these dependencies. Keep the build working without lifecycle scripts, and keep `yarn.lock` in sync.

## Project documentation

| File                                                         | Purpose                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [docs/product-spec.md](docs/product-spec.md)                 | V1 scope definition — what's in, what's deferred, pre-launch requirements    |
| [docs/resourcing-plan.md](docs/resourcing-plan.md)           | Work packages, effort estimates, risk register                               |
| [docs/external-layers.md](docs/external-layers.md)           | Runtime-source governance, tracker guidance, performance, and trade-offs     |
| [docs/legends.md](docs/legends.md)                           | Legend architecture, upstream contracts, operations, and extension guide     |
| [docs/embedding.md](docs/embedding.md)                       | Embedding in other sites: how to embed, the message API, hosting, roadmap    |
| [docs/downloads.md](docs/downloads.md)                       | Map downloads: GeoTIFF links, values-only CSV, and repository kill switch |
| [docs/adr/](docs/adr/)                                       | Durable architecture decisions and their review triggers                     |
| [ARCHITECTURE.md](ARCHITECTURE.md)                           | System design and technical decisions                                        |
| [LEARNINGS.md](LEARNINGS.md)                                 | MapX SDK quirks, design decisions, hard-won knowledge                        |
| [TODO.md](TODO.md)                                           | Deferred technical items                                                     |
| [METHODOLOGY.md](METHODOLOGY.md)                             | MapX view ID discovery approach and API research                             |
| [CHANGELOG.md](CHANGELOG.md)                                 | Notable changes                                                              |
| [data/inventory.csv](data/inventory.csv)                     | Master inventory — metadata, delivery status, and permanent MapX view IDs    |
| [data/removed-layer-keys.txt](data/removed-layer-keys.txt)   | Durable exclusion list for retired layers still present in upstream exports  |
| [scripts/import-inventory.mjs](scripts/import-inventory.mjs) | CSV → JS config import tool (dry-run + `--apply`)                            |
| [research/](research/)                                       | GRI UX analysis, layer inventory, MapX crosswalk, implementation patterns    |

The inventory importer requires the repository's 14 core CSV columns and fails fast when columns are missing or renamed. It also syncs optional `Note` and `Explainer link` columns, the optional `Download URL` / `Download size (bytes)` pair (hosted files per view, `;`-separated) and `CSV download` (`yes`, `no: <reason>` or blank; see [docs/downloads.md](docs/downloads.md#maintenance)); older files without these columns preserve configured metadata. Colleague `.xlsx` files must be converted to this CSV shape before import.

## URL routing

Map click info windows and site inspection are temporarily off by default following programme-lead feedback while the info-window design is revisited. Enable them per page load with `?inspect=1` before the hash (for example, `?inspect=1#gar`), or explicitly disable them with `?inspect=0`. The same query parameter works on `embed.html`. The central default is `MAP_INSPECTION_ENABLED` in `src/config/features.js`; programmatic instances use the boolean `inspectionEnabled` option. Panning, zooming, layer controls and legends remain available.

Data downloads are enabled by default in standalone and embedded viewers. The layer panel offers configured hosted GeoTIFFs and values-only CSVs for reviewed region-level vector views. Set `MAP_DOWNLOADS_ENABLED = false` in `src/config/features.js` and rebuild/redeploy to hide map download controls globally; URLs and programmatic options cannot override that kill switch. Individual viewers can opt out with `?downloads=0` or `{ downloadsEnabled: false }`. Sources dataset names open their maps in the viewer; its inventory export is separate. See the [download walkthrough](docs/downloads.md#try-a-download) and [inventory maintenance guide](docs/downloads.md#maintenance).

Hash-based routing (`#risk-resilience`, `#hazard`, `#sources`, etc.) makes links shareable and browser back/forward functional. Active tab and active layers are both encoded in the hash, so a URL captures the full map state. All tabs share a single page and MapX iframe — navigation is instant since the SDK stays connected.

## Ecosystem context

This viewer is the **spatial exploration** component of the Risk & Resilience Metrics initiative. A parallel **country analytics** stream (bar charts, indicator tables, per-country data) is being developed by UNEP/GRID-Geneva using Apache Superset. The two tools are complementary; future integration points (e.g. clicking a country on the map to surface Superset charts) are planned but not in V1 scope. See [docs/product-spec.md §1](docs/product-spec.md) for the full context.

During prototyping, some layers carry unpublished states (Disabled, Awaiting data, Coming soon). These are not visible by default but can be revealed via the **Show disabled** control in the layer panel for stakeholder review.
