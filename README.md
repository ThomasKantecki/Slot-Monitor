# Cardiology and Orthopedics Access

A comparison of appointment availability between AdventHealth and Orlando
Health in Florida, one specialty at a time, built from the public
online-scheduling data both systems publish.

Live site: https://thomaskantecki.github.io/Slot-Monitor/

## What is here

Three pages, all static HTML in `public/`:

- **Slot Availability** (`index.html`): how many appointments each system has
  open in the page's specialty, by ZIP or county, with a map, a calendar and a
  provider list.
- **Market Opportunities** (`market-opportunities.html`): where Orlando Health
  has availability that AdventHealth does not match, ranked by 25-mile market.
- **Provider Index** (`provider-map.html`): which providers in the page's
  specialty each system lists, by ZIP and county, from the two public provider
  directories.

The title box on every page is a specialty menu. Cardiology is the site root;
Orthopedics has the same three pages under `public/orthopedics/`, built from
its own data under `public/data/orthopedics/` once a refresh has published it.
Until then the build writes placeholders there. `src/shared/specialties.json`
lists each specialty with the Epic catalog entries its extraction pulls and the
directory labels its Provider Index counts together; the Node scripts and the
Python extractor both read it.

## Where the data comes from

Both systems let anyone browse open appointment slots on their websites without
logging in. The scraper in `extractors/cardiology` (the folder name is
historical; the same extractor serves every specialty) reads that same public
scheduling data, one page at a time, for every visit type of the requested
specialty, and saves every open slot with its provider, location, date and
time. It does not log in, book anything, or touch patient information.

The scraper is the one agreed method for pulling this data. It walks each
schedule to the end, recovers when the scheduling site stalls or drops a
request, can resume an interrupted run, and has an offline test that replays
the tricky cases. `extractors/cardiology/README.md` explains how it works and
why it replaced the earlier scripts.

Provider directory data for the Provider Index comes from each system's public
physician finder (`npm run directory` and `npm run adventhealth`). Since
September 2026 www.adventhealth.com answers the direct AdventHealth capture
with an Akamai 403; the working route is to run the same parser inside a
browser tab (see the header of `scripts/capture-ah-directory.mjs`), save the
result as JSON, and import it with
`node scripts/capture-ah-directory.mjs --import <file>`, which applies the same
completeness guards.

## Running it

Needs Node 20+ and Python 3.9+. No packages to install.

```
npm test                          # run all checks
npm run build                     # rebuild every published specialty's pages from the current data
npm run refresh:cardiology        # pull fresh Cardiology data (AdventHealth takes most of a day), then rebuild
npm run refresh:orthopedics       # the same for Orthopedics
npm run probe:catalog -- --system ah   # list what a system's scheduling catalog offers (fills src/shared/specialties.json)
```

After a refresh: run `npm test`, commit `data/<specialty>/current` and
`public/`, and push. GitHub Pages redeploys the site from `public/` on every
push to main. There is no scheduled refresh.

## Layout

```
extractors/cardiology/   the scraper (every specialty) and its docs
scripts/                 build steps (data files, pages), each taking --specialty <id>
src/                     page sources: render.js (Provider Index), slot-times/, opportunities/, shared/
data/                    provider directory data and each specialty's current-run manifest (data/<specialty>/current)
public/                  the built site, including per-day slot files under data/<specialty>/slots/
test/                    node tests, run with npm test
```

Edit the sources in `src/`, then run `npm run build`. Do not edit files in
`public/` by hand.
