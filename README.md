# UNDRR Risk & Resilience Map Viewer

An interactive geospatial explorer for UNDRR's Risk & Resilience Metrics initiative.
Explore Risk, Resilience, Hazard, Exposure and Vulnerability through toggleable MapX
layers, legends and map downloads. A CSV inventory lets the programme team maintain
layer metadata with developer review.

## Open the viewer

Open the [released viewer](https://www.undrr.org/m/risk-and-resilience-maps/) or the
[GitHub Pages preview of main](https://preventionweb.github.io/undrr-risk-resilience-maps/).

Choose a category and toggle a layer to explore the map. Share its URL to preserve
the active tab and layers. **Show unpublished** reveals descriptions of unpublished entries.
To enable click inspection, add `?inspect=1` before the hash, as in
`?inspect=1#hazard`.
Map downloads default on; see the [download walkthrough and limits](docs/downloads.md#try-a-download).

## Developing

Use Node 24 (24.15.0 or newer) and Yarn 1.22.22. `.nvmrc` selects Node 24;
`package.json` enforces the supported major.

```bash
nvm use        # if using nvm
yarn install --frozen-lockfile
yarn dev
```

Open `http://localhost:3001`, choose **Hazard** and toggle a
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
scope proposals and archived research.

- [Update the layer inventory](docs/inventory.md), including importer limits and review steps.
- [Embed a map](docs/embedding.md#8-how-to-embed-phase-1), with URL options and the host message API.
- [Maintain map downloads](docs/downloads.md#maintenance), including file and CSV eligibility checks.
- [Understand the architecture](ARCHITECTURE.md), with dedicated [legend](docs/legends.md)
  and [external-layer](docs/external-layers.md) references.
- [Contribute a change](CONTRIBUTING.md) or find [deferred technical work](TODO.md).
