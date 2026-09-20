// The Provider Index is rebuilt from the pipeline's rosters at render time so
// that adult cardiology labels count together and clinicians who book in
// MyChart but have no directory profile join the index at their clinics. The
// same aggregate() the pipeline uses does the counting, so totals, footprints
// and cards reconcile by construction.
import { aggregate } from "./aggregate.js";
import { nameKeys } from "./shared/dataset-facts.js";

// Adult cardiology labels the page counts together. Pediatric cardiology and
// cardiac surgery keep their own labels and stay off the page.
export const ADULT_CARDIOLOGY = new Set(["Cardiology", "Cardiology - Interventional", "Cardiology - Electrophysiology", "Cardiology - Advanced Heart Failure"]);
// A roster group as src/shared/specialties.json declares it: the directory labels counted together under `group`.
export const CARDIOLOGY_GROUP = { group: "Cardiology", members: [...ADULT_CARDIOLOGY] };

const SOURCE = (group) => ({
  all: `Each system's own published provider directory, plus clinicians who book ${group} visits in MyChart but have no directory profile, placed at the clinics where they take appointments. Statewide totals are distinct people; ZIP and county footprints include every published Florida practice location. Hospital-based and support staff are excluded.`,
  primary: `Each system's own published provider directory, plus clinicians who book ${group} visits in MyChart but have no directory profile, placed at the clinics where they take appointments. Statewide totals are distinct people; ZIP and county footprints use one primary or first-published Florida practice location. Hospital-based and support staff are excluded.`,
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

// A person belongs to the group when ANY label they carry is a member (their primary label or a later
// one). Grouped people keep every label in `labels`, so the sub-specialty counts still see them, and
// `via` says whether the primary label or a secondary one brought them in.
export function regroupSpecialties(people, group = CARDIOLOGY_GROUP) {
  const members = new Set(group.members);
  return people.map((p) => {
    const carried = [...new Set([p.specialty, ...(p.labels ?? [])].filter(Boolean))];
    const memberLabels = carried.filter((label) => members.has(label));
    if (!memberLabels.length) return p;
    const primary = members.has(p.specialty) ? p.specialty : memberLabels[0];
    return { ...p, specialty: group.group, ...(primary !== group.group ? { label: primary } : {}), labels: carried, via: members.has(p.specialty) ? "primary" : "secondary" };
  });
}

// Clinicians with bookable Cardiology slots who match no directory person by
// name, placed at the clinics where they take appointments; busiest is primary.
export function schedulingClinicians(people, slotModel, zipCounty = {}, group = CARDIOLOGY_GROUP) {
  const known = { ah: new Set(), oh: new Set() };
  for (const p of people) for (const k of nameKeys(p.name)) known[p.sys]?.add(k);
  const slotsByProvider = new Map();
  // Either the deep model's slots or the published summary's provider-facility counts (same information, far smaller).
  const pairs = slotModel?.providerFacilities ? slotModel.providerFacilities.map(([p, f, count]) => ({ p, f, count })) : (slotModel?.slots ?? []).map((slot) => ({ p: slot.p, f: slot.f, count: 1 }));
  for (const slot of pairs) {
    if (!slotsByProvider.has(slot.p)) slotsByProvider.set(slot.p, new Map());
    const per = slotsByProvider.get(slot.p); per.set(slot.f, (per.get(slot.f) ?? 0) + slot.count);
  }
  const fallbackCred = { Physician: "MD", "Nurse Practitioner": "APRN", "Physician Assistant": "PA-C" };
  const added = [];
  (slotModel?.providers ?? []).forEach((provider, index) => {
    if (!fallbackCred[provider.c] || !known[provider.y]) return;
    if (nameKeys(provider.n).some((k) => known[provider.y].has(k))) return;
    const clinics = [...(slotsByProvider.get(index) ?? [])]
      .map(([f, count]) => ({ facility: slotModel.facilities[f], count }))
      .filter(({ facility }) => facility && zipCounty[facility.z])
      .sort((a, b) => b.count - a.count || String(a.facility.n).localeCompare(String(b.facility.n)));
    if (!clinics.length) return;
    const [name, ...credParts] = String(provider.n).split(",");
    const cred = credParts.map((part) => part.trim()).filter(Boolean).join(", ") || fallbackCred[provider.c];
    added.push({ sys: provider.y, npi: provider.i ? String(provider.i) : `mychart:${name.trim().toLowerCase()}`, name: name.trim(), cred, specialty: group.group, photo: "", profile: "", src: "mychart",
      locations: clinics.map(({ facility }, i) => ({ name: facility.n, addr: facility.a, city: facility.c, zip: facility.z, primary: i === 0 })) });
  });
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
  return { all: build("all"), primary: build("primary"), people, viaSecondary, added: { ah: scheduling.filter((p) => p.sys === "ah").length, oh: scheduling.filter((p) => p.sys === "oh").length } };
}
