// AdventHealth's provider directory, captured from their own site.
//
// AdventHealth's server-rendered Medical Group directory publishes the fields
// needed by the map in each result card: NPI/profile URL, photo, specialty and
// every listed practice location. scripts/capture-ah-directory.mjs refreshes
// the committed capture without visiting each provider profile.
//
// Shape differences from the OH source, and how they are handled:
//  - The new capture is scoped to the AdventHealth Medical Group directory, so
//    employment is source-defined. The older global-directory capture remains
//    supported and still infers employment from an AdventHealth practice name.
//  - A clinician may have multiple locations. Once the clinician qualifies as
//    employed, all of their published Florida locations are retained.
//  - Their data errors: a handful of records say state FL with Kansas/Alabama
//    ZIPs, two Celebration office rows carry a Panhandle ZIP, and one facility
//    (organizational NPI) appears as a "doctor".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isFlZip, zip5 } from "./directory.js";
import { canonicalSpecialty } from "../specialty.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AH_PATH = join(ROOT, "data", "raw", "ah-directory-scrape.json");

export const isEmployedGroup = (locName) => /^advent\s?health/i.test(String(locName ?? "").trim());

// Facility cards carry an organizational NPI and a place name instead of a
// person: no credential comma, and a facility word in the "name".
export const isFacilityCard = (name) =>
  !/,/.test(String(name)) && /(AdventHealth|Center|Institute|Pavilion|Clinic|Imaging|Pharmacy|Hospital)/i.test(String(name));

// "Cardiology, Cardiovascular Disease" -> "Cardiology": their specialty field
// concatenates a taxonomy list; the first segment is the display specialty and
// collapsing to it aligns the vocabulary with Orlando Health's (329 -> 133).
export const primarySpecialty = (spec) => {
  const s = String(spec ?? "").split(",")[0].replace(/\s+/g, " ").trim();
  return canonicalSpecialty(s) || "Not Specified";
};

// "Shilpa Abraham, DNP, APRN, FNP-C" — everything after the first comma is a
// credential list when every token is credential-shaped; otherwise leave the
// string alone rather than truncating a real name.
export const splitNameCred = (full) => {
  const s = String(full ?? "").trim();
  const i = s.indexOf(",");
  if (i < 0) return { name: s, cred: "" };
  const tokens = s.slice(i + 1).split(/[,\s]+/).filter(Boolean);
  const credLike = tokens.length > 0 && tokens.every((t) => /^[A-Z][A-Za-z.\-]{0,9}$/.test(t));
  return credLike ? { name: s.slice(0, i).trim(), cred: tokens.join(", ") } : { name: s, cred: "" };
};

// Verified against the published city and street: two oncology cards place
// 380 Celebration Place in 32474. Celebration's ZIP is 34747. The cohort has
// only two affected clinicians, so the >=3 clinic-consensus rule cannot repair
// this particular source typo by itself.
export const verifiedLocationZip = (rec) => {
  const city = String(rec.city ?? "").toLowerCase().trim();
  const street = String(rec.street ?? rec.addr ?? "").toLowerCase().trim();
  return city === "celebration" && street.startsWith("380 celebration place") && zip5(rec.zip) === "32474"
    ? "34747"
    : rec.zip;
};

// Clinic consensus, same principle as the OH geo resolver's rule 1 — but
// cohorts are keyed by clinic name AND city, because statewide chains (Florida
// Cancer Specialists, Florida Orthopaedic Institute …) reuse one name across
// many cities and name-only consensus would drag a Sebring office to Winter
// Park. Within one clinic+city, a ZIP held by exactly one clinician while >=3
// colleagues agree on another is a typo (proved: "Primary Care Oviedo" 32755
// vs eight at 32765 — a transposition; "South Street" 32870 vs 32801). This
// also repairs truncated ZIPs ("3284" on an employed Orlando record).
export function clinicConsensus(rows) {
  const key = (r) => `${r.locName}|${String(r.city ?? "").toLowerCase().trim()}`;
  const byClinic = new Map();
  for (const r of rows) {
    const zip = verifiedLocationZip(r);
    if (!isFlZip(zip)) continue;              // bad ZIPs get outvoted, not counted
    if (!byClinic.has(key(r))) byClinic.set(key(r), new Map());
    const m = byClinic.get(key(r));
    m.set(zip5(zip), (m.get(zip5(zip)) ?? 0) + 1);
  }
  return (rec) => {
    const correctedZip = verifiedLocationZip(rec);
    const m = byClinic.get(key(rec));
    if (!m) return correctedZip;
    const own = m.get(zip5(correctedZip)) ?? 0;
    const [modalZip, modalN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!modalZip) return correctedZip;
    if (!isFlZip(correctedZip)) return modalZip; // malformed ZIP: adopt the clinic's
    return (own === 1 && modalN >= 3 && modalZip !== zip5(correctedZip)) ? modalZip : correctedZip;
  };
}

const locationsOf = (rec) => Array.isArray(rec.locations) && rec.locations.length
  ? rec.locations.map((l, i) => ({
      ...l,
      locName: l.locName ?? l.name ?? "",
      street: l.street ?? l.addr ?? "",
      primary: l.primary ?? (i === 0),
    }))
  : [{
      locName: rec.locName ?? "", street: rec.street ?? "", city: rec.city,
      state: rec.state, zip: rec.zip, lat: rec.lat, lon: rec.lon, primary: true,
    }];

// Employed AdventHealth clinicians with a (real) Florida practice location.
export function toAhRoster(raw) {
  const byNpi = new Map();
  const records = raw.records ?? raw;
  const scopedToMedicalGroup = raw.scope === "adventhealth-medical-group";
  const expanded = records.flatMap((rec) => locationsOf(rec).map((loc) => ({ ...loc, provider: rec })));
  const flRows = expanded.filter((r) => /^fl$/i.test(r.state ?? "") && r.locName);
  const consensusZip = clinicConsensus(flRows);
  for (const rec of records) {
    const rawLocs = locationsOf(rec);
    const employed = scopedToMedicalGroup || rawLocs.some((l) => isEmployedGroup(l.locName));
    if (!employed) continue;
    if (isFacilityCard(rec.name)) continue;
    if (!/^\d{10}$/.test(String(rec.npi))) continue;
    const { name, cred } = splitNameCred(rec.name);
    const locations = rawLocs
      .filter((l) => /^fl$/i.test(l.state ?? ""))
      .map((l) => ({ ...l, zip: consensusZip(l) }))
      .filter((l) => isFlZip(l.zip)) // catches their FL-labeled Kansas rows
      .map((l, i) => ({
        name: l.locName, zip: zip5(l.zip), city: l.city, addr: l.street ?? "",
        primary: !!l.primary || i === 0, lat: l.lat, lon: l.lon,
      }));
    if (!locations.length) continue;
    const prev = byNpi.get(rec.npi);
    if (prev) {                                // page-boundary duplicate
      for (const loc of locations)
        if (!prev.locations.some((l) => l.zip === loc.zip && l.addr === loc.addr)) prev.locations.push(loc);
      if (!prev.photo && rec.photo) prev.photo = rec.photo;
      if (!prev.profile && rec.profile) prev.profile = rec.profile;
      continue;
    }
    byNpi.set(rec.npi, {
      npi: String(rec.npi), name, cred,
      specialty: primarySpecialty(rec.spec),
      specialties: [primarySpecialty(rec.spec)],
      slug: rec.profile ? String(rec.profile).split("/").filter(Boolean).at(-1) : null,
      photo: String(rec.photo ?? "").trim(), profile: String(rec.profile ?? "").trim(),
      updated: raw.fetchedAt ?? "", locations,
    });
  }
  return [...byNpi.values()];
}

export function loadAhDirectory(path = AH_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}
