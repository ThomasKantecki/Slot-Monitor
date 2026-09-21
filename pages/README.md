# pages/

Step 4: build the three web pages. Each page is one self-contained HTML file: the render script takes the
markup, inlines the styles, the browser code, the map shapes, the logos and the fonts, and writes it under
`public/` (Cardiology at the root, every other specialty in its own folder). `npm run build` builds every
published specialty; a single page can be rebuilt with `npm run build:provider-map`, `build:slot-times` or
`build:opportunities` (add `-- --specialty <id>` for a specialty other than cardiology).

## slot-availability/ (Slot Availability)

The main page: how many appointments in the page's specialty AdventHealth and Orlando Health have open, by
ZIP or county, over a chosen period. The landing view is the next 90 days within 140 miles of Orlando.

The page embeds only a summary (providers, facilities, visit types, totals) and fetches the per-day slot
files it needs from `public/data/<specialty>/slots/` as the dates change. The comparison filters (physicians
only, in-person only, new patients only) come from `slots/slot-rules.js` and narrow both systems the same way.

| File | What it does |
|---|---|
| `render.js` | Builds `public/index.html` (or `public/<specialty>/index.html`) and the old `slot-times.html` address that forwards to it. |
| `client.js` | The browser code: filters, map, summary card, availability profile, calendar, provider and facility lists, facility dialog. |
| `partition-loader.js` | Fetches the per-day slot files for the selected dates (cached per day; a failed day is retried next time). |
| `radius.js` | Great-circle distance in miles, for the radius ring and the market distances. |
| `styles.css` | The page's styles; the market page reuses them. |

## market-opportunities/ (AH Market Opportunities)

This page answers one question: where does Orlando Health have appointment availability in the page's
specialty that AdventHealth does not match?

A market is a 25-mile circle around a ZIP that has at least one facility with open slots. Every active
facility of both systems inside the circle contributes its slots, providers and earliest dates. The
Geography controls only choose which market centres are in view. Neighbouring circles overlap and can
count the same slots, so market figures are not additive.

Markets are ranked with the strongest gaps first, using the score in `scoring.js` (no AdventHealth slots,
an earlier Orlando Health first appointment, more Orlando Health slots, a persistent Orlando Health lead,
distance to the nearest AdventHealth site). The page shows the rank ("#3 of 72") and the reasons in plain
words, never the score itself. The map draws one dot per market centre: red where Orlando Health leads,
blue where AdventHealth leads, with a white core where the ZIP itself has Orlando Health slots and no
AdventHealth slots. This is an availability signal, not a measure of patient demand, market share,
appointment completion or unmet need.

| File | What it does |
|---|---|
| `render.js` | Builds `public/market-opportunities.html` (or the specialty's copy) from the slot page's markup plus this page's client and styles. |
| `client.js` | The browser code: filter, map, overview card, ranked markets, market detail and dialog. |
| `scoring.js` | The one implementation of the market ranking, used by the page, the tests and `npm run audit:opportunities`. |
| `styles.css` | This page's additions on top of the slot page's styles. |

## provider-index/ (Provider Index)

Who works where: the clinicians each system lists in its public directory for the page's specialty, per ZIP
and county, with sub-specialty labels, primary-office mode and the people who book in MyChart but have no
directory profile. Everything is embedded in the page (no fetches).

| File | What it does |
|---|---|
| `render.js` | Builds `public/provider-map.html` (or the specialty's copy): the Albers map, the rosters from `rosters/people.js`, the data-check dialog and the browser code, all in one file. The data contract for the roster files is documented at the top of the render. |

## shared/

Pieces every page uses.

| File | What it does |
|---|---|
| `specialties.js` | Loads `specialties.json` (the registry at the repo root) and derives every path a specialty's data and pages live at. Also holds the per-specialty page copy. |
| `suite-navigation.js` | The header: title box with the specialty menu, the page switcher, the data-check button and dialog. |
| `dataset-facts.js` | Builds each page's data-check report (the "All good" dialog) at build time. |
| `specialty-placeholders.js` | Writes "data is coming soon" pages for a specialty listed in the registry but not yet pulled. |
| `date.js` | Today's date in the viewer's local time, shared by pages and scripts. |
| `map-motion.js` | Smooth zoom and pan for the two slot maps (canvas snapshot while moving). |
