// Orlando Health's own provider directory.
//
// Their physician-finder is a React InstantSearch front end over a hosted
// Algolia index, so the same records the site renders are available as JSON.
// This replaces the entire CMS-derived pipeline: the records carry an NPI, an
// isEmployed flag, and real geocoded clinic addresses, so there is nothing to
// reconcile, no name matching, and no placement to infer.
//
// The key below is the public search-only key their page bundle ships to every
// visitor. It grants read access to this index and nothing else -- but they can
// rotate it whenever they like, which is why fetch() fails loudly rather than
// returning a partial set: a silently stale map is worse than a broken build.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { canonicalSpecialty } from "../specialty.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const APP = "USMIU3X8IE";
const KEY = "a5af6748e2cf22a215fdab8b6b4e34fc";
const INDEX = "idx-provider";
// regionalCareSites.id:2 is Orlando Health. The same index also serves Baptist
// Health (id 3) and Doctor Center Hospital (id 1), so the region filter is what
// scopes this to the system we care about.
const FILTERS = "regionalCareSites.id:2 AND NOT metadata.hideFromSearch:true";
const ENDPOINT = `https://${APP}-dsn.algolia.net/1/indexes/*/queries?x-algolia-api-key=${KEY}&x-algolia-application-id=${APP}`;
const PER_PAGE = 1000;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PATH = join(ROOT, "data", "raw", "oh-directory.json");
export const PHOTO_PATH = join(ROOT, "data", "raw", "oh-photo-scrape.json");

export const isFlZip = (z) => /^3[234]\d{3}$/.test(String(z ?? "").slice(0, 5));
export const zip5 = (z) => String(z ?? "").replace(/\D/g, "").slice(0, 5);

async function page(n) {
  const body = { requests: [{ indexName: INDEX, filters: FILTERS, hitsPerPage: PER_PAGE, page: n,
                              query: "", attributesToHighlight: [] }] };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "text/plain" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Algolia returned ${res.status} — the search key may have been rotated; re-capture it from the physician-finder page`);
  return (await res.json()).results[0];
}

export async function fetchDirectory({ onProgress = () => {} } = {}) {
  const first = await page(0);
  const hits = [...first.hits];
  for (let p = 1; p < first.nbPages; p += 1) {
    hits.push(...(await page(p)).hits);
    onProgress({ fetched: hits.length, total: first.nbHits });
    await new Promise((r) => setTimeout(r, 250));
  }
  if (hits.length !== first.nbHits) throw new Error(`expected ${first.nbHits} records, got ${hits.length}`);
  return { fetchedAt: new Date().toISOString(), nbHits: first.nbHits, hits };
}

// Their fullName appends the credential ("Ali S. Abbood, MD"); the panel shows
// the credential in its own column, so strip it off the name.
export function cleanName(fullName, title) {
  const s = String(fullName ?? "").trim();
  if (!title) return s.replace(/,\s*[A-Za-z.\- ]+$/, "").trim();
  const suffix = new RegExp(`,\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  return s.replace(suffix, "").trim();
}

// A clinician with no specialty listed still has a credential, and CMS-style
// vocabularies classify mid-levels by role anyway, so fall back to that.
const ROLE = new Map(Object.entries({
  APRN: "Nurse Practitioner", NP: "Nurse Practitioner", DNP: "Nurse Practitioner",
  "PA-C": "Physician Assistant", PA: "Physician Assistant",
  CRNA: "Nurse Anesthetist", CAA: "Anesthesiologist Assistant", AA: "Anesthesiologist Assistant",
  CNM: "Nurse Midwife", PT: "Physical Therapy", RD: "Dietitian", DPM: "Podiatry",
}));
// Their specialty names carry stray whitespace ("Hematology and Oncology "),
// which would otherwise split one specialty into two on the filter.
const tidy = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export function specialtyOf(rec) {
  const s = (rec.specialties ?? [])[0];
  if (s?.name) return canonicalSpecialty(tidy(s.name));
  return ROLE.get(String(rec.title ?? "").toUpperCase()) ?? "Not Specified";
}

// Their directory publishes a handful of NPIs that are malformed (wrong digit
// count) or belong to a different clinician entirely. Each correction below was
// verified against the NPPES registry (npiregistry.cms.hhs.gov) on 2026-08-30 by
// name, credential and practice city; keyed by slug so it survives reindexes.
export const NPI_FIXES = new Map(Object.entries({
  "idelisa-torres-berastain-md": "1407842024", // published with Maura Alambert's NPI; hers per NPPES (Diagnostic Radiology, Ocoee)
  "fran-firestone-pac": "1982958062",          // published 19829558062 — a doubled "5" (Francis Firestone PA-C, Orlando)
  "brandon-frangione-pa-c": "1699657585",      // published 1699657 — last three digits dropped
  "ana-segura-md": "1215422522",               // published 910159284581 — garbage (Ana Segura MD, Surgical Critical Care, St. Petersburg)
}));

// Corporate/administrative feed addresses that are not practice sites: 31
// hospital-based anesthesiologists are published at Envision Physician
// Services' Fort Lauderdale HQ and 2 wound-care clinicians at Healogics'
// Jacksonville HQ — hundreds of miles from any Orlando Health facility. The
// clinicians stay in the roster (they are employed) but these addresses must
// not place them on the map. Nothing else in the directory matches this shape.
const ADMIN_LOCATIONS = [
  { name: /envision physician services/i, city: /fort lauderdale/i },
  { name: /healogics|nautilus health care group/i, city: /jacksonville/i },
];
const isAdminLocation = (l) =>
  ADMIN_LOCATIONS.some((a) => a.name.test(l.name ?? "") && a.city.test(l.city ?? ""));

// Shared surname (diacritic-insensitive) — how we decide whether two records
// with the same NPI are the same person listed twice or a data error.
const nameTokens = (s) => new Set(
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/).filter((t) => t.length > 2));
const sharesName = (a, b) => [...nameTokens(a)].some((t) => nameTokens(b).has(t));

// The map roster: employed by Orlando Health, practising somewhere in Florida.
export function photoMapOf(raw) {
  const rows = raw?.records ?? raw ?? [];
  return new Map(rows
    .filter((r) => r?.slug)
    .map((r) => [String(r.slug), String(r.photo ?? "").trim()]));
}

export function toRoster(raw, photoCapture = []) {
  const photos = photoMapOf(photoCapture);
  const out = [];
  for (const rec of raw.hits ?? raw) {
    if (!rec.isEmployed) continue;
    const flLocs = (rec.locations ?? []).filter((l) => isFlZip(l.zipCode));
    if (!flLocs.length) continue;
    const locs = flLocs.filter((l) => !isAdminLocation(l));
    out.push({
      npi: NPI_FIXES.get(rec.slug) ?? rec.npi,
      name: cleanName(rec.fullName, rec.title),
      cred: rec.title ?? "",
      specialty: specialtyOf(rec),
      specialties: (rec.specialties ?? []).map((s) => tidy(s.name)),
      isPrimaryCare: !!rec.isPrimaryCareProvider,
      isApp: !!rec.isAppProvider,
      slug: rec.slug,
      photo: String(rec.photo ?? photos.get(rec.slug) ?? "").trim(),
      profile: rec.slug ? `https://www.orlandohealth.com/physician-finder/${rec.slug}` : "",
      updated: rec.updatedDate ?? "",
      locations: locs.map((l) => ({
        name: l.name, zip: zip5(l.zipCode), city: l.city,
        addr: [l.address1, l.address2].filter(Boolean).join(", "),
        primary: !!l.isPrimary, lat: l._geoloc?.lat, lon: l._geoloc?.lng,
      })),
    });
  }
  return dedupByNpi(out);
}

// The directory sometimes lists one person twice (Kathy/Yekaterina Temperato,
// one NPI, two records with different specialties). Merge those: the most
// recently updated record wins the name and specialty, locations are unioned.
// If two records share an NPI but no name in common, that is an Alambert-class
// error (one record carrying someone else's NPI): warn loudly and keep them as
// separate people rather than silently merging two clinicians into one.
export function dedupByNpi(rows) {
  const byNpi = new Map();
  const merged = [];
  for (const p of rows) {
    if (!p.npi) { merged.push(p); continue; }
    const prev = byNpi.get(p.npi);
    if (!prev) { byNpi.set(p.npi, p); merged.push(p); continue; }
    if (!sharesName(p.name, prev.name)) {
      console.warn(`  ⚠ NPI ${p.npi} is published for both "${prev.name}" and "${p.name}" — treating as two people; verify against NPPES and add to NPI_FIXES`);
      merged.push({ ...p, npi: null });
      continue;
    }
    const [win, lose] = String(p.updated) >= String(prev.updated) ? [p, prev] : [prev, p];
    const seen = new Set(win.locations.map((l) => `${l.zip}|${String(l.addr).toLowerCase()}`));
    for (const l of lose.locations)
      if (!seen.has(`${l.zip}|${String(l.addr).toLowerCase()}`)) win.locations.push(l);
    Object.assign(prev, win, { locations: win.locations });
  }
  return merged;
}

export function loadDirectory(path = PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const raw = await fetchDirectory({ onProgress: (e) => process.stdout.write(`  ${e.fetched}/${e.total}\r`) });
  mkdirSync(join(ROOT, "data", "raw"), { recursive: true });
  writeFileSync(PATH, JSON.stringify(raw));
  const roster = toRoster(raw);
  console.log(`\nwrote ${PATH} — ${raw.nbHits} records`);
  console.log(`  employed with a Florida location: ${roster.length}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
