# Cardiology Access

One self-contained repository for Cardiology extraction, processing, and two
static healthcare-access views:

- `index.html` — repository-root launcher for the Slot Availability landing
  page.
- `public/index.html` — Cardiology physical slot availability by ZIP/county,
  with calendar, location, provider, appointment-time, and AH booking-category
  detail.
- `public/provider-map.html` — Cardiology provider coverage by ZIP and county.

## Project ownership

- **Provider Index:** `src/render.js` and the existing data pipeline.
- **Slot Times:** `src/slot-times/`.
- **Shared navigation only:** `src/shared/suite-navigation.js`.

This separation lets each view be developed on its own branch without mixing
map logic. Generated files in `public/` should be rebuilt rather than edited by
hand.

## Provider Index

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

Node 20 or newer and Python 3.9 or newer. The Cardiology appointment extractor
uses only Python's standard library. No credentials, Selenium, pandas, or npm
dependencies are required.

## Commands

```
npm test              # run the data and rendering checks
npm run directory     # re-pull the Orlando Health directory (8 requests)
npm run adventhealth  # re-pull Medical Group cards, photos and locations
npm run data          # rebuild both location-mode datasets from data/raw
npm run build         # rebuild both public pages
npm run build:provider-map  # rebuild only the Provider Index
npm run build:slot-times    # rebuild only Slot Times
npm run refresh:cardiology:dry-run # validate the complete refresh command
npm run refresh:cardiology  # AH + OH extraction, dedup, promote, and site build
npm run extract:ah          # run only the AH Cardiology extractor
npm run extract:oh          # run only the OH Cardiology extractor
npm run all           # directory + data + build
python3 scripts/build-deck.py   # rebuild the two deck files onto ~/Desktop
```

The detailed extraction controls and storage layout are documented in
`extractors/cardiology/README.md`.

## Website deployment

The generated `public/` folder is the complete static website and can be used
as the publish directory on a static host. Its root address opens Slot
Availability, and the shared switcher links to Provider Index. The
deployed site remains static; extraction runs from the source repository.

## Data sources

- **Appointment availability** — the in-repo direct API extractors traverse
  each system's anonymous Epic Cardiology workflow, save flow-level audit data,
  deduplicate physical slots, retain AH booking categories, and promote the
  latest valid system runs into `data/cardiology/current`.

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
