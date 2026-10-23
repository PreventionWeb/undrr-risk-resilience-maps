# Public legend contracts

Captured from the MapX public view API and the two GeoServer providers on 2026-10-23.
These fixtures contain only legend-relevant fields, including the full methods text
for the four custom-code views so SHA-256 drift checks run without executing code.
The application's runtime uses `get_views`, not these fixtures or the public view API.

`src/sdk/legend-coverage.test.js` checks every configured MapX source against this
recording. New source IDs must be added here after review. The opt-in live check
`yarn test:mapx-raster-contract` audits all configured sources against current data.
Do not refresh a custom-code hash without reviewing the source style and legend.
