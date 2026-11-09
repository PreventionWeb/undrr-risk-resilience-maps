# Update the layer inventory

[data/inventory.csv](../data/inventory.csv) is the maintained source for layer metadata
and permanent MapX view IDs. The programme team supplies content; a developer reviews
the import and any configuration edits. Ownership and review cadence still need agreement
under [resourcing WP-9](resourcing-plan.md#wp-9--content-pipeline--editorial-workflow).

Use the [README setup](../README.md#developing) first. The importer reads CSV, not `.xlsx`;
convert colleague spreadsheets to the repository's CSV shape before importing. Normalize handoff columns and compound source labels before importing a raw spreadsheet.

## Review and apply an update

1. Update `data/inventory.csv`, preserving its headers and stable layer keys. Existing
   compound sources must match the configured source labels. Retired keys in
   [data/removed-layer-keys.txt](../data/removed-layer-keys.txt) are ignored by the importer
   so upstream exports cannot reintroduce them.
2. Run the dry-run report from the repository root:

   ```bash
   node scripts/import-inventory.mjs
   ```

   To compare a candidate without replacing the maintained CSV, use
   `node scripts/import-inventory.mjs --input /path/to/candidate.csv`. This is also a dry-run.
   Review reported changes, unmatched entries and manual-edit warnings.

3. After review, apply the maintained CSV:

   ```bash
   node scripts/import-inventory.mjs --apply
   ```

   `--input` with `--apply` patches JS configuration from the candidate, but does not copy
   it into `data/inventory.csv`. Keep the maintained CSV and config together in the change.

4. Make any required manual configuration edits, then inspect the CSV and config diff.
   Run `yarn lint`, `yarn test` and `yarn build`; open the affected category in the viewer
   and confirm labels, status and selected sources. Check Sources attribution as well.
   Use the [contribution workflow](../CONTRIBUTING.md#workflow) to submit the update.

## What the importer changes

The [importer source](../scripts/import-inventory.mjs) defines supported fields and validation.
`--apply` syncs MapX IDs, labels, descriptions, supported transitions between disabled
statuses, and supplied optional metadata. It does not create new layer groups or automate
published/disabled transitions. Source attribution, citation, license, legends, widgets,
source URLs, geometry and external provider definitions need developer edits.

The required headers are:

```text
Variable R-R Initiative, Category, R2R category, R&R Step, Layer key, Layer name,
Sub-source, Type, Description, MapX view ID, Source, Citation, License, Inventory status
```

Missing or renamed required columns stop the import. Optional columns are:

| Column                                     | Meaning                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `Note`                                     | Layer/source note                                                                             |
| `Explainer link`                           | Methodology link                                                                              |
| `Download URL` and `Download size (bytes)` | Hosted files and matching sizes, supplied together; multiple values use `;` in the same order |
| `CSV download`                             | `yes`, `no: <reason>`, or blank (not reviewed)                                                |

Omitting optional columns preserves configured values; supplying blank cells can clear them.
Download removal and changes to a CSV-enabled view ID have extra safeguards.
Follow [download maintenance](downloads.md#maintenance) for vetting, contract checks,
`--allow-removals` and `--csv-vetted`; do not bypass those checks just to make an import pass.

## Special cases

Runtime external layers have a blank MapX ID and `External runtime` inventory status.
Temporary `MX-GJ-*` IDs are not durable inventory IDs. Follow the
[external-source tracker and change workflow](external-layers.md#programme-management-source-tracker)
for provider settings and governance; do not create one row per selector combination.

The Sources page exports a timestamped inventory CSV from the configured layers. It is
separate from per-map GeoTIFF and values-only CSV downloads. For research methods to
discover a new MapX ID, see [Methodology](../METHODOLOGY.md).
