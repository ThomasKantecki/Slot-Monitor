const SYSTEM = new Map([["AH", "ah"], ["OH", "oh"], ["ah", "ah"], ["oh", "oh"]]);

const text = (value) => String(value ?? "").trim();
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

export function buildSlotAvailability(rows, zipCounty = {}) {
  const physical = deduplicatePhysicalSlots(rows);
  const providerIndex = new Map(), facilityIndex = new Map(), types = new Set(), reasons = new Set();
  for (const row of physical) for (const category of row.categories) types.add(category);
  for (const row of physical) for (const reason of row.reasons) reasons.add(reason);
  const typeList = [...types].sort();
  const reasonList = [...reasons].sort();
  const typeIndex = new Map(typeList.map((type, index) => [type, index]));
  const reasonIndex = new Map(reasonList.map((reason, index) => [reason, index]));
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
      d: utc.slice(0, 10), t: text(row.appointment_time), u: utc,
      l: text(row.duration_minutes ?? row.length_minutes),
      ty: row.categories.map((category) => typeIndex.get(category)),
      rv: row.reasons.map((reason) => reasonIndex.get(reason)),
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
    types: typeList, reasons: reasonList, providers, facilities, slots,
    areas: { zip: zipAreas, county: countyAreas },
    totals: { ah: slots.filter((slot) => slot.y === "ah").length, oh: slots.filter((slot) => slot.y === "oh").length },
    minDate: slots[0]?.d ?? "", maxDate: slots.at(-1)?.d ?? "", maxDateBySystem,
    commonMaxDate: systemMaxDates.length ? systemMaxDates.sort()[0] : "",
  };
}
