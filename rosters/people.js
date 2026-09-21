// The Provider Index is rebuilt from the pipeline's rosters at render time so
// that a specialty's directory labels count together and clinicians who book
// in MyChart but have no directory profile join the index at their clinics.
// The same aggregate() the pipeline uses does the counting, so totals,
// footprints and cards reconcile by construction.
import { aggregate } from "./aggregate.js";

// Adult cardiology labels the page counts together. Pediatric cardiology and
// cardiac surgery keep their own labels and stay off the page.
export const ADULT_CARDIOLOGY = new Set(["Cardiology", "Cardiology - Interventional", "Cardiology - Electrophysiology", "Cardiology - Advanced Heart Failure", "Cardiovascular Imaging"]);
// A roster group as specialties.json declares it: the directory labels counted together under
// `group`; `weak` members only count when the person also carries a stronger one or no excluded label
// (Orlando Health tags neurosurgeons and pain physicians "Spine"); `exclude` labels and `excludeCredentials`
// keep the people the page's scope leaves out (podiatrists, pediatric orthopedics) even when a label matches.
export const CARDIOLOGY_GROUP = { group: "Cardiology", members: [...ADULT_CARDIOLOGY], weak: [], exclude: ["Pediatric Cardiology"], excludeCredentials: [] };

const SOURCE = (group) => ({
  all: `Each system's own published provider directory, plus clinicians who book ${group} visits in MyChart but have no directory profile, placed at the clinics where they take appointments. Statewide totals are distinct people; ZIP and county footprints count a person once in every published practice area.`,
  primary: `Each system's own published provider directory, plus clinicians who book ${group} visits in MyChart but have no directory profile, placed at the clinics where they take appointments. Statewide totals are distinct people; ZIP and county footprints use one primary or first-published practice location.`,
});
const officeKey = (l) => `${l.z ?? l.zip ?? ""}|${String(l.a ?? l.addr ?? "").toLowerCase()}|${String(l.c ?? l.city ?? "").toLowerCase()}|${String(l.n ?? l.name ?? "").toLowerCase()}`;

// One person per system and id from the ZIP rosters the pipeline wrote, with
// every office they were listed at and the office the primary roster chose.
export function peopleFromRoster(rosterAll, rosterPrimary = {}) {
  const people = new Map();
  for (const entries of Object.values(rosterAll ?? {})) for (const e of entries) {
    const id = `${e.y}:${e.i}`;
    if (!people.has(id)) people.set(id, { sys: e.y, npi: String(e.i), name: e.n, cred: e.cr ?? "", specialty: e.s, labels: [...(e.ls ?? [])], photo: e.ph ?? "", profile: e.u ?? "", offices: new Map() });
    const person = people.get(id);
    for (const l of e.l ?? []) if (!person.offices.has(officeKey(l))) person.offices.set(officeKey(l), { name: l.n, addr: l.a, city: l.c, zip: l.z, primary: false });
  }
  for (const entries of Object.values(rosterPrimary ?? {})) for (const e of entries) {
    const person = people.get(`${e.y}:${e.i}`); if (!person) continue;
    for (const l of e.l ?? []) { const office = person.offices.get(officeKey(l)); if (office) office.primary = true; }
  }
  return [...people.values()].map(({ offices, ...person }) => {
    const locations = [...offices.values()];
    if (locations.length && !locations.some((l) => l.primary)) locations[0].primary = true;
    return { ...person, locations };
  });
}

// Credential classes, for telling clinicians apart and for the scope rules ("DPM" = podiatry).
const CREDENTIAL_CLASSES = [
  [/\b(MD|DO|MBBS|MBBCH|MBCHB)\b/, "physician"],
  [/\b(APRN|ARNP|NP|CNP|FNP|DNP|CRNP|AGNP|ANP|ACNP|AGACNP|PMHNP|WHNP|CNM)\b/, "np"],
  [/\b(PA|PA-C|MPAS)\b/, "pa"],
  [/\bDPM\b/, "dpm"],
];
export const credentialClass = (cred) => {
  const text = String(cred ?? "").toUpperCase().replace(/\./g, "");
  for (const [pattern, cls] of CREDENTIAL_CLASSES) if (pattern.test(text)) return cls;
  return "";
};
const hasCredential = (cred, wanted) => wanted.some((token) => new RegExp(`\\b${token}\\b`, "i").test(String(cred ?? "").replace(/\./g, "")));

export const generalLabel = (group) => `${group.group} - General`;

// A person belongs to the group when ANY label they carry is a member, unless the scope rules say
// otherwise: an excluded credential (podiatrists) never joins, and someone whose only member labels are
// weak ones (a generic "Spine" tag on a neurosurgeon or pain physician) joins only when no excluded
// label is present. Grouped people keep every label in `labels`, so the sub-specialty counts still see
// them; a person whose only member label is the group's own gets the "<group> - General" sub-label so
// general clinicians can be picked out; `via` says whether the primary label or a secondary one brought
// them in.
export function regroupSpecialties(people, group = CARDIOLOGY_GROUP) {
  const members = new Set(group.members), weak = new Set(group.weak ?? []), excluded = new Set(group.exclude ?? []);
  const excludedCredentials = group.excludeCredentials ?? [];
  return people.map((p) => {
    const carried = [...new Set([p.specialty, ...(p.labels ?? [])].filter(Boolean))];
    const memberLabels = carried.filter((label) => members.has(label));
    if (!memberLabels.length) return p;
    // people the scope leaves out keep their own labels but lose the group's, so the sub-specialty
    // counts and filters do not see them either
    const outOfScope = () => ({ ...p, labels: (p.labels ?? []).filter((label) => !members.has(label)), ...(members.has(p.specialty) ? { specialty: carried.find((label) => !members.has(label)) ?? p.specialty } : {}), scope: "out" });
    if (excludedCredentials.length && hasCredential(p.cred, excludedCredentials)) return outOfScope();
    const strong = memberLabels.filter((label) => !weak.has(label));
    if (!strong.length && carried.some((label) => excluded.has(label))) return outOfScope();
    const general = memberLabels.length === 1 && memberLabels[0] === group.group;
    const label = general ? generalLabel(group) : (members.has(p.specialty) && p.specialty !== group.group ? p.specialty : memberLabels.find((item) => item !== group.group) ?? p.specialty);
    const labels = general ? carried.map((item) => (item === group.group ? generalLabel(group) : item)) : carried;
    return { ...p, specialty: group.group, ...(label !== group.group ? { label } : {}), labels, via: members.has(p.specialty) ? "primary" : "secondary" };
  });
}

// Person identity across the directory and the scheduling catalog. The two spell names differently
// ("Ram" / "Ramakanth" Yakkanti, "M. Pierce" / "Michael" Ebaugh, "Katie" / "Katherine" Pate, "John" /
// "Chukwunweike" Nwosu), so a scheduling clinician is the same person as a directory entry when, in the
// same system and with a compatible credential, the surname matches and the first names agree exactly,
// share their first letters (an initial or a nickname) at a shared office, or the surname is the only
// one of its kind in that system's directory and they share an office.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "do", "phd", "aprn", "np", "pa", "rn", "dnp", "facc", "dpm", "mpas", "facs", "faans", "frcs"]);
const nameTokens = (name) => String(name ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/,.*$/, "").replace(/[^a-z\s]/g, " ").trim().split(/\s+/).filter((part) => part && !SUFFIXES.has(part));
const surnameKeys = (tokens) => (tokens.length >= 3 ? [tokens[tokens.length - 1], tokens[tokens.length - 2]] : tokens.slice(-1));
const streetKey = (zip, addr) => `${String(zip ?? "").slice(0, 5)}|${(String(addr ?? "").match(/^\s*(\d+)/) ?? [])[1] ?? ""}`;

function directoryIndex(people) {
  const bySurname = new Map();
  for (const person of people) {
    const tokens = nameTokens(person.name);
    for (const surname of new Set(surnameKeys(tokens))) {
      const key = `${person.sys}|${surname}`;
      if (!bySurname.has(key)) bySurname.set(key, []);
      bySurname.get(key).push({ person, first: tokens[0] ?? "", cls: credentialClass(person.cred), offices: new Set(person.locations.map((l) => streetKey(l.zip, l.addr))) });
    }
  }
  return bySurname;
}

export function findDirectoryPerson(provider, clinics, bySurname, group) {
  const tokens = nameTokens(provider.n); if (!tokens.length) return null;
  const first = tokens[0], cls = credentialClass(provider.n) || ({ Physician: "physician", "Nurse Practitioner": "np", "Physician Assistant": "pa" }[provider.c] ?? "");
  const offices = new Set(clinics.map(({ facility }) => streetKey(facility.z, facility.a)));
  let best = null;
  for (const surname of new Set(surnameKeys(tokens))) {
    const candidates = bySurname.get(`${provider.y}|${surname}`) ?? [];
    for (const candidate of candidates) {
      if (cls && candidate.cls && cls !== candidate.cls) continue;
      const shared = [...offices].filter((office) => candidate.offices.has(office)).length;
      const exact = candidate.first === first;
      const prefix = Math.min(first.length, candidate.first.length) >= 3 && (first.startsWith(candidate.first) || candidate.first.startsWith(first));
      const initial = Boolean(first[0]) && first[0] === candidate.first[0];
      const score = exact ? 4 : (shared && (initial || prefix)) ? 3 : prefix ? 2 : (shared && (candidates.length === 1 || shared >= 2)) ? 1 : 0;
      if (!score) continue;
      const inGroup = candidate.person.specialty === group.group;
      if (!best || score > best.score || (score === best.score && shared > best.shared) || (score === best.score && shared === best.shared && inGroup && !best.inGroup)) best = { person: candidate.person, score, shared, inGroup };
    }
  }
  return best?.person ?? null;
}

// Clinicians with bookable slots for the page's specialty who match no directory person, placed at the
// clinics where they take appointments (busiest first). Matches outside the group are returned in
// `elsewhere` (listed in a directory under another specialty) and clinicians the scope excludes in
// `excluded`, so the data check can say what is not counted and why.
export function schedulingClinicians(people, slotModel, zipCounty = {}, group = CARDIOLOGY_GROUP) {
  const bySurname = directoryIndex(people);
  const slotsByProvider = new Map();
  // Either the deep model's slots or the published summary's provider-facility counts (same information, far smaller).
  const pairs = slotModel?.providerFacilities ? slotModel.providerFacilities.map(([p, f, count]) => ({ p, f, count })) : (slotModel?.slots ?? []).map((slot) => ({ p: slot.p, f: slot.f, count: 1 }));
  for (const slot of pairs) {
    if (!slotsByProvider.has(slot.p)) slotsByProvider.set(slot.p, new Map());
    const per = slotsByProvider.get(slot.p); per.set(slot.f, (per.get(slot.f) ?? 0) + slot.count);
  }
  const fallbackCred = { Physician: "MD", "Nurse Practitioner": "APRN", "Physician Assistant": "PA-C" };
  const added = [], elsewhere = [], excluded = [], gaps = { ah: 0, oh: 0 };
  (slotModel?.providers ?? []).forEach((provider, index) => {
    if (!fallbackCred[provider.c] || !["ah", "oh"].includes(provider.y)) return;
    const clinics = [...(slotsByProvider.get(index) ?? [])]
      .map(([f, count]) => ({ facility: slotModel.facilities[f], count }))
      .filter(({ facility }) => facility && zipCounty[facility.z])
      .sort((a, b) => b.count - a.count || String(a.facility.n).localeCompare(String(b.facility.n)));
    if (!clinics.length) { gaps[provider.y] += 1; return; } // slots at clinics the map cannot place: a real gap
    const [name, ...credParts] = String(provider.n).split(",");
    const cred = credParts.map((part) => part.trim()).filter(Boolean).join(", ") || fallbackCred[provider.c];
    const match = findDirectoryPerson(provider, clinics, bySurname, group);
    if (match) {
      if (match.specialty !== group.group) elsewhere.push({ sys: provider.y, name: name.trim(), cred, label: match.label ?? match.specialty, directoryName: match.name });
      return;
    }
    if ((group.excludeCredentials ?? []).length && hasCredential(cred, group.excludeCredentials)) { excluded.push({ sys: provider.y, name: name.trim(), cred }); return; }
    added.push({ sys: provider.y, npi: provider.i ? String(provider.i) : `mychart:${name.trim().toLowerCase()}`, name: name.trim(), cred, specialty: group.group, photo: "", profile: "", src: "mychart",
      locations: clinics.map(({ facility }, i) => ({ name: facility.n, addr: facility.a, city: facility.c, zip: facility.z, primary: i === 0 })) });
  });
  Object.defineProperty(added, "elsewhere", { value: elsewhere, enumerable: false });
  Object.defineProperty(added, "excluded", { value: excluded, enumerable: false });
  Object.defineProperty(added, "gaps", { value: gaps, enumerable: false });
  return added;
}

export function buildProviderIndex({ rosterAll, rosterPrimary, slotModel, zipCounty, generatedAt, group = CARDIOLOGY_GROUP }) {
  const directory = regroupSpecialties(peopleFromRoster(rosterAll, rosterPrimary), group);
  const scheduling = schedulingClinicians(directory, slotModel, zipCounty, group);
  const people = [...directory, ...scheduling];
  const viaSecondary = { ah: directory.filter((p) => p.via === "secondary" && p.sys === "ah").length, oh: directory.filter((p) => p.via === "secondary" && p.sys === "oh").length };
  const rosters = (mode) => {
    const split = { ah: [], oh: [] };
    for (const p of people) split[p.sys]?.push({ ...p, locations: mode === "primary" ? p.locations.filter((l) => l.primary).slice(0, 1) : p.locations });
    return split;
  };
  const build = (mode) => {
    const out = aggregate({ rosters: rosters(mode), zipCounty, locationMode: mode, source: SOURCE(group.group)[mode] });
    if (generatedAt) { out.byZip.generatedAt = generatedAt; out.byCounty.generatedAt = generatedAt; }
    return out;
  };
  return { all: build("all"), primary: build("primary"), people, viaSecondary, elsewhere: scheduling.elsewhere, excluded: scheduling.excluded, gaps: scheduling.gaps, added: { ah: scheduling.filter((p) => p.sys === "ah").length, oh: scheduling.filter((p) => p.sys === "oh").length } };
}
