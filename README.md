# Cardiology Access

A comparison of Cardiology appointment availability between AdventHealth and
Orlando Health in Florida, built from the public online-scheduling data both
systems publish.

Live site: https://thomaskantecki.github.io/Slot-Monitor/

## What is here

Three pages, all static HTML in `public/`:

- **Slot Availability** (`index.html`): how many Cardiology appointments each
  system has open, by ZIP or county, with a map, a calendar and a provider list.
- **Market Opportunities** (`market-opportunities.html`): where Orlando Health
  has availability that AdventHealth does not match, ranked by 25-mile market.
- **Provider Index** (`provider-map.html`): which Cardiology providers each
  system lists, by ZIP and county, from the two public provider directories.

## Where the data comes from

Both systems let anyone browse open appointment slots on their websites without
logging in. The scraper in `extractors/cardiology` reads that same public
scheduling data, one page at a time, for every Cardiology visit type, and saves
every open slot with its provider, location, date and time. It does not log in,
book anything, or touch patient information.

The scraper is the one agreed method for pulling this data. It walks each
schedule to the end, recovers when the scheduling site stalls or drops a
request, can resume an interrupted run, and has an offline test that replays
the tricky cases. `extractors/cardiology/README.md` explains how it works and
why it replaced the earlier scripts.

Provider directory data for the Provider Index comes from each system's public
physician finder (`npm run directory` and `npm run adventhealth`).

## Running it

Needs Node 20+ and Python 3.9+. No packages to install.

```
npm test                     # run all checks
npm run build                # rebuild the three pages from the current data
npm run refresh:cardiology   # pull fresh appointment data (AdventHealth takes most of a day), then rebuild
```

After a refresh: run `npm test`, commit `data/cardiology/current` and `public/`,
and push. GitHub Pages redeploys the site from `public/` on every push to main.
There is no scheduled refresh.

## Layout

```
extractors/cardiology/   the scraper and its docs
scripts/                 build steps (data files, pages)
src/                     page sources: render.js (Provider Index), slot-times/, opportunities/, shared/
data/                    provider directory data and the current run's manifest
public/                  the built site, including per-day slot files under data/cardiology/slots/
test/                    node tests, run with npm test
```

Edit the sources in `src/`, then run `npm run build`. Do not edit files in
`public/` by hand.
