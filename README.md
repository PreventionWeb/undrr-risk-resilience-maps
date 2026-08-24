# UNDRR Risk & Resilience Map Viewer

An interactive geospatial explorer for UNDRR's Risk & Resilience Metrics initiative. Five data categories — Risk, Resilience, Hazard, Exposure, Vulnerability — backed by MapX (UNEP/GRID-Geneva), with toggleable layers, site inspection, and a content pipeline for non-developer inventory updates.

**Status: Prototype complete — V1 definition in progress.**  
See [docs/product-spec.md](docs/product-spec.md) for the V1 scope and [docs/resourcing-plan.md](docs/resourcing-plan.md) for the production work plan.

## Preview access

The prototype is protected by a PIN gate — a soft barrier for stakeholder review, not a security mechanism. Access details are shared separately. The gate stores auth state in `sessionStorage` so it only prompts once per browser tab. It will be replaced with production access control before launch (see `src/pin-gate.js`).

## Developing

```bash
yarn install
yarn dev        # Vite dev server at http://localhost:3001
yarn build      # Production build to dist/
yarn preview    # Preview production build
yarn test       # Vitest unit tests
yarn test:edra-contract         # Optional live check of all 15 EDRA variants
yarn test:mapx-raster-contract  # Optional live MapX/GIRI/mirror legend check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow conventions (PRs, conventional commits, changelog).

### Claude Code

When working in this repo with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), use the **MapX SDK skill** (`/mapx-sdk-dev`) for MapX embedding, view management, or SDK integration. It has current reference material for the SDK's postMessage bridge, view queries, and map controls.

## Project documentation

| File                                                         | Purpose                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [docs/product-spec.md](docs/product-spec.md)                 | V1 scope definition — what's in, what's deferred, pre-launch requirements |
| [docs/resourcing-plan.md](docs/resourcing-plan.md)           | Work packages, effort estimates, risk register                            |
| [docs/external-layers.md](docs/external-layers.md)           | Runtime-source governance, tracker guidance, performance, and trade-offs  |
| [docs/legends.md](docs/legends.md)                           | Legend architecture, upstream contracts, operations, and extension guide  |
| [docs/adr/](docs/adr/)                                       | Durable architecture decisions and their review triggers                  |
| [ARCHITECTURE.md](ARCHITECTURE.md)                           | System design and technical decisions                                     |
| [LEARNINGS.md](LEARNINGS.md)                                 | MapX SDK quirks, design decisions, hard-won knowledge                     |
| [TODO.md](TODO.md)                                           | Deferred technical items                                                  |
| [METHODOLOGY.md](METHODOLOGY.md)                             | MapX view ID discovery approach and API research                          |
| [CHANGELOG.md](CHANGELOG.md)                                 | Notable changes                                                           |
| [data/inventory.csv](data/inventory.csv)                     | Master inventory — metadata, delivery status, and permanent MapX view IDs |
| [scripts/import-inventory.mjs](scripts/import-inventory.mjs) | CSV → JS config import tool (dry-run + `--apply`)                         |
| [research/](research/)                                       | GRI UX analysis, layer inventory, MapX crosswalk, implementation patterns |

## URL routing

Hash-based routing (`#risk-resilience`, `#hazard`, `#sources`, etc.) makes links shareable and browser back/forward functional. Active tab and active layers are both encoded in the hash, so a URL captures the full map state. All tabs share a single page and MapX iframe — navigation is instant since the SDK stays connected.

## Ecosystem context

This viewer is the **spatial exploration** component of the Risk & Resilience Metrics initiative. A parallel **country analytics** stream (bar charts, indicator tables, per-country data) is being developed by UNEP/GRID-Geneva using Apache Superset. The two tools are complementary; future integration points (e.g. clicking a country on the map to surface Superset charts) are planned but not in V1 scope. See [docs/product-spec.md §1](docs/product-spec.md) for the full context.

During prototyping, some layers carry unpublished states (Disabled, Awaiting data, Coming soon). These are not visible by default but can be revealed via the **Show disabled** control in the layer panel for stakeholder review.
