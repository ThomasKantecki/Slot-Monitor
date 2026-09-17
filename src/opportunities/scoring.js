const DAY_MS = 86_400_000;

const dateDays = (later, earlier) => {
  if (!later || !earlier || later <= earlier) return 0;
  return Math.round((Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) / DAY_MS);
};

const rounded = (value) => Math.round(value * 10) / 10;

export const OPPORTUNITY_WEIGHTS = Object.freeze({
  coverageGap: 35,
  timingAdvantage: 25,
  slotAdvantage: 20,
  persistentLead: 10,
  ahDistance: 10,
});

export function opportunityScore({ ah, oh, earliestAh, earliestOh, dates, nearestAhMiles }) {
  if (!oh) return { total: 0, coverageGap: 0, timingAdvantage: 0, slotAdvantage: 0, persistentLead: 0, ahDistance: 0 };

  const coverageGap = ah === 0 ? OPPORTUNITY_WEIGHTS.coverageGap : 0;
  const timingDays = ah === 0 ? 30 : dateDays(earliestAh, earliestOh);
  const timingAdvantage = OPPORTUNITY_WEIGHTS.timingAdvantage * Math.min(timingDays, 30) / 30;
  const slotAdvantage = OPPORTUNITY_WEIGHTS.slotAdvantage * Math.max(0, oh - ah) / Math.max(oh, 1);
  const dateRows = [...dates.values()];
  const persistentLead = dateRows.length
    ? OPPORTUNITY_WEIGHTS.persistentLead * dateRows.filter((row) => row.oh > row.ah).length / dateRows.length
    : 0;
  const ahDistance = OPPORTUNITY_WEIGHTS.ahDistance * Math.min(Number.isFinite(nearestAhMiles) ? nearestAhMiles : 50, 50) / 50;
  const result = { coverageGap, timingAdvantage, slotAdvantage, persistentLead, ahDistance };
  return { total: rounded(Object.values(result).reduce((sum, value) => sum + value, 0)), ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, rounded(value)])) };
}

export function buildOpportunityRows(model, options = {}) {
  const from = options.from || model.minDate;
  const through = options.through || model.commonMaxDate || model.maxDate;
  const includeZips = options.includeZips ? new Set(options.includeZips) : null;
  const marketRadiusMiles = Number(options.marketRadiusMiles) || 0;
  const miles = options.miles || (() => Infinity);
  const originByZip = new Map((model.origins || []).map((origin) => [origin.z, origin]));
  const include = options.include || (() => true);

  // One pass over the slots builds a per-facility summary; markets then merge facility summaries instead of
  // re-reading every slot for every circle that contains it (which took seconds on a 700k-slot model).
  const perFacility = new Map();
  model.slots.forEach((slot, index) => {
    if (!include(slot) || slot.d < from || slot.d > through) return;
    let facility = perFacility.get(slot.f);
    if (!facility) { facility = { y: slot.y, count: 0, providers: new Set(), earliest: "", dates: new Map(), indices: [] }; perFacility.set(slot.f, facility); }
    facility.count += 1; facility.providers.add(slot.p);
    if (!facility.earliest || slot.d < facility.earliest) facility.earliest = slot.d;
    facility.dates.set(slot.d, (facility.dates.get(slot.d) || 0) + 1);
    facility.indices.push(index);
  });
  const rows = new Map();

  const createRow = (zip, county = "") => ({
    zip, county: model.zipCounty?.[zip] || county, ah: 0, oh: 0,
    earliestAh: "", earliestOh: "", providersAh: new Set(), providersOh: new Set(),
    facilitiesAh: new Set(), facilitiesOh: new Set(), dates: new Map(), facilityIndices: [],
  });

  const addFacility = (row, facilityIndex, facility) => {
    const system = facility.y === "ah" ? "Ah" : "Oh";
    row[facility.y] += facility.count;
    for (const provider of facility.providers) row[`providers${system}`].add(provider);
    row[`facilities${system}`].add(facilityIndex);
    const earliestKey = `earliest${system}`;
    if (!row[earliestKey] || facility.earliest < row[earliestKey]) row[earliestKey] = facility.earliest;
    for (const [date, count] of facility.dates) {
      let day = row.dates.get(date);
      if (!day) { day = { ah: 0, oh: 0 }; row.dates.set(date, day); }
      day[facility.y] += count;
    }
    row.facilityIndices.push(facilityIndex);
  };

  if (marketRadiusMiles > 0) {
    const candidateZips = new Set([...perFacility.keys()].map((index) => model.facilities[index]?.z).filter((zip) => zip && (!includeZips || includeZips.has(zip))));
    for (const zip of candidateZips) {
      const center = originByZip.get(zip);
      const centerFacility = model.facilities.find((facility) => facility?.z === zip);
      const row = createRow(zip, centerFacility?.ct || "");
      for (const [facilityIndex, summary] of perFacility) {
        const facility = model.facilities[facilityIndex];
        const facilityOrigin = originByZip.get(facility?.z);
        const inCatchment = facility?.z === zip || (center && facilityOrigin && miles(center.a, center.o, facilityOrigin.a, facilityOrigin.o) <= marketRadiusMiles);
        if (inCatchment) addFacility(row, facilityIndex, summary);
      }
      rows.set(zip, row);
    }
  } else {
    for (const [facilityIndex, summary] of perFacility) {
      const facility = model.facilities[facilityIndex];
      if (!facility?.z || (includeZips && !includeZips.has(facility.z))) continue;
      if (!rows.has(facility.z)) rows.set(facility.z, createRow(facility.z, facility.ct || ""));
      addFacility(rows.get(facility.z), facilityIndex, summary);
    }
  }

  const activeAh = [...perFacility.entries()].filter(([, summary]) => summary.y === "ah").map(([index]) => ({ index, origin: originByZip.get(model.facilities[index]?.z) })).filter((row) => row.origin);
  const result = [...rows.values()].map((row) => {
    const origin = originByZip.get(row.zip);
    let nearestAhMiles = Infinity, nearestAhFacility = null;
    if (origin) for (const candidate of activeAh) {
      const distance = miles(origin.a, origin.o, candidate.origin.a, candidate.origin.o);
      if (distance < nearestAhMiles) { nearestAhMiles = distance; nearestAhFacility = candidate.index; }
    }
    const score = opportunityScore({ ...row, nearestAhMiles });
    const out = {
      zip: row.zip, county: row.county, ah: row.ah, oh: row.oh,
      slotGap: row.oh - row.ah, earliestAh: row.earliestAh, earliestOh: row.earliestOh,
      timingGapDays: row.ah ? dateDays(row.earliestAh, row.earliestOh) : (row.oh ? null : 0),
      booksSooner: row.oh > 0 && (row.ah === 0 || dateDays(row.earliestAh, row.earliestOh) >= 7),  // a week or more sooner, not a one-day difference
      leadDates: [...row.dates.values()].filter((day) => day.oh > day.ah).length,
      providersAh: row.providersAh.size, providersOh: row.providersOh.size,
      facilitiesAh: row.facilitiesAh.size, facilitiesOh: row.facilitiesOh.size,
      representedDates: row.dates.size, nearestAhMiles, nearestAhFacility,
      marketRadiusMiles, score, facilityIndices: row.facilityIndices, rank: 0,
    };
    // The slot indices behind a market are only needed for the one the user opens, so they are assembled on demand.
    Object.defineProperty(out, "slotIndices", { enumerable: false, get() { let indices = []; for (const facilityIndex of row.facilityIndices) indices = indices.concat(perFacility.get(facilityIndex).indices); return indices.sort((a, b) => a - b); } });
    return out;
  }).sort((a, b) => b.score.total - a.score.total || b.slotGap - a.slotGap || a.zip.localeCompare(b.zip));
  result.forEach((row, index) => { row.rank = index + 1; });
  return result;
}

// The reasons a market ranks where it does, in the words the page shows: strongest signal first.
export function marketReasons(row, { exactGap = false } = {}) {
  const reasons = [];
  const scope = row.marketRadiusMiles ? `within ${row.marketRadiusMiles} miles` : "in this ZIP";
  if (exactGap) reasons.push({ system: "oh", text: "No AdventHealth slots in this ZIP" });
  if (row.ah === 0 && row.oh > 0) reasons.push({ system: "oh", text: `No AdventHealth slots ${scope}` });
  else if (row.ah > 0 && row.oh > 0 && row.earliestOh && row.earliestAh) {
    const days = dateDays(row.earliestAh, row.earliestOh);
    if (days > 0) reasons.push({ system: "oh", text: `Orlando Health books ${days} day${days === 1 ? "" : "s"} sooner` });
    else { const ahDays = dateDays(row.earliestOh, row.earliestAh); if (ahDays > 0) reasons.push({ system: "ah", text: `AdventHealth books ${ahDays} day${ahDays === 1 ? "" : "s"} sooner` }); }
  }
  const more = (count) => `${count.toLocaleString("en-US")} more slot${count === 1 ? "" : "s"}`;
  if (row.slotGap > 0 && row.ah > 0) reasons.push({ system: "oh", text: `Orlando Health has ${more(row.slotGap)}` });
  if (row.slotGap < 0) reasons.push({ system: "ah", text: `AdventHealth has ${more(-row.slotGap)}` });
  if (Number.isFinite(row.nearestAhMiles) && row.nearestAhMiles >= 1) reasons.push({ system: "ah", text: `Nearest AdventHealth ${row.nearestAhMiles.toFixed(row.nearestAhMiles >= 10 ? 0 : 1)} mi away` });
  if (row.ah > 0 && row.leadDates > 0) reasons.push({ system: "oh", text: `Orlando Health ahead on ${row.leadDates} of ${row.representedDates} dates` });
  return reasons;
}
