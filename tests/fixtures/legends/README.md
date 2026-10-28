# Representative public legend contracts

Captured from the MapX public view API and GeoServer on 2026-10-23.
Keep only discrete (cyclone surge), continuous (HDI) and grouped (GAR drought)
raster examples, plus the four custom-code views. Existing vector adapter unit
tests cover vector styles; repeating the entire catalogue here adds little value.

The full methods text for each custom-code view is retained to exercise the real
SHA-256 pin without executing upstream code. These four definitions are manually
maintained: review the source style before changing a definition, hash or fixture.

These samples test supported shapes offline; they do not prove current coverage of
every map. `yarn test:mapx-raster-contract` fetches and audits all configured MapX
sources live. The runtime uses `get_views` and provider JSON, never these fixtures.
