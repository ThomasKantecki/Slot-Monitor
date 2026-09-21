# test/

`npm test` runs every file here in one Node process (no test framework to install). One file per pipeline
stage, 106 tests in all. Several tests read the committed data and built pages, so run `npm run build`
first if you changed a render.

| File | What it covers |
|---|---|
| `directories.test.js` | Reading each directory capture into the roster shape, Orlando Health record fixes, the AdventHealth listing parser and the Chrome-capture import guards. |
| `rosters.test.js` | Rebuilding people from the roster files, grouping a specialty's labels, the scope rules, MyChart-only additions, person matching, and the roster data check. |
| `extractor.test.js` | The Python scripts compile and dry-run for every specialty; the paging loop and the questionnaire walker survive scripted Epic behaviours (`extractor/paging_check.py`, `extractor/walk_check.py`); deduplication; run selection. |
| `slots.test.js` | The compact slot model: dedup, Florida filter, Eastern day and time, video and new-patient flags, the catalog list, and the three comparison filters. |
| `pages.test.js` | The three built pages: header and data-check dialog, Slot Availability markup and controls, the Provider Index render, market scoring and page, the data-check reports, dates and distances. |
| `specialties.test.js` | The registry's shape and paths, the specialty menu on every page, and placeholder pages for a specialty without data. |

Deeper checks that need the local slot exports or a browser live in `checks/`.
