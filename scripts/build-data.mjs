// Both systems' directory captures -> the all-location and primary-location
// artifacts render.js embeds.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDirectory, toRoster, PATH as DIR_PATH, PHOTO_PATH } from "../src/sources/directory.js";
import { loadAhDirectory, toAhRoster, AH_PATH } from "../src/sources/ah-directory.js";
import { aggregate } from "../src/aggregate.js";
import { loadGeoIndexes, buildLocationResolver } from "../src/geo.js";
import { isBookable } from "../src/specialty.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const write = (p, v) => writeFileSync(join(ROOT, p), JSON.stringify(v));

if (!existsSync(DIR_PATH)) { console.error("no directory capture — run: npm run directory"); process.exit(1); }
const raw = loadDirectory();
const photoCapture = existsSync(PHOTO_PATH) ? JSON.parse(readFileSync(PHOTO_PATH, "utf8")) : [];
const roster = toRoster(raw, photoCapture);
console.log(`directory captured ${String(raw.fetchedAt).slice(0, 10)} — ${raw.nbHits} records`);
console.log(`employed with a Florida location: ${roster.length}`);

// Their published ZIP, city and geocode disagree on 202 of 5,214 locations.
// Most is boundary noise, but a handful are real: ZIPs with no census polygon
// would silently vanish from the map, and one clinic is published 103 miles
// from where it is. See src/geo.js for how each is resolved.
const geo = loadGeoIndexes(ROOT);
const resolve = buildLocationResolver({
  zipIndex: geo.zip,
  zctaGeojson: read("data/fl-zcta.geojson"),
  allLocations: roster.flatMap((p) => p.locations),
});
let fixed = 0;
for (const p of roster) {
  for (const l of p.locations) {
    const r = resolve(l);
    if (r.zip !== l.zip) { l.publishedZip = l.zip; l.zip = r.zip; l.zipFixedBy = r.why; fixed += 1; }
  }
}
if (fixed) console.log(`corrected ${fixed} location ZIPs against the geometry`);

let ahRoster = [];
if (existsSync(AH_PATH)) {
  const ahRaw = loadAhDirectory();
  ahRoster = toAhRoster(ahRaw);
  console.log(`AH listing captured ${String(ahRaw.fetchedAt).slice(0, 10)} — employed FL clinicians: ${ahRoster.length}`);
} else console.log("no AdventHealth capture — building Orlando Health only");

const zipCounty = read("data/zip-county.json");
const noPoly = ahRoster.flatMap((p) => p.locations.map((l) => l.zip)).filter((z) => !zipCounty[z]);
if (noPoly.length) console.log(`  AH locations in ZIPs with no county mapping: ${[...new Set(noPoly)].join(", ")}`);

const bookable = (rows) => rows.filter((p) => isBookable(p.specialty));
const ohBook = bookable(roster), ahBook = bookable(ahRoster);
console.log(`bookable filter: OH ${roster.length} -> ${ohBook.length} | AH ${ahRoster.length} -> ${ahBook.length} (hospital-based and support staff excluded from both)`);

const primaryOnly = (rows) => rows.map((p) => ({
  ...p,
  locations: [p.locations.find((l) => l.primary) ?? p.locations[0]].filter(Boolean),
}));
const multi = (rows) => rows.filter((p) => p.locations.length > 1).length;
const photos = (rows) => rows.filter((p) => p.photo).length;
console.log(`multi-location clinicians: OH ${multi(ohBook)} | AH ${multi(ahBook)}`);
console.log(`profile photos: OH ${photos(ohBook)}/${ohBook.length} | AH ${photos(ahBook)}/${ahBook.length}`);

const common = {
  rosters: { oh: ohBook, ah: ahBook },
  zipCounty,
};
const all = aggregate({
  ...common,
  locationMode: "all",
  source: "Each system's own published provider directory. Employed clinicians in bookable clinic specialties; statewide totals are distinct people, while ZIP and county footprints include every published Florida practice location. Hospital-based and support staff are excluded.",
});
const primary = aggregate({
  ...common,
  rosters: { oh: primaryOnly(ohBook), ah: primaryOnly(ahBook) },
  locationMode: "primary",
  source: "Each system's own published provider directory. Employed clinicians in bookable clinic specialties; statewide totals are distinct people, while ZIP and county footprints use one primary or first-published Florida practice location. Hospital-based and support staff are excluded.",
});
write("data/providers-by-zip.json", all.byZip);
write("data/providers-by-county.json", all.byCounty);
write("data/roster.json", all.rosterZip);
write("data/roster-county.json", all.rosterCounty);
write("data/providers-by-zip-primary.json", primary.byZip);
write("data/providers-by-county-primary.json", primary.byCounty);
write("data/roster-primary.json", primary.rosterZip);
write("data/roster-county-primary.json", primary.rosterCounty);

console.log(`\ntotals: OH ${all.byZip.totals.oh} | AH ${all.byZip.totals.ah}`);
console.log(`all locations: ZIPs ${Object.keys(all.byZip.zips).length} | counties ${Object.keys(all.byCounty.zips).length}`);
console.log(`primary only: ZIPs ${Object.keys(primary.byZip.zips).length} | counties ${Object.keys(primary.byCounty.zips).length} | specialties ${all.byZip.specialties.length}`);
