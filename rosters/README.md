# rosters/

Step 2 of the Provider Index: turn the two directory captures into the rosters the page embeds.
`npm run data` runs it and writes `data/rosters/`.

What happens: each capture is read into one shape (name, credential, specialty labels, offices); office ZIPs
are checked against the map and repaired when the directory has a typo; specialty names from both systems
are folded into one vocabulary; hospital-only staff nobody can book (anesthesia teams, reading-room
radiology, support roles) are dropped from both sides with one rule; then every person is counted once in
each ZIP and county where they have an office.

At page-build time, `people.js` takes those rosters and builds the specialty's group: any clinician whose
labels include one of the group's members (for example "Orthopedic Surgery - Knee") counts under the group,
scope rules keep out the people the page does not show (podiatrists, neurosurgeons and pain physicians
with a spine tag, pediatric orthopedics), and clinicians who book the specialty's visits in MyChart but have
no directory profile are added at the clinics where they take appointments. The same person is never
listed twice: a scheduling name is matched to a directory entry by surname plus first name, initial or a
shared office.

| File | What it does |
|---|---|
| `build-rosters.mjs` | The `npm run data` command: captures in, `data/rosters/*.json` out, with a summary printed. |
| `aggregate.js` | Counts people per ZIP and county and writes the roster shapes (the data contract is documented in `pages/provider-index/render.js`). |
| `geo.js` | Point-in-polygon lookup of an office's ZIP and county from the map shapes; a geocode beats a published ZIP. |
| `labels.js` | The shared specialty vocabulary: which AdventHealth and Orlando Health labels mean the same thing, and which labels are not bookable. |
| `people.js` | Builds a specialty's group from the rosters for the Provider Index: membership, scope rules, MyChart-only additions, person matching. |
