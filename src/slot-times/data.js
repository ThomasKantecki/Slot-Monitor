// Turns the slot export from data/cardiology/current into the compact model the pages use: numbered providers, facilities and
// visit types, one small record per slot, plus totals by area. Used by scripts/build-slot-times-data.mjs.
const SYSTEM = new Map([["AH", "ah"], ["OH", "oh"], ["ah", "ah"], ["oh", "oh"]]);

const text = (value) => String(value ?? "").trim();

// Booking categories that describe a virtual visit. AdventHealth's anonymous Cardiology
// catalog exposes "New patient telemedicine visit", "Patient Telemedicine Visit" and
// "Telemedicine Established" (video, with a telephone mode); Orlando Health exposes no
// telehealth visit types. Matched by name because the extraction keeps only the label.
const TELEMEDICINE_PATTERN = /telemedicine|telehealth|televisit|telephone|video|virtual|\be-?visit\b/i;
export const isTelemedicineType = (name) => TELEMEDICINE_PATTERN.test(text(name));
// A slot is telemedicine when every booking option on it is a virtual visit. A slot that
// can also be booked as an office visit stays an in-person opportunity.
export const isTelemedicineSlot = (categories) => categories.length > 0 && categories.every(isTelemedicineType);
// Visit types a new patient can book. AdventHealth: "New Patient", "New patient telemedicine visit".
// Orlando Health (the questionnaire remaps its two catalog types): "New Patient", "Orlando Health New
// Cardiology Patient", "Florida Medical Clinic Orlando Health New Cardiology Patient", "ED Cardiology
// Follow Up New". Existing-patient types on both sides carry no "new": "Specialists Office Visit",
// "Established Cardiology Patient", "Patient Telemedicine Visit", "Telemedicine Established".
const NEW_PATIENT_PATTERN = /\bnew\b/i;
export const isNewPatientType = (name) => NEW_PATIENT_PATTERN.test(text(name));
const firstText = (...values) => values.map(text).find(Boolean) ?? "";
const valuesOf = (value) => text(value)
  .split("|").map((value) => value.trim()).filter(Boolean);
const categoriesOf = (row) => valuesOf(firstText(row.booking_categories, row.appointment_types, row.visit_types, row.matching_visit_types));
const reasonsOf = (row) => valuesOf(firstText(row.reasons, row.reason_for_visit, row.matching_reasons));
const physicalKey = (row) => [
  SYSTEM.get(row.system) ?? text(row.system).toLowerCase(),
  text(row.provider_id), text(row.facility_id ?? row.department_id), text(row.display_datetime_utc),
].join("|");

export function deduplicatePhysicalSlots(rows) {
  const groups = new Map();
  for (const source of rows) {
    if (text(source.state).toUpperCase() !== "FL") continue;
    const key = physicalKey(source);
    if (!groups.has(key)) groups.set(key, { ...source, categories: new Set(), reasons: new Set() });
    const output = groups.get(key);
    for (const category of categoriesOf(source)) output.categories.add(category);
    for (const reason of reasonsOf(source)) output.reasons.add(reason);
  }
  return [...groups.values()].map((row) => ({ ...row, categories: [...row.categories].sort(), reasons: [...row.reasons].sort() }));
}

// The day a slot belongs to on the pages is its local (Eastern) calendar day, not the date part of the UTC
// instant: a 7:00 PM slot on November 10 is 2026-11-11T00:00:00Z. Both systems schedule in Florida's Eastern zone.
const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const easternDate = (utc) => { const time = Date.parse(text(utc)); return Number.isNaN(time) ? text(utc).slice(0, 10) : EASTERN_DAY.format(new Date(time)); };

export function buildSlotAvailability(rows, zipCounty = {}, { catalogNames = null } = {}) {
  const physical = deduplicatePhysicalSlots(rows);
  const providerIndex = new Map(), facilityIndex = new Map(), types = new Set(), reasons = new Set();
  for (const row of physical) for (const category of row.categories) types.add(category);
  for (const row of physical) for (const reason of row.reasons) reasons.add(reason);
  const typeList = [...types].sort();
  const reasonList = [...reasons].sort();
  const typeIndex = new Map(typeList.map((type, index) => [type, index]));
  const reasonIndex = new Map(reasonList.map((reason, index) => [reason, index]));
  // The scheduling catalog entries the slots were pulled under (the export's `specialty` column), per system, with
  // their slot counts: provenance for the data check. Older exports without the column leave the lists empty.
  const systemOf = (row) => SYSTEM.get(row.system) ?? text(row.system).toLowerCase();
  const catalogSets = { ah: new Set(), oh: new Set() }, catalogSlots = { ah: {}, oh: {} };
  for (const row of physical) { const entry = text(row.specialty); if (entry && catalogSets[systemOf(row)]) { catalogSets[systemOf(row)].add(entry); catalogSlots[systemOf(row)][entry] = (catalogSlots[systemOf(row)][entry] ?? 0) + 1; } }
  // Every entry the registry asked for is listed, so an entry that published nothing shows as 0 rather than vanishing;
  // an older export without the column attributes its slots to the registry's single entry for that system.
  for (const system of ["ah", "oh"]) {
    const wanted = (catalogNames && catalogNames[system]) || [];
    if (!catalogSets[system].size && wanted.length === 1) catalogSlots[system][wanted[0]] = physical.filter((row) => systemOf(row) === system).length;
    for (const name of wanted) { catalogSets[system].add(name); catalogSlots[system][name] = catalogSlots[system][name] ?? 0; }
  }
  const catalog = { ah: [...catalogSets.ah].sort(), oh: [...catalogSets.oh].sort() };
  const providers = [], facilities = [];
  const indexProvider = (row, system) => {
    const key = `${system}|${text(row.provider_id)}`;
    if (!providerIndex.has(key)) {
      providerIndex.set(key, providers.length);
      providers.push({ i: text(row.provider_id), y: system, n: text(row.provider_name) || "Provider not listed", c: text(row.provider_credentials) });
    }
    return providerIndex.get(key);
  };
  const indexFacility = (row, system) => {
    const key = `${system}|${text(row.facility_id ?? row.department_id)}`;
    if (!facilityIndex.has(key)) {
      facilityIndex.set(key, facilities.length);
      const zip = text(row.zip).slice(0, 5);
      facilities.push({ i: text(row.facility_id ?? row.department_id), y: system, n: text(row.facility_name ?? row.location_name) || "Location not listed", a: text(row.address), c: text(row.city), z: zip, ct: zipCounty[zip] ?? "" });
    }
    return facilityIndex.get(key);
  };
  const slots = physical.map((row) => {
    const system = SYSTEM.get(row.system) ?? text(row.system).toLowerCase();
    const utc = text(row.display_datetime_utc);
    return {
      y: system, p: indexProvider(row, system), f: indexFacility(row, system),
      d: easternDate(utc), t: text(row.appointment_time), u: utc,
      l: text(row.duration_minutes ?? row.length_minutes),
      ty: row.categories.map((category) => typeIndex.get(category)),
      rv: row.reasons.map((reason) => reasonIndex.get(reason)),
      ...(isTelemedicineSlot(row.categories) ? { v: 1 } : {}),
      ...(row.categories.some(isNewPatientType) ? { np: 1 } : {}),
    };
  }).sort((a, b) => a.u.localeCompare(b.u) || a.y.localeCompare(b.y));
  const area = () => ({ ah: 0, oh: 0 });
  const zipAreas = {}, countyAreas = {};
  for (const slot of slots) {
    const facility = facilities[slot.f];
    if (!zipAreas[facility.z]) zipAreas[facility.z] = area();
    zipAreas[facility.z][slot.y] += 1;
    if (facility.ct) {
      if (!countyAreas[facility.ct]) countyAreas[facility.ct] = area();
      countyAreas[facility.ct][slot.y] += 1;
    }
  }
  const maxDateBySystem = { ah: "", oh: "" };
  for (const slot of slots) if (slot.d > maxDateBySystem[slot.y]) maxDateBySystem[slot.y] = slot.d;
  const systemMaxDates = Object.values(maxDateBySystem).filter(Boolean);
  return {
    types: typeList, reasons: reasonList, providers, facilities, slots, catalog, catalogSlots,
    areas: { zip: zipAreas, county: countyAreas },
    totals: { ah: slots.filter((slot) => slot.y === "ah").length, oh: slots.filter((slot) => slot.y === "oh").length },
    telemedicineSlots: slots.filter((slot) => slot.v).length,
    // the mix the pages' Comparison filters act on, per system, for the data check
    nonPhysicianSlots: { ah: slots.filter((slot) => slot.y === "ah" && providers[slot.p].c !== "Physician").length, oh: slots.filter((slot) => slot.y === "oh" && providers[slot.p].c !== "Physician").length },
    newPatientSlots: { ah: slots.filter((slot) => slot.y === "ah" && slot.np).length, oh: slots.filter((slot) => slot.y === "oh" && slot.np).length },
    minDate: slots[0]?.d ?? "", maxDate: slots.at(-1)?.d ?? "", maxDateBySystem,
    commonMaxDate: systemMaxDates.length ? systemMaxDates.sort()[0] : "",
  };
}
