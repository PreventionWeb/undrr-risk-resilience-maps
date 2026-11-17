# Programme inventory review — 17 November 2026

Reviewed against `eb0b0bb` from `main`. The earlier inventory import was merged
in PR #78; the only open PR at review time was #82 (UX prototypes).

Source: `17-11-2026 UNDRR_Layer Map Visualizer .xlsx`, sheet
`undrr-layer-inventory-2026-10-2`, SHA-256
`cc126b07ac7ce08d7dbc053f77e2cc8c47c3fde53ac5de7e1da62299c43108b2`.
[The raw handoff CSV](../data/handoff-2026-11-17.csv) preserves all 167 data rows
and Excel's cached methodology values. It is evidence, not import-ready inventory.
The workbook has no hidden rows; its unnamed empty column is retained in that CSV.

All 138 existing entries matched uniquely, by MapX ID where present and otherwise
by layer key and source label. None were removed and no existing view IDs changed.
Import 38 revised notes and credits for the eight planned crop-loss entries and
30 existing GAR2026 entries. The 29 new views form 14 controls in GAR2026; crops
and population/measure variants share selectors. Existing GAR crop/scenario order,
stable keys, types, statuses, downloads and methodology links are preserved.

## Regressions excluded from the import

- All 167 methodology cells contain external `VLOOKUP` formulas keyed by the
  initiative, which is not unique. Cached values incorrectly repeat UNICEF for
  many unrelated existing maps and every new GAR map. Keep reviewed existing
  links; leave new methodology links absent until metric-specific URLs arrive.
- GAR2025 source/citation years advance through GAR2029 and licences advance
  through CC BY 4.5. These repeat the autofill defects identified in #78. Retain
  GAR2025 and CC BY 4.0.
- Existing GAR2026 rows have blank type, licence and status cells, generic keys
  and individual names. Match by ID and keep the established controls and labels.
- River-flood depth again claims millimetres. Retain the reviewed unit-neutral
  note: #78 recorded a source legend in centimetres.

## New maps and remaining editorial questions

All 29 supplied IDs resolve through MapX's public `get/view/item/<id>` endpoint,
in project `MX-FC7-VJG-IKU-MCA-QXM`. They are polygon vector views with joined
numeric attributes, `iso3cd` and `maplab`. Titles and attributes match the supplied
metrics, including crop, count/percentage, population and time-period distinctions.
The live download contract check passed for all 29 on 17 November 2026, so they
offer values-only regional CSV downloads. No hosted raster URLs were supplied.

New licences are blank in the handoff: represent them as `TBD`, consistent with
existing GAR2026 entries. Retain the supplied programme credits, including
`CROPGRIDS, 2026` on existing top-producer maps. The MapX abstracts identify more
specific underlying providers (FAO, UN Women, Middelanis et al., WorldPop, UNESCO,
GIRI/CIMA and others); provider-level citations and licence confirmation remain
editorial follow-up. Do not infer licences from the generic programme credit.

The four new food-import-dependence views have an upstream legend inconsistency:
the class labelled “Very high (50–60%)” covers values above 50 through 99.9999 in
the MapX style. This is present in all four public view definitions, including
[`MX-M28TX-840DM-HCYBJ`](https://api.mapx.org/get/view/item/MX-M28TX-840DM-HCYBJ).
The programme team should ask the map owner to confirm the label or class bound.
The import retains the supplied MapX styling; no local legend override is added.

Normalize Category `Risk` to `GAR` for new GAR2026 rows, matching the existing
viewer placement. Repeated keys with different layer names are normalized to
shared control names; each variant retains its supplied metric title as its source label, description
and note. Full metric labels distinguish similarly named crops in Sources and
resource details. Single-view
entries have no redundant sub-source. Full CSV export matches the maintained
inventory across all 167 rows and all columns; the importer reports no remaining
changes or unmatched entries.

## Validation

- Lint, production build, formatting on edited files and `git diff --check` pass.
- All 1,253 unit tests pass.
- The full stubbed Chromium run passed 121 of 123 tests; two assertions still
  expected the previous rice-loss wording. After updating those assertions, all
  22 tests in the affected download, source-switch and Sources-navigation files
  pass, including three new map deep-link/reload checks.
- The live download contract passed for 99 vector views, including all 29 new
  views. Hosted-file checks were skipped because no hosted files changed.
- Live desktop spot checks cover the wheat/soybean selector, rendered map and
  legend, resource credits, licence and CSV control. A health-exposure percentage
  deep link selects the correct population/measure. Map and Sources checks at
  375 px show no document overflow. Browser suites stub external map services;
  live visual checks are spot checks, not validation of every map's values.
- An independent runtime comparison finds no changes to existing configuration
  except the intended notes and credits. Inventory export matches all 167 rows
  and all columns, every new ID occurs once, and repeat import is a no-op.
