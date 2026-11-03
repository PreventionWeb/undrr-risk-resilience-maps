# GAR 2026 map handoff

Received 3 November 2026: meeting transcript, `undrr-layer-inventory-2026-11-03-16-23-39- Final.xlsx`, methodology page, and GAR landing-page reference.

## Implemented in this viewer

The workbook's 30 `GAR2026` entries are available under **GAR → GAR 2026**. All 30 MapX item endpoints were checked on intake: they identify polygon vector views in project `MX-FC7-VJG-IKU-MCA-QXM` (UNDRR).

| Workbook layer key  | Viewer key                | Maps | Selector                                                |
| ------------------- | ------------------------- | ---- | ------------------------------------------------------- |
| `aal-crops`         | `gar26-aal-crops`         | 12   | Four crops × current, +2°C, +3°C                        |
| `pml-crops`         | `gar26-pml-crops`         | 12   | Four crops × current, +2°C, +3°C; 50-year return period |
| `top-25-production` | `gar26-top-25-production` | 4    | Wheat, maize, rice, soybean                             |
| `aal-global`        | `gar26-aal-global`        | 2    | Billion USD or % GDP, current climate                   |

The original GAR2026 rows are preserved in [data/gar2026-handoff.csv](../data/gar2026-handoff.csv). The normalized rows in [data/inventory.csv](../data/inventory.csv) use the viewer keys above, category `GAR`, a shared group title in `Layer name`, and each original map title in `Sub-source`. Full titles distinguish scenarios and units: matching on crop alone would be ambiguous. Existing Risk crop placeholders are retained separately from this GAR collection.

Each map's supplied `Note` appears when that map is shown and in its individual Sources row. Map notes and links follow the successfully applied source; an unsuccessful switch keeps the previous map's explanation. Notes are plain text. `Explainer link` maps to optional `explainerUrl`; only absolute HTTP(S) URLs produce a Learn more link. Import/export preserves both columns, and older CSVs without these columns leave configured metadata intact.

For a later batch, normalize the spreadsheet columns as above, review `node scripts/import-inventory.mjs`, then apply with `--apply`. New groups and published/disabled transitions still require manual configuration. Do not apply the raw handoff directly: its repeated crop names and map-specific titles do not match the compound viewer schema.

## Content still needed

- All 30 workbook `Explainer link` cells are blank. Supply verified metric-specific URLs on [the methodology page](https://www.undrr.org/building-risk-knowledge/risk-and-resilience/methodology), adding stable IDs in the page's generator if necessary. No fragments have been guessed. The node reference `https://www.undrr.org/node/103106` resolves to that same methodology page. Interactive browser inspection was blocked by Cloudflare; the web reader returned the page shell but could not verify individual generated metric targets.
- The workbook omits type, license and status for these rows. Type and project were verified against MapX. Inventory status is normalized to `Uploaded` for these supplied, reachable maps; this records availability in the prototype. Licences remain `TBD`; confirm them before release. Source/citation text is preserved as supplied.
- Data requests use `src/config/data-requests.js`. At the user's request, the current recipient is `data-requests@example.org`, clearly labelled as a placeholder in the UI and email body. Replace the address and confirm subject/body wording before launch. The email includes the selected map title/ID, requester details, geography, resolution/format and intended use. This opens a draft in the user's email client; it does not directly download a dataset.
- Additional map batches are expected. Do not fill missing scenarios with another map or assume the first batch is the final inventory.

## Wider meeting actions

The GAR landing page lives at `/Users/khawkins/Documents/git/shared-web-assets-files/gar-26-landing/`, with draft destination `https://www.undrr.org/gar/gar2026`. Its map section currently embeds the experimental European Drought Risk Atlas and says global GAR layers are forthcoming. Updating that embed, caption and introduction is a separate landing-page change once viewer integration is reviewed and released. The meeting's preference for a restrained embed does not remove interactivity from the full viewer.

Other landing-page follow-ups from the transcript: recover the missing flip cards; gather structural/content feedback before the CMS port; upload the supplied images after confirming usage rights; reserve space for the hero video if delivered; and review the map/gallery and infographic interactions. These are recorded as context and have not been changed in this viewer task.
