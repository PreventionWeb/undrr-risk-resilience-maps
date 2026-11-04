# Data downloads (prototype)

> Status: prototype behind a URL flag ([#64](https://github.com/PreventionWeb/undrr-risk-resilience-maps/issues/64)).
> Making downloads public needs programme sign-off. Until then the "Request data" email link stays
> the public route.

## Turning it on

Add `?downloads=1` (or `?downloads=true`) before the hash: `/?downloads=1#hazard`. It works the same
on `embed.html` (`embed.html?downloads=1&tab=hazard`), and the embed's full-viewer link keeps it. Any
other value, a blank value or a repeated parameter leaves downloads off, so a mistyped flag fails
closed. Programmatic instances take `createRiskMap(root, { downloadsEnabled: true })`; the central
default is `MAP_DOWNLOADS_ENABLED` in `src/config/features.js`.

With the flag off, nothing changes: no download controls, no Sources column, no dialog.

## What is offered

| Layer kind                      | Download                                   | Where it comes from                                              |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Raster views with a hosted file | A link to each GeoTIFF, with format & size | Files hosted by UNEP/GRID-Geneva at `gar-data.unepgrid.ch/2026/` |
| Region-level vector views       | "Download CSV": values per region          | Generated in the browser from the view's MapX attribute table    |
| Everything else                 | Nothing; keeps "Request data" where shown  | –                                                                |

Downloads appear in the layer panel (for the view shown: a compound layer's selected source) and in a
**Download** column on the Sources page (every source of a compound layer, named by its label). A view
with a download no longer shows "Request data"; a view without one keeps it.

Files over 1 GB carry a warning. The links have a `download` attribute, but browsers ignore it for
another origin, so a GeoTIFF may open a save dialog or start downloading directly depending on the
browser.

## Where the data lives

### Hosted files

`data/inventory.csv` has two optional columns, supplied together:

- **Download URL**: one or more https URLs, separated by `;`.
- **Download size (bytes)**: the matching sizes, in the same order.

`scripts/import-inventory.mjs --apply` writes them to the view's config as
`downloads: [[url, bytes], ...]` (a simple layer, or one compound source). Tuples rather than objects
because the importer matches source objects textually and must not meet nested braces. Sizes are
stored, not fetched, so drawing a link costs no request; refresh them with a `HEAD` request when GRID
replaces a file. `validateLayers()` rejects anything that is not `[https URL, positive integer]`, and
the inventory export writes the two columns back out.

The list came from GRID (one row per raster view, 20 views, one layer group with two files). One URL
was wrong in the supplied list: the 475-year PGA file is `PGA_475y.tif`, not `PGA_450y.tif`.

### CSV eligibility

By rule (`isCsvEligible()` in `src/config/downloads.js`): a published, non-external `vt` view, minus
`CSV_EXCLUDED_VIEWS`. That gives 69 views today. The exclusions, checked against live MapX in the #64
spike:

- `MX-MDFMH-34XOD-EU9HN`: the view's attribute list has no region code (its sibling views do; GRID
  could add it).
- `MX-Z7JZA-I9BQC-KKVOT`, `MX-TQ2DK-9RHAJ-CRPAN`, `MX-1L2TA-6FXPV-N3QMX`, `MX-FX1HT-Z7KXL-8X22K`:
  not region-level (grid cells, river basins, forest classes), so values without geometry identify
  nothing.

## The CSV

Built by the pure `buildRegionCsv()` in `src/utils/region-csv.js`.

- **Columns:** `iso3`, `region_name`, then the value. One value column is named after the view's label
  in our config (layer label, plus the compound source label); several are named by attribute with the
  `jN_` join prefix removed.
- **Region names:** `maplab` (the UN map label). `name_en` is never used: it holds romanised local
  names joined with `#`. About 40 views carry only `name_en`; for those, names are read at runtime from
  another view on the same boundary table that does carry `maplab` (`REGION_NAME_REFERENCE_VIEW`), once
  per session. A code with no label there is left blank, as is every name if that read fails. No list
  of names is kept in this repository.
- **Rows dropped:** `gid` (an internal id) is never written; rows with no value; and rows whose code is
  not a standard ISO 3166-1 alpha-3 code (three uppercase letters). The boundary table holds a few
  areas with placeholder codes, and some views carry values for them; they are left out until GRID
  advise how to publish them.
- **Format:** UTF-8 with a byte-order mark (so Excel reads accented names), CRLF line ends, RFC 4180
  quoting. Text that a spreadsheet would run as a formula gets a leading apostrophe.
- **Filename:** `<layer-key>_<view-id>.csv`, e.g. `gar26-aal-crops_MX-UN9Z8-4M5QH-PMDNX.csv`.

### Metadata: a header block, not a sidecar

The file starts with `# `-prefixed lines taken from our layer config: title, description, source,
source URL, citation, license, MapX view ID, layer key, download date, the viewer URL, how region names
were sourced, and a note that boundaries are not included. One download carries its own attribution,
and browsers do not prompt about a second file. Data tools skip the block with a comment option:

```python
pandas.read_csv("file.csv", comment="#")
```

```r
read.csv("file.csv", comment.char = "#")
```

Spreadsheets show the block as the first rows. MapX's own view metadata is not used: it has no
human-readable labels, units or citations for most views, and `get_view_meta` includes editor emails.

## How the CSV is generated

`createDownloads()` (`src/ui/downloads.js`) runs the flow behind a "Download CSV" button, in a
progress dialog (`src/ui/download-dialog.js`):

1. **Fetching data:** wait up to 30 s for MapX to be ready, then read the table with
   `get_view_table_attribute` (`src/sdk/table.js`). Every SDK call has a deadline.
2. **Processing:** build the CSV.
3. **Downloading:** save it through a temporary link; the dialog then says how many regions it holds.

Errors (timeout, MapX failure, a table without region codes) show in the dialog with **Try again**.
Closing the dialog abandons the run; nothing is downloaded.

### Views that are not on the map

MapX answers `get_view_table_attribute` only for a view loaded in the session. A view that is not is
added for the read and removed again, outside the layer controller:

- the layers store is never written, so the switch, the URL and `openViews` do not see it;
- it is added with `zoomToView: false`, so the camera does not move;
- before removing it, the sidebar is asked whether a layer record now wants that view (the user turned
  the layer on meanwhile); if so it stays;
- an add that misses its deadline is removed if it lands later;
- views the session has loaded (on the map now or earlier, or added for a previous read) are read
  without another add.

This was chosen over the alternatives:

- **Turning the layer on through the controller** would write the URL and history, open the row and
  move the map — a download would change what the user is looking at.
- **Offering CSV only for layers on the map** would leave the Sources page with almost nothing.

In the layer panel a row's downloads are only visible while the layer is on (expanding a row turns it
on), so the temporary add mostly serves the Sources page, where the map sits invisible behind the page.

### Accessibility

The dialog is a native `<dialog>` opened with `showModal()` (the rest of the page becomes inert). It
also keeps Tab inside itself, closes on Escape and returns focus to the button that opened it. Each
state is spoken through a live region from the app's announcer (`createLayerAnnouncer`), placed
inside the dialog: a modal makes everything outside it inert, which would silence the sidebar's own
region while the dialog is open.

## Limitations and open questions for GRID

- Values for non-standard or special areas are left out. How should they be handled in exports?
- One view lacks region code and name columns. Can they be added to it (and `maplab` to the views that
  only carry `name_en`)?
- Is reading MapX attribute tables through the SDK a supported, stable use for public downloads?
- Can views carry readable attribute labels and units? Until then the value column is named from our
  config and units are not stated.
- Is there an area ID for the GEM, water stress and intact forest views, or should they have no CSV?
- The Sources page needs MapX to have started. Where the map does not warm up behind information pages
  (see `src/ui/map-warming.js`), the dialog asks the user to open a map category first.
