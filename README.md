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
python3 scripts/build-exec-deck.py   # six-slide executive deck onto ~/Desktop (needs assets/deck/*.png)
```

The detailed extraction controls and storage layout are documented in
`extractors/cardiology/README.md`.

## Website deployment

The generated `public/` folder is the complete static website and can be used
as the publish directory on a static host. Its root address opens Slot
Availability, and the shared switcher links to Provider Index. The
deployed site remains static; extraction runs from the source repository.
There is no scheduled refresh. To update the data, run `npm run refresh:cardiology`
locally, commit `data/cardiology/current` and `public/`, and push.

## Refreshing the data

The extractor under `extractors/cardiology` is the agreed method for every future
pull; `extractors/cardiology/README.md` explains why and how to run it. In short:
create the Python environment once (`python3 -m venv .venv`; the extractor needs
only the standard library), run `npm run refresh:cardiology`, let it run to the
end (AdventHealth takes most of a day), then `npm test` and commit the rebuilt
`public/` folder.

## Data sources

- **Appointment availability** — the in-repo direct API extractors traverse
  each system's anonymous Epic Cardiology workflow, save flow-level audit data,
  deduplicate physical slots, retain AH booking categories, and promote the
  latest valid system runs into `data/cardiology/current`. Every published
  Florida slot is kept and shown by default. The Comparison filters
  (`src/slot-rules.js`) narrow both sides the same way: physicians only,
  because AdventHealth also opens nurse practitioner, physician assistant,
  nurse and pharmacist schedules to online booking and Orlando Health does
  not; in-person only, because Orlando Health publishes no video visits
  online; and new patients only, the visit types a new patient can book.

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

## Published data layout

The built pages embed only a compact summary (`public/data/cardiology/slot-times-summary.json`: providers, facilities, totals, dates). The appointment slots themselves are published one file per bookable date under `public/data/cardiology/slots/`, and each page fetches just the dates in the selected period (the landing view is the next 90 days). `npm run build` writes both from `data/cardiology/current/slot-times-model.json`, which is build-only and not committed; a checkout without it keeps the published partitions.
