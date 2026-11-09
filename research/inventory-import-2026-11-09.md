# Inventory import review — 9 November 2026

Source: `undrr-layer-inventory-2026-10-29-16-23-39- Final.xlsx`, sheet
`undrr-layer-inventory-2026-10-2` (138 data rows).
SHA-256: `5b76fd2a0ffe550c7b67b21400b8662a84288af34aa82ef8aad57c204a37f4af`.
Baseline: `cf37f18` (`origin/main`, v0.0.13).

## Import decisions

- Renamed `More detail information, please visit` to `Explainer link` and ignored the
  entirely empty unnamed column. Used the URL text, including its metric fragment;
  Excel's embedded hyperlinks often point only to the methodology page root.
- Matched the 108 non-GAR2026 rows by stable layer key and sub-source. Matched all
  30 GAR2026 rows by MapX ID, retaining the maintained `gar26-*` keys, group labels,
  full crop/climate source labels, types, licences and uploaded status. The workbook
  repeats crop keys and short source labels and leaves several structural cells blank.
- Preserved all reviewed hosted URLs, sizes and CSV-download decisions, which are
  absent from the workbook. Preserved all MapX IDs and publication statuses.
- Imported notes for all entries (108 changed) and 134 methodology/provider links.
  Corrected six inventory type cells (HDI and five previously blank GAR2025 cells)
  and the unconfirmed `life-years-lost` licence to match the existing runtime config.
- Kept existing GAR2025 source/citation credits and CC BY 4.0 licences. Workbook
  rows 105–109 increment licence versions from 4.1 to 4.5, and rows 106–109
  increment GAR years from 2026 to 2029 while still classified GAR2025. These look
  like autofill artefacts; the proposed credit changes need content-owner verification.
- Left the ecosystem-loss methodology link empty: workbook row 33 points to the
  housing-loss metric. A relevant ecosystem-loss methodology link is still needed.
- Removed “in millimetres” from the river-flood-depth note (row 76), because it
  contradicts the existing reviewed source-legend note, which reports cm. Kept the
  return period and annual exceedance probability. No data or legend conversion changed.

## Red-team validation

- Checked workbook row coverage, duplicate identities, formulas and hidden rows.
  There are no formula cells or hidden rows. All 138 rows resolve uniquely after
  GAR normalization; all 30 crop/climate GAR maps retain their identities.
- Compared every exported row with the maintained CSV for MapX ID, note,
  explainer URL, hosted URLs/sizes, CSV decision, source, citation, licence and status.
  All 138 rows match. Compared identities, IDs, publication status, attribution and
  download settings against the baseline: unchanged.
- Checked imported text for spreadsheet formula prefixes and links for HTTPS and
  control/markup characters. Re-ran the importer after applying and formatting:
  all 138 entries match, with no outstanding changes.
- Ran lint, the full unit suite (1,242 tests), production build and the Chromium
  browser suite (112 tests). Updated stale test assumptions about collapsed compound Sources
  rows and one-line properties: per-source notes now expand those rows, as the
  existing viewer already supports. The import adds no runtime application logic.
- Manually opened Sources and a live Recovery Speed map, checked the methodology
  URL and switched household/hazard scenarios. Checked Sources at a 375 px viewport:
  document width remains 375 px. Local screenshots are in
  `/tmp/undrr-inventory-qa/screenshots/` (not committed).

## Limits and remaining content review

The UNDRR methodology page returns a Cloudflare challenge in the interactive
browser (and HTTP 403 via curl), so live metric-fragment resolution could not be
verified. Supplied provider links and their scientific fit have not been fully
revalidated. In particular, the forest map describes MODIS 2020 while its supplied
link goes to the JRC Global Forest Cover site. The programme team should confirm
that destination. Links for crop-production context and global losses intentionally
retain the workbook's crop-loss methodology destination.

The deterministic browser suite stubs MapX and external data services. The manual
map check is a spot check, not a new upstream-data or download-contract certification;
IDs and downloads did not change in this import.
