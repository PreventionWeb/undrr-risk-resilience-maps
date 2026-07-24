# External runtime layers

## Purpose

This note explains how to govern, operate, and extend layers that are fetched from a third-party
service at runtime and then rendered inside MapX. It uses the Copernicus CEMS European Drought Risk
Atlas (EDRA) crop-yield layer as the first implementation.

The short decision is:

- The approach is architecturally contained and appropriate for a trial or a small number of
  exceptional layers.
- It is not equivalent to uploading a stable view to MapX. The browser performs more work and the
  viewer becomes dependent on both MapX and the external provider.
- MapX-hosted layers should remain the default. Every external runtime layer needs an explicit
  product and engineering review.

## Programme-management source tracker

### EDRA row to add

The canonical repository tracker, `data/inventory.csv`, now includes the EDRA entry below. The same
values should be added to the programme team's master source tracker.

| Tracker field           | EDRA value                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variable R-R Initiative | EDRA drought-related crop yield reduction                                                                                                                                                                      |
| Category                | Risk                                                                                                                                                                                                           |
| R2R category            | Environment                                                                                                                                                                                                    |
| R&R Step                | LINK TO YOUR ECONOMIC AND SOCIAL EXPOSURE                                                                                                                                                                      |
| Layer key               | `edra-crop-yield-reduction`                                                                                                                                                                                    |
| Layer name              | Drought impact on crop yields (EDRA)                                                                                                                                                                           |
| Sub-source              | Leave blank                                                                                                                                                                                                    |
| Type                    | Vector / external runtime                                                                                                                                                                                      |
| Description             | Average annual crop yield reduction due to drought at NUTS-2 level for barley, maize, and wheat under historical, current, +1.5 °C, +2 °C, and +3 °C.                                                          |
| MapX view ID            | Leave blank                                                                                                                                                                                                    |
| Source                  | Copernicus Emergency Management Service — European Drought Risk Atlas                                                                                                                                          |
| Citation                | Rossi, L. et al. (2023), European Drought Risk Atlas, Publications Office of the European Union, EUR 31682 EN, doi:10.2760/608737. Contains modified Copernicus Emergency Management Service information 2026. |
| License                 | Copernicus CEMS terms and conditions                                                                                                                                                                           |
| Inventory status        | External runtime                                                                                                                                                                                               |

Important tracker rules:

1. **Do not record an `MX-GJ-*` ID.** MapX creates a new temporary ID in each browser session and
   after every variant replacement. It is not a durable identifier.
2. **Use one row, not 15 rows.** Barley, maize, and wheat plus the five climate scenarios are
   controls on one viewer layer, not permanent MapX sub-sources.
3. **Keep the layer key stable.** `edra-crop-yield-reduction` is the durable identifier used by
   source tracking and shared URLs.
4. **Use `External runtime` as the status.** `Uploaded` would incorrectly imply that UNDRR or MapX
   hosts the data.

### Recommended tracker fields

The current shared CSV schema has no dedicated columns for runtime dependencies. Programme
management should add these fields to the master tracker if it can do so without breaking other
workflows:

| Recommended field       | EDRA value                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Delivery method         | External runtime → temporary MapX GeoJSON view                                               |
| Product/source URL      | `https://drought.emergency.copernicus.eu/tumbo/edra/explore`                                 |
| Scientific publication  | `https://doi.org/10.2760/608737`                                                             |
| Licence URL             | `https://drought.emergency.copernicus.eu/terms%26conditions/`                                |
| Data/service owner      | European Commission Joint Research Centre / Copernicus Emergency Management Service          |
| Runtime dependency      | `drought.emergency.copernicus.eu` geometry and values APIs; browser CORS required            |
| Review cadence          | Quarterly, and after any reported EDRA outage or schema change                               |
| Last technically tested | Date on which geometry, values, CORS, attribution, and all configured variants were verified |
| Business owner          | Named UNDRR programme owner who approves continued use and source wording                    |

If the master tracker cannot add columns, keep these details in a linked note and retain the
existing 14-column repository CSV unchanged.

### Change workflow

- Programme management owns the layer purpose, source approval, citation, licence wording, and
  review cadence.
- A content editor mirrors approved tracker metadata into `data/inventory.csv`.
- Engineering runs `node scripts/import-inventory.mjs` as a dry-run. `External runtime` maps to a
  published layer but intentionally supplies no MapX ID.
- Metadata changes that the importer does not patch—description, source, citation, licence, source
  URL, controls, or provider settings—still require a reviewed code change.
- Engineering must re-run the external-layer contract tests and a live browser check when the
  source API, crop list, scenarios, geometry, or styling changes.

## Architecture boundary

The implementation keeps source-specific behavior behind a provider contract:

```text
layer config
    ↓ stable key + provider name + defaults
sidebar
    ↓ generic open / replace / close calls
external runtime registry
    ↓ provider contract
EDRA adapter
    ├── fetch and cache geometry
    ├── fetch and cache values by crop
    ├── fetch and validate the source explorer's live style configuration
    ├── reproject EPSG:3035 → WGS84
    ├── join NUTS-2 attributes
    └── derive the MapX paint expression and HTML legend from one source definition
```

Responsibilities are deliberately separated:

| Module                             | Responsibility                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `src/config/layers/risk.js`        | Product metadata, stable key, provider name, and defaults                     |
| `src/external/index.js`            | Generic provider contract and temporary-view lifecycle registry               |
| `src/external/edra-agriculture.js` | EDRA-only endpoints, projection, schema, join, style, caches, and timeout     |
| `src/ui/external-controls.js`      | Provider-neutral select controls and loading/error state                      |
| `src/ui/sidebar.js`                | Connect generic external lifecycle events to shared viewer state and controls |
| `src/ui/site-inspector.js`         | Resolve dynamic temporary IDs through the generic runtime registry            |
| `data/inventory.csv`               | Programme-facing metadata and delivery status; never runtime technical IDs    |

Provider-specific URLs, EDRA field names, projections, and crop/scenario rules must not be added to
the sidebar, store, inspector, or MapX SDK wrappers. A second external source should add a new
adapter and one provider-registry entry while reusing the lifecycle and controls.

## Runtime and performance profile

Measurements below were taken from the live EDRA responses on 24 July 2026 and a local development
machine. They describe magnitude, not a service-level guarantee.

| Cost area                 | Observed EDRA profile                                                                                                                           | Practical effect                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Initial geometry response | 7,442,494 bytes decoded JSON (7.10 MiB); 242 features and about 194,716 vertices. The same file is about 3.02 MiB under local gzip compression. | Noticeably heavier than enabling a pre-built MapX view. Paid once per page session, subject to browser HTTP caching. |
| Client reprojection       | About 609 ms in a standalone local Node benchmark for all vertices.                                                                             | One-time main-thread work on first activation; slower devices may pause longer.                                      |
| Values response           | About 48,938 bytes decoded (47.8 KiB) for one crop; about 14 KiB under local gzip compression.                                                  | Small relative to geometry. Cached once per crop in the page session.                                                |
| Style configuration       | One JSON request to the EDRA explorer configuration service per page session.                                                                   | Bucket thresholds, colours, and no-data colour drive both the map and local legend; malformed styles fail visibly.   |
| Scenario change           | No additional EDRA request after the crop response is cached, but joined GeoJSON is cloned into the MapX iframe and reparsed.                   | Faster than first load, but not instant; controls are locked during replacement.                                     |
| Crop change               | One small values request the first time each crop is selected, then the same clone/parse cost as a scenario change.                             | Three crop responses maximum per page session under the current configuration.                                       |
| Browser memory            | Reprojected geometry is retained; MapX retains the active view. Replacement briefly holds old and new views.                                    | Expect tens of megabytes of transient client memory, not only the 7.1 MiB source-file size.                          |
| UNDRR hosting             | The static app serves code only. Data travels from CEMS to the browser and through `postMessage` to MapX.                                       | Little UNDRR server load, but no UNDRR-side cache, proxy, rate limiting, or schema protection.                       |
| Provider traffic          | At least one geometry and one values request per cold page session that activates EDRA.                                                         | Usage traffic is visible to and borne by CEMS; high-volume use should be agreed with the provider.                   |

The integration adds a `proj4` production dependency and CPU-heavy coordinate transformation on
the browser's main thread. One layer of this size is acceptable for the prototype; several
simultaneous external layers of similar size would produce roughly additive network, memory, and
CPU pressure and should not be approved without profiling.

## Reliability, privacy, and operational limitations

- **Two-platform dependency:** MapX and EDRA must both be available. Other MapX layers continue to
  work if EDRA fails, but this layer cannot.
- **Undocumented application APIs:** the crop map is not advertised in the public drought WMS
  capabilities. The adapter follows endpoints used by the EDRA web application, so URLs, field
  names, or response behavior may change without a WMS-style compatibility promise.
- **Style drift:** the adapter reads the crop-to-style mapping, discrete thresholds, colours, and
  no-data colour from the same live configuration used by the EDRA explorer. The MapX paint
  expression and local HTML legend are generated from that one validated response, so they cannot
  drift independently. An unavailable or malformed style response prevents activation rather than
  showing a plausible but incorrectly styled map.
- **CORS dependency:** CEMS must continue allowing the viewer origin to fetch the APIs directly.
- **Client privacy:** activating the layer makes the browser contact CEMS, exposing normal request
  metadata such as IP address and user agent. This should be covered by the site's privacy review.
- **Content Security Policy:** a future CSP must include
  `https://drought.emergency.copernicus.eu` in `connect-src`.
- **Timeout and retry:** requests time out after 30 seconds. Failed cache entries are evicted so a
  later action can retry; the visible variant remains on replacement failure.
- **No durable MapX asset:** temporary views cannot be curated, audited, cached, or repaired in the
  MapX project by programme staff.
- **Shared-link fidelity:** the URL records the active EDRA layer plus its crop and scenario.
  Browser back/forward reconciles those settings through the same transactional replacement path.
- **No service telemetry:** the prototype has console diagnostics but no production uptime,
  latency, schema-drift, or error-rate monitoring.
- **Attribution year:** the citation year must be reviewed when the application or derived data is
  materially updated.

## Production decision and migration triggers

The runtime approach is reasonable while the layer is experimental, exceptional, and used at
prototype traffic levels. Before treating it as production-critical, programme and engineering
owners should explicitly accept the dependency and performance profile above.

Prefer a pre-built MapX view or a UNDRR-controlled, preprocessed WGS84 artifact when any of these is
true:

- EDRA becomes a launch-critical or high-traffic layer.
- First-load latency is unacceptable on representative low-power devices or networks.
- More external layers of similar size are proposed.
- The upstream API or CORS policy proves unstable.
- Programme staff need to manage styling/data entirely through MapX.
- Selected crop/scenario state must be durable and shareable.
- UNDRR needs its own cache, availability target, monitoring, or reproducible data snapshot.

A pragmatic intermediate option is to periodically preprocess and host the simplified NUTS-2
geometry in WGS84, while continuing to fetch the small values response from EDRA. This removes the
largest unversioned request and the client reprojection cost without creating 15 permanent MapX
views.

## Merge acceptance criteria

The implementation work that can be verified locally is part of this PR: complete value coverage,
schema and join validation, request timeout/retry behavior, session caching, transactional MapX
cleanup, exact shared-link state, inventory semantics, visible loading errors, and a live
all-variant contract check. The following items require programme, platform, legal, or operational
authority and are therefore merge-blocking acceptance criteria rather than code assumptions:

- [ ] A named UNDRR programme owner approves the layer purpose, experimental designation, direct
      runtime delivery, and quarterly review cadence.
- [ ] The data/content owner approves the scientific citation, CEMS attribution wording, licence
      URL, attribution year, and the intentional wheat / +2 °C default.
- [ ] Privacy and security owners approve direct browser requests to CEMS and confirm that the
      production privacy notice and CSP `connect-src` policy cover
      `https://drought.emergency.copernicus.eu`.
- [ ] Engineering runs `yarn test:edra-contract` and records a passing result for all 15 variants
      and all three live crop styles close to merge time. CI or an agreed scheduled monitor must
      own subsequent data/style schema and CORS drift detection.
- [ ] Engineering tests a cold activation with 4× CPU throttling and a constrained mobile network
      profile on the agreed minimum device. The layer must become interactive within 10 seconds,
      recover cleanly after the 30-second timeout, and must not crash or freeze the viewer.
- [ ] Product and engineering explicitly choose one operating model: accept the documented
      prototype-level external dependency, host a versioned preprocessed WGS84 artifact, or publish
      stable MapX views. A launch-critical layer may not rely on an unmonitored application API.
- [ ] The programme master tracker contains the EDRA row with blank MapX ID and `External runtime`
      status, plus a named business owner and last-reviewed date.

If any approval or performance criterion fails, keep the PR in draft and use the preprocessed or
MapX-hosted delivery option before launch.

## Checklist for another external source

Do not add another source only by copying the EDRA adapter. Confirm all of the following:

- Programme owner, source approval, citation, licence, and review cadence are recorded.
- Stable source endpoints and CORS behavior are verified.
- Decoded and compressed payload sizes, feature/vertex counts, first-load time, and memory behavior
  are measured.
- Projection and coordinate order are explicit.
- Join keys and no-data behavior are tested.
- Requests have a timeout, failed-cache eviction, and user-visible failure state.
- Create/replace/delete operations cannot orphan a view or corrupt `openViews`.
- Source-specific logic stays in its adapter and uses the generic provider contract.
- The layer is represented as `External runtime` with a blank MapX ID in the tracker.
- Unit, build, and live browser tests cover activation, replacement, inspection, removal, upstream
  failure, and narrow-screen layout.
