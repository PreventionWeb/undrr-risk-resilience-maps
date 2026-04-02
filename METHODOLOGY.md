# Methodology

> Keep this document updated as the project evolves.

## Discovering MapX view IDs

The MapX REST API (`app.mapx.org/get/...`) requires authentication for all view-listing and search endpoints. There is no public/anonymous catalogue API. Tested April 2026; the API returns `{"type":"error","message":"Missing parameter: [\"idUser\",\"idProject\",\"token\"]}` without credentials.

The only unauthenticated way to enumerate views is through the SDK's iframe postMessage bridge. The `get_views` method returns the full catalogue for the loaded project, authenticated automatically via the iframe session.

### Probe script

`scripts/probe-mapx-views.js` is a Playwright test that:

1. Loads a minimal HTML page with the MapX SDK UMD script
2. Creates an `mxsdk.Manager` instance pointing at a project
3. Waits for the `ready` event
4. Calls `get_views` to get the full view catalogue
5. Writes per-project JSON and a combined CSV to `research/`

Run it with:

```bash
npx playwright test scripts/probe-mapx-views.js
```

This produces `research/mapx-views-{project}.json` files and a `research/mapx-views-all.csv` with every view ID, type, title, and description across all probed projects.

### Known MapX projects

| Project ID | Name | Approx. views |
|---|---|---|
| MX-2LD-FBB-58N-ROK-8RH | Eco-DRR Geospatial datasets | ~85 |
| MX-YBJ-YYF-08R-UUR-QW6 | MapX Default/HOME | ~22 |
| MX-Z5J-4IZ-RM2-3O9-506 | Training Project | ~22 |

The Eco-DRR project is the primary source. The HOME project has some global baseline layers (GHSL population, protected areas). Edit the `PROJECTS` array in the probe script to add others.

### MapX REST API routes (for reference, all require auth)

| Route | Purpose |
|---|---|
| `/get/view/item/:id` | Single view details |
| `/get/views/list/project/` | Views in a project |
| `/get/views/list/global/public/` | Public views globally |
| `/get/search/key` | Keyword search |
| `/get/source/summary/` | Source data summary |
| `/get/source/table/attribute/` | Attribute table |

These routes were found by reading the [MapX API source](https://github.com/unep-grid/mapx/blob/main/api/index.js).

### MeiliSearch catalogue API

MapX also exposes a [MeiliSearch](https://www.meilisearch.com/) index at `search.mapx.org` that covers all public views across all projects (~2,100 views). This is how we confirmed most of the view IDs in the [crosswalk](research/gri-mapx-crosswalk.csv).

```bash
curl 'https://search.mapx.org:443/indexes/views_en/search' \
  -H 'X-Meili-API-Key: <key>' \
  --data-raw '{"q":"flood hazard","limit":10}'
```

Response hits include `view_id`, `title`, `project_id`, and `abstract`. API key can be obtained from Pierre. Also documented in the [MapX SDK skill](../mapx-llm-skills/) limitations section.

### SDK probe vs MeiliSearch

- **MeiliSearch**: search by keyword across all projects. Good for finding specific datasets.
- **SDK probe** (`scripts/probe-mapx-views.js`): dump the full catalogue of a specific project. Good for comprehensive inventory. Requires headed browser (WebGL needed for `ready` event).

### Probe output files

The probe script writes to `research/`:

- `mapx-views-eco-drr.json` / `.csv` -- 85 views from Eco-DRR project
- `mapx-views-home.json` / `.csv` -- 22 views from HOME project

These are raw dumps used to build the [crosswalk](research/gri-mapx-crosswalk.csv).
