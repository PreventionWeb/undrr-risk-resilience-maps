# UNDRR Risk & Resilience Map Viewer

An interactive geospatial explorer for UNDRR's Risk & Resilience Metrics initiative.
Explore Risk, Resilience, Hazard, Exposure and Vulnerability through toggleable MapX
layers, legends and map downloads. A CSV inventory lets the programme team maintain
layer metadata with developer review.

The working prototype is available for stakeholder review. The [V1 scope](docs/product-spec.md)
still requires stakeholder sign-off; the [resourcing plan](docs/resourcing-plan.md) covers
production work. Country analytics, developed separately by UNEP/GRID-Geneva using
Apache Superset, are a complementary stream; integration is deferred beyond V1.

## Preview access

Open the [released viewer](https://www.undrr.org/m/risk-and-resilience-maps/) or the
[GitHub Pages preview of main](https://preventionweb.github.io/undrr-risk-resilience-maps/).
The prototype uses a PIN gate, including in local development and embeds. Access details
are shared separately. The gate remembers access for the browser tab and is due to be
replaced with production access control before launch.

Choose a category and toggle a layer to explore the map. Share its URL to preserve
the active tab and layers. **Show unpublished** reveals unpublished entries for review.
Click inspection is temporarily off by default while its design is reviewed; use
`?inspect=1` before the hash to try it, for example `?inspect=1#hazard`.
Map downloads default on; see the [download walkthrough and limits](docs/downloads.md#try-a-download).

## Developing

Use Node 24 (24.15.0 or newer) and Yarn 1.22.22. `.nvmrc` selects Node 24;
`package.json` enforces the supported major.

```bash
nvm use        # if using nvm
yarn install --frozen-lockfile
yarn dev
```

Open `http://localhost:3001`, enter the preview PIN, choose **Hazard** and toggle a
layer. The live viewer needs network access to MapX and its CDN dependencies.

For a production build, run `yarn build`, then `yarn preview` and open the URL it
prints. See [Contributing](CONTRIBUTING.md) for checks, test setup and release steps.

## Deployment

Pushes to `main` update GitHub Pages. The www.undrr.org build uses the highest plain
`vX.Y.Z` release tag on `main`, with the next drupal-microsites pipeline.
**Merging here does not update www.undrr.org.**
See [deployment requirements](docs/deployment.md) and [release steps](CONTRIBUTING.md#releasing).

## Project documentation

Use the [documentation index](docs/index.md) to find task guides, technical references,
scope decisions, prototype notes and archived research. Common tasks:

- [Update the layer inventory](docs/inventory.md), including importer limits and review steps.
- [Embed a map](docs/embedding.md#8-how-to-embed-phase-1), with URL options and the host message API.
- [Maintain map downloads](docs/downloads.md#maintenance), including file and CSV eligibility checks.
- [Understand the architecture](ARCHITECTURE.md), with dedicated [legend](docs/legends.md)
  and [external-layer](docs/external-layers.md) references.
- [Contribute a change](CONTRIBUTING.md) or find [deferred technical work](TODO.md).
