# directories/

Step 1 of the Provider Index: capture each health system's public doctor directory. The captures land in
`data/raw/` and are turned into rosters by `rosters/`.

**AdventHealth** publishes its Medical Group listing on adventhealth.com, but that site refuses requests that
do not come from a real browser. So the capture runs inside a Chrome tab: the parser in
`capture-adventhealth.mjs` is pasted into the page, it walks the listing page by page, and the browser saves
one JSON file. Then `node directories/capture-adventhealth.mjs --import <that file>` checks the capture is
complete (at least 98% of the listed clinicians, at least 90% with an address) and writes
`data/raw/ah-directory-scrape.json`. `npm run adventhealth` is the direct-fetch version, kept for when the
site allows it again.

**Orlando Health**'s physician finder is backed by a search index (Algolia) that returns the same records as
JSON. `npm run directory` pages through it and writes `data/raw/oh-directory.json`.

| File | What it does |
|---|---|
| `capture-adventhealth.mjs` | The AdventHealth listing parser and the `--import` path that validates and stores a Chrome capture. |
| `adventhealth.js` | Reads the AdventHealth capture into the shared provider/office shape (`toAhRoster`), repairing bad ZIPs against the map. |
| `orlando-health.js` | Pulls the Orlando Health finder (`npm run directory`) and reads it into the same shape (`toRoster`), merging duplicate NPIs. |

Both readers use `rosters/labels.js` so the two systems' specialty names line up.
