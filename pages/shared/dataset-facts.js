// Data checks shown behind the header info button. Built at render time from
// the data files, so they follow every refresh. A report is { pulled, checks }:
// `pulled` is judged for freshness in the browser (the page is static), and each
// check is { ok, text }. The dialog turns amber when any check is not ok.

const n = (value) => Number(value || 0).toLocaleString("en-US");
const day = (iso) => iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "an unknown date";
const stamp = (iso) => iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "an unknown time";

// Slot Availability and Market Opportunities share the slot model.
export function slotDataChecks(model, zipCounty = {}) {
  const totals = model.totals ?? { ah: 0, oh: 0 };
  const slots = model.slots ?? [];
  // The pages embed a summary and load slots by date, so the count comes from the summary when the slots are not present.
  const slotCount = model.slots ? model.slots.length : (model.totalPhysicalSlots ?? 0);
  const areaSum = Object.values(model.areas?.zip ?? {}).reduce((sum, area) => sum + (area.ah ?? 0) + (area.oh ?? 0), 0);
  const reconciles = totals.ah + totals.oh === slotCount && (!model.areas || areaSum === slotCount);
  const ahRun = day(model.sources?.ah?.runId), ohRun = day(model.sources?.oh?.runId);
  const unmapped = (model.facilities ?? []).filter((facility) => !facility.ct || !zipCounty[facility.z]).length;
  const window = model.commonMaxDate && model.minDate && model.commonMaxDate >= model.minDate && totals.ah > 0 && totals.oh > 0;
  const credential = (slot) => model.providers?.[slot.p]?.c;
  const otherClinicians = model.nonPhysicianSlots ?? { ah: slots.filter((slot) => slot.y === "ah" && credential(slot) && credential(slot) !== "Physician").length, oh: slots.filter((slot) => slot.y === "oh" && credential(slot) && credential(slot) !== "Physician").length };
  const videoOnly = { ah: model.telemedicineSlots ?? slots.filter((slot) => slot.y === "ah" && slot.v).length, oh: slots.filter((slot) => slot.y === "oh" && slot.v).length };
  const catalog = model.catalog ?? { ah: [], oh: [] };
  const entryList = (system) => (catalog[system] ?? []).map((name) => { const count = model.catalogSlots?.[system]?.[name] ?? 0; return `${name} (${count ? n(count) : "nothing bookable online"})`; }).join(", ");
  const catalogLine = (catalog.ah?.length > 1 || catalog.oh?.length > 1)
    ? [{ ok: true, text: `Scheduling catalog entries pulled: AdventHealth ${entryList("ah") || "none"}; Orlando Health ${entryList("oh") || "none"}. Their slots count together.` }]
    : [];
  return {
    pulled: { at: model.generatedAt, label: `Pulled ${stamp(model.generatedAt)}`, freshDays: 7 },
    checks: [
      { ok: ahRun === ohRun, text: ahRun === ohRun ? `Both systems read on ${ahRun}.` : `AdventHealth read ${ahRun} and Orlando Health ${ohRun}, so the two sides are not from the same day.` },
      { ok: reconciles, text: reconciles ? `Totals reconcile: ${n(totals.ah)} AdventHealth and ${n(totals.oh)} Orlando Health slots.` : `Totals do not reconcile: ${n(totals.ah)} AdventHealth and ${n(totals.oh)} Orlando Health against ${n(slotCount)} slots in the model.` },
      { ok: unmapped === 0, text: unmapped === 0 ? "Every facility maps to a Florida ZIP and county." : `${n(unmapped)} facilities have no map location.` },
      { ok: Boolean(window), text: window ? `Comparison window runs ${day(model.minDate)} to ${day(model.commonMaxDate)} with slots on both sides.` : "One system has no slots in the comparison window." },
      ...catalogLine,
      { ok: true, text: `Video-only slots: ${n(videoOnly.ah)} AdventHealth, ${n(videoOnly.oh)} Orlando Health. Orlando Health publishes no video visits online; the In person filter leaves them out.` },
      // Orlando Health opens only physicians to online booking in cardiology; its orthopedics and gastroenterology
      // catalogs also open nurse practitioners and physician assistants, so the claim follows the count
      { ok: true, text: `Other clinicians: ${n(otherClinicians.ah)} AdventHealth and ${n(otherClinicians.oh)} Orlando Health slots belong to nurse practitioners, physician assistants or nurse schedules. ${otherClinicians.oh ? "The" : "Orlando Health publishes physicians only; the"} Physicians filter leaves them out.` },
    ],
  };
}

export function opportunityDataChecks(model, zipCounty = {}) {
  const report = slotDataChecks(model, zipCounty);
  report.checks.push({ ok: true, text: "Markets are 25-mile circles around each ZIP with active facilities, ranked by how much Orlando Health has that AdventHealth does not: no AdventHealth slots, an earlier first appointment, more slots, and distance to the nearest AdventHealth site. Neighbouring circles overlap and can count the same slots, so market figures are not additive." });
  return report;
}

// Provider Index: directory snapshot plus how far it is from the scheduling catalog.
export const CARDIOLOGY_CHECK = { group: "Cardiology", label: "Cardiology", note: "counting general, interventional, electrophysiology, heart failure and imaging cardiology together. Pediatric cardiology and cardiac surgery are not shown." };
export function providerDataChecks({ data, roster = {}, zipCounty = {}, zipShapes = new Set(), ahCapturedAt, ohCapturedAt, gaps, added = { ah: 0, oh: 0 }, specialty = CARDIOLOGY_CHECK, viaSecondary = { ah: 0, oh: 0 }, elsewhere = [], excluded = [] }) {
  const people = { ah: new Set(), oh: new Set() };
  let missingNpi = 0;
  for (const entries of Object.values(roster)) for (const person of entries) {
    people[person.y]?.add(person.i);
    if (person.src !== "mychart" && !/^\d{10}$/.test(String(person.i))) missingNpi += 1;
  }
  const totals = data.totals ?? { ah: 0, oh: 0 };
  const reconciles = people.ah.size === totals.ah && people.oh.size === totals.oh;
  const unmapped = Object.keys(roster).filter((zip) => !zipCounty[zip] || !zipShapes.has(zip)).length;
  const grouped = (data.specialties ?? []).find((s) => s.name === specialty.group) ?? { ah: 0, oh: 0 };
  const gapCount = (gaps?.ah ?? 0) + (gaps?.oh ?? 0), addedCount = (added?.ah ?? 0) + (added?.oh ?? 0);
  // the sub-specialty labels inside the group: which both systems publish, which only one does
  const members = (specialty.members ?? []).filter((name) => name !== specialty.group);
  const present = (data.specialties ?? []).filter((s) => members.includes(s.name) && (s.ah > 0 || s.oh > 0));
  const shared = present.filter((s) => s.ah > 0 && s.oh > 0).length, ohOnly = present.filter((s) => s.ah === 0).length, ahOnly = present.filter((s) => s.oh === 0).length;
  const viaCount = (viaSecondary?.ah ?? 0) + (viaSecondary?.oh ?? 0);
  // clinicians who book the specialty's visits in MyChart but are listed in a directory under another
  // specialty (counted there, not here) or fall outside the roster's scope (podiatrists in orthopedics)
  const byLabel = new Map();
  for (const item of elsewhere) byLabel.set(item.label, (byLabel.get(item.label) ?? 0) + 1);
  const labelSummary = [...byLabel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => `${label} ${n(count)}`).join(", ");
  const notCounted = (elsewhere.length ? ` ${n(elsewhere.length)} more who book ${specialty.label} visits are listed in the directories under other specialties (${labelSummary}) and are counted there, not here.` : "")
    + (excluded.length ? ` ${n(excluded.length)} who book ${specialty.label} visits are outside this roster's scope (${[...new Set(excluded.map((item) => item.cred))].join(", ")}) and are not counted.` : "");
  const subSpecialtyLine = members.length ? [{ ok: true, text: `Sub-specialty labels: ${n(shared)} published by both systems, ${n(ohOnly)} by Orlando Health only and ${n(ahOnly)} by AdventHealth only; the filter marks the one-sided ones. ${n(viaCount)} clinicians joined the roster through a secondary label.` }] : [];
  return {
    pulled: {
      at: [ahCapturedAt, ohCapturedAt].filter(Boolean).sort()[0] ?? data.generatedAt,
      label: ahCapturedAt && ohCapturedAt ? `Directories captured ${day(ahCapturedAt)} (AdventHealth) and ${day(ohCapturedAt)} (Orlando Health)` : `Directories captured ${stamp(ahCapturedAt ?? ohCapturedAt ?? data.generatedAt)}`,
      freshDays: 30,
    },
    checks: [
      { ok: reconciles, text: reconciles ? `Totals reconcile: ${n(totals.ah)} AdventHealth and ${n(totals.oh)} Orlando Health clinicians.` : `Totals do not reconcile: ${n(people.ah.size)} and ${n(people.oh.size)} people in the roster against ${n(totals.ah)} and ${n(totals.oh)} in the totals.` },
      { ok: unmapped === 0, text: unmapped === 0 ? "Every office maps to a Florida ZIP and county." : `${n(unmapped)} ZIPs in the roster have no map shape or county.` },
      { ok: missingNpi === 0, text: missingNpi === 0 ? `Every directory clinician has an NPI.${addedCount ? ` The ${n(addedCount)} added from MyChart scheduling carry their scheduling ID instead.` : ""}` : `${n(missingNpi)} directory entries have no NPI.` },
      { ok: true, text: `${specialty.label} roster: ${n(grouped.ah)} AdventHealth and ${n(grouped.oh)} Orlando Health clinicians, ${specialty.note}` },
      ...subSpecialtyLine,
      { ok: gapCount === 0, text: gapCount === 0 ? (addedCount ? `Every clinician who books ${specialty.label} visits in MyChart is either a directory person or was added from the scheduling catalog: ${n(added.ah)} AdventHealth and ${n(added.oh)} Orlando Health clinicians came from the scheduling catalog because the directories do not list them.` : `The directories cover everyone who books ${specialty.label} visits in MyChart.`) + notCounted : `${n(gaps.ah)} AdventHealth and ${n(gaps.oh)} Orlando Health clinicians who book ${specialty.label} visits in MyChart are missing from the index.` },
    ],
  };
}

// Name keys for matching people across sources that share no identifier:
// first|last, plus first|second-to-last for double surnames (Garcia-Fernandez).
export function nameKeys(name) {
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "md", "do", "phd", "aprn", "np", "pa", "rn", "dnp", "facc"]);
  const parts = String(name ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/,.*$/, "").replace(/[^a-z\s]/g, " ").trim().split(/\s+/).filter((part) => part && !suffixes.has(part));
  if (!parts.length) return [];
  const keys = [`${parts[0]}|${parts[parts.length - 1]}`];
  if (parts.length >= 3) keys.push(`${parts[0]}|${parts[parts.length - 2]}`);
  return keys;
}

// People with bookable Cardiology slots who are missing from a directory roster.
export function directoryGaps(roster, slotModel) {
  const known = { ah: new Set(), oh: new Set() };
  for (const entries of Object.values(roster ?? {})) for (const person of entries) for (const key of nameKeys(person.n)) known[person.y]?.add(key);
  const gaps = { ah: 0, oh: 0 };
  for (const provider of slotModel?.providers ?? []) {
    if (!["Physician", "Nurse Practitioner", "Physician Assistant"].includes(provider.c)) continue;
    if (known[provider.y] && !nameKeys(provider.n).some((key) => known[provider.y].has(key))) gaps[provider.y] += 1;
  }
  return gaps;
}
