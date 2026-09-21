# Slot Monitor

A comparison of appointment availability between AdventHealth and Orlando Health in Florida, one specialty
at a time, built only from public information both systems publish: the open appointment slots anyone can
browse on their scheduling sites without logging in, and their public doctor directories. Nothing here logs
in, books anything, or touches patient information.

Live site: https://thomaskantecki.github.io/Slot-Monitor/ (Cardiology; Orthopedics under `/orthopedics/`)

## The three pages

- **Slot Availability**: how many appointments each system has open in the specialty, by ZIP or county,
  for the dates you pick, with a map, a calendar and the providers and clinics behind the numbers.
- **Market Opportunities**: where Orlando Health has availability that AdventHealth does not match, ranked
  by 25-mile market.
- **Provider Index**: which clinicians each system lists for the specialty and where they work, from the two
  public directories, with a sub-specialty menu.

The title box on every page is a specialty menu. Every page has a data-check button (the "i" in the header)
that says when the data was pulled and whether every check passed.

## How the data flows

```
  directories/  capture the two doctor directories        extractor/  pull the open slots from both Epic sites
        │                                                        │
        ▼                                                        ▼
  rosters/      who works where, per ZIP and county        slots/      dedupe, keep Florida, one file per day
        │                                                        │
        └────────────────►  pages/  build the three web pages  ◄─┘
                                        │
                              checks/  prove it is right
                                        │
                                        ▼
                              public/  the site GitHub Pages publishes
```

Two independent tracks feed the pages. The **directory track** (left) produces the Provider Index. The
**slot track** (right) produces Slot Availability and Market Opportunities. `specialties.json` at the root
tells both tracks what a specialty means: which entries of each system's scheduling catalog to pull, and
which directory labels count together.

## How each step works, in plain English

**1. The AdventHealth directory** (`directories/`). AdventHealth publishes its Medical Group listing on
adventhealth.com, but the site refuses requests that do not come from a real browser. So the capture runs
inside a Chrome tab: the parser from `directories/capture-adventhealth.mjs` is pasted into the page, it walks
the listing page by page, and the browser saves one JSON file. Then
`node directories/capture-adventhealth.mjs --import <that file>` checks the capture is complete (at least 98%
of the listed clinicians, at least 90% with an address) and stores it as `data/raw/ah-directory-scrape.json`.

**2. The Orlando Health directory** (`directories/`). Orlando Health's physician finder is backed by a search
index (Algolia) that returns the same records as JSON. `npm run directory` pages through it and stores
`data/raw/oh-directory.json`.

**3. The rosters** (`rosters/`). `npm run data` reads both captures into one shape (name, credential,
specialty labels, offices), repairs office ZIPs against the map, folds the two systems' specialty names into
one vocabulary, drops hospital-only staff nobody can book, and counts every person once in each ZIP and
county where they have an office. The Provider Index is built from these rosters.

**4. The slot scraper** (`extractor/`, Python). For each system it opens the public scheduling catalog,
picks the entries named in `specialties.json`, and for every visit type walks the questionnaire a patient
would answer (Orlando Health asks about body part, age and insurance; the walker learns which answers change
the routing and asks only those). Each resulting search is then paged through the calendar to the end of the
published schedule, recovering from stalls and network drops, and checkpointing so a killed run resumes
where it stopped. Both systems run side by side. The raw output lands under
`data/<specialty>/extractions/<run-id>/`.

**5. From a run to the published files** (`slots/`). The raw rows are collapsed to physical slots (one
provider, one location, one time), non-Florida locations are dropped, the newest complete run of each system
is promoted to `data/<specialty>/current/`, that dataset becomes a compact model, and the model is split into
one JSON file per day under `public/data/<specialty>/slots/` so the pages load only the dates in view.

**6. The pages** (`pages/`). Each page is one self-contained HTML file: the render inlines the styles, the
browser code, the map shapes, the logos and the fonts and writes it under `public/`. `npm run build` does this
for every specialty that has data.

**7. The checks** (`checks/`). `npm run verify` recomputes every published figure from the raw rows and runs
the tests; a refresh runs it automatically and stops if anything does not reconcile. `npm run audit:pages`
drives every control on the built pages in a headless browser, and `npm run audit:live` confirms the deployed
site matches the build byte for byte.

## Running it

Needs Node 20+ and Python 3.9+. Nothing to install: no npm packages, the Python is standard library only.

| Command | What it does |
|---|---|
| `npm test` | Runs the 106 tests. |
| `npm run build` | Rebuilds every published specialty's pages and day files from the current data. |
| `npm run refresh:cardiology` / `refresh:orthopedics` | Pulls fresh slots from both systems (AdventHealth takes most of a day), promotes the run, rebuilds, and runs the verification. Add `:dry-run` to print the plan instead. |
| `npm run extract:ah` / `extract:oh` | One system's extraction alone (`-- --specialty <id> --run-id <id> --resume` continues an interrupted run). |
| `npm run probe:catalog -- --system ah` | Lists what a system's scheduling catalog offers (to fill `specialties.json`). |
| `npm run directory` | Re-pulls the Orlando Health directory. |
| `npm run data` | Rebuilds the rosters from the two directory captures. |
| `npm run verify` | Tests plus the dataset audit (the refresh gate). |
| `npm run audit:pages -- --specialty <id>` | The headless-browser page audit (needs Chrome and `PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core`). |
| `npm run audit:live` | Checks the live site against `public/` after a deploy. |
| `npm run geometry`, `npm run fonts` | Rare: rebuild the map shapes or the embedded fonts (both need the network). |

## Refreshing the data

```
npm run refresh:orthopedics:dry-run     # see the plan
npm run refresh:orthopedics             # pull, promote, build, verify (hours; the machine must stay awake)
npm run audit:pages -- --specialty orthopedics
git add data/orthopedics/current public && git commit && git push
npm run audit:live                       # once the Pages deploy has finished
```

GitHub Pages redeploys the site from `public/` on every push to main. There is no scheduled refresh. If the
verification fails, nothing should be committed.

## Adding a specialty

1. `npm run probe:catalog -- --system ah` and `-- --system oh` to see the catalog entry names.
2. Add the specialty to `specialties.json`: id, label, folder, the catalog entries per system, and the
   directory labels its Provider Index counts together (plus any labels or credentials to keep out).
3. Add its page copy to `COPY` in `pages/shared/specialties.js` and `refresh:<id>` scripts to `package.json`.
4. `npm run build` writes placeholder pages; `npm run refresh:<id>` replaces them with real ones.

## Where things live

| Folder | What is in it |
|---|---|
| `directories/` | Capturing the two doctor directories (steps 1 and 2). |
| `rosters/` | Turning the captures into the Provider Index rosters (step 3). |
| `extractor/` | The Epic slot scraper, Python (step 4), with its own detailed README. |
| `slots/` | From an extraction run to the published day files (step 5). |
| `pages/` | The three page builds and the pieces they share (step 6). |
| `checks/` | The audits (step 7). |
| `tooling/` | Rare helpers: map geometry, fonts, the Python launcher. |
| `test/` | One test file per stage. |
| `data/` | Raw captures, rosters, geography, and each specialty's datasets. |
| `assets/` | Logos and the embedded fonts. |
| `public/` | The built site. Never edit by hand. |
| `specialties.json` | The registry: what each specialty means to both tracks. |

Every folder has a README with one line per file.

## Rules of the road

- Never edit anything under `public/`; change the source and run `npm run build`.
- `data/<specialty>/current/manifest.json` is the record of the last pull (run ids, counts); commit it with the pages.
- Run `npm test` before every commit, and `npm run verify` after every refresh.
