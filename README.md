# Provider Map + Slot Times

Two independent healthcare-access views in one repository, joined by a shared
top switcher. Both are self-contained pages that can be opened without a
server:

- `public/provider-map.html` — Florida provider coverage by ZIP and county.
- `public/slot-times.html` — the separate Slot Times development area.

## Project ownership

- **Provider Map:** `src/render.js` and the existing data pipeline.
- **Slot Times:** `src/slot-times/`.
- **Shared navigation only:** `src/shared/suite-navigation.js`.

This separation lets each view be developed on its own branch without mixing
map logic. Generated files in `public/` should be rebuilt rather than edited by
hand.

## Provider Map

Florida bookable-provider coverage, AdventHealth vs Orlando Health, from each
system's own public directory.

The map opens in **All locations** mode: a clinician appears once in every ZIP
or county where the directory says they practice. Its headline counts distinct
provider-office assignments, so the number remains the same when the map is
grouped by ZIP or county. **Primary only** reduces the footprint to one primary
or first-published office and shows distinct statewide clinicians. Provider
cards group all offices in the selected area and show a directory photo when
one is published.

## Requirements

Node 20 or newer. No npm dependencies. Python 3 with `python-pptx` is
needed only for the presentation deck, nothing else.

## Commands

```
npm test              # run the data and rendering checks
npm run directory     # re-pull the Orlando Health directory (8 requests)
npm run adventhealth  # re-pull Medical Group cards, photos and locations
npm run data          # rebuild both location-mode datasets from data/raw
npm run build         # rebuild both public pages
npm run build:provider-map  # rebuild only the Provider Map
npm run build:slot-times    # rebuild only Slot Times
npm run all           # directory + data + build
python3 scripts/build-deck.py   # rebuild the two deck files onto ~/Desktop
```

For Slot Times work, create a feature branch, make changes under
`src/slot-times/`, run `npm run build:slot-times` and `npm test`, then open a
pull request. See `src/slot-times/README.md` for the collaborator boundary.

## Website deployment

The generated `public/` folder is the complete static website and can be used
as the publish directory on a static host. Its root address opens the Provider
Map, and the shared switcher links to Slot Times. No source files, scripts or
raw captures need to be included in a deployment.

## Data sources

- **Orlando Health** — the physician-finder's Algolia records provide identity,
  employment, specialty and every practice location. `npm run directory`
  refreshes those records. Photo URLs come from the public finder UI and are
  merged from `data/raw/oh-photo-scrape.json` when that optional browser capture
  is present.
- **AdventHealth** — the Medical Group directory's server-rendered result cards
  provide identity, specialty, photo and every listed location. Run
  `npm run adventhealth` to refresh `data/raw/ah-directory-scrape.json`.

## Methodology in one line

Employed clinicians in bookable clinic specialties, one specialty each. Primary
mode shows distinct statewide providers; all-locations mode shows distinct
provider-office assignments across all published Florida practice locations.
The details live in comments in `src/specialty.js`, `src/sources/*.js`
and `src/geo.js`.
