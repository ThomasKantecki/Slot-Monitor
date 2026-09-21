# data/

Inputs and datasets. Nothing in here is written by hand.

| Folder | What is in it | Who writes it |
|---|---|---|
| `raw/` | The two provider-directory captures the Provider Index is built from: `ah-directory-scrape.json` (AdventHealth, captured in a Chrome tab) and `oh-directory.json` (Orlando Health, pulled from their search index). Other raw downloads land here too but are not committed. | `directories/` |
| `rosters/` | The rosters the Provider Index page embeds: `roster.json` (every published office per person), `roster-primary.json` (one office per person), `providers-by-zip.json` (per-ZIP counts; the page reads only its capture date). | `rosters/build-rosters.mjs` (`npm run data`) |
| `geography/` | Florida map shapes and lookups: ZIP polygons, county polygons, the state outline, the ZIP-to-county table and ZIP centroids. See its own README. | `tooling/build-geometry.sh` (rare) |
| `cardiology/`, `orthopedics/` | One folder per specialty. `extractions/<run-id>/` holds the raw scraper output and `runs/<run-id>/` the imported physical slots; both stay on the machine that ran the refresh (gitignored). `current/` is the dataset the pages are built from: `manifest.json` (committed; the record of the last pull) and the big slot exports (gitignored, rebuilt by a refresh). | `extractor/` and `slots/` (`npm run refresh:<specialty>`) |

The per-day files the live site loads are not here: they are under `public/data/<specialty>/slots/`.
