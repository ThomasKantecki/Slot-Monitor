# data/geography/

Florida map shapes and lookups. All four pages draw from these; nothing here changes between refreshes.

| File | What it is | Used by |
|---|---|---|
| `fl-zcta.geojson` | Every Florida ZIP code area as a simplified polygon (Census ZCTAs, clipped to the coast). | the three maps, the roster ZIP repair, the audits |
| `fl-county.geojson` | The 67 county polygons. | the county view on every map |
| `florida-outline.geojson` | The state's coast outline (outer rings of the dissolved counties), drawn on top of every map. | the three maps |
| `zip-county.json` | `{ "32804": "Orange", ... }`: which county each ZIP belongs to. | every build and audit |
| `florida-zip-centroids.js` | One point per ZIP (latitude, longitude) for the radius ring and the market distances on the slot and market pages. | the slot and market pages, the radius test |

Regenerate the shapes with `npm run geometry` (downloads from the Census, needs the network and `npx mapshaper`).
