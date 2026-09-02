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
  const active = model.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.d >= from && slot.d <= through);
  const activeAhFacilities = new Set(active.filter(({ slot }) => slot.y === "ah").map(({ slot }) => slot.f));
  const rows = new Map();

  const createRow = (zip, county = "") => ({
    zip, county: model.zipCounty?.[zip] || county, ah: 0, oh: 0,
    earliestAh: "", earliestOh: "", providersAh: new Set(), providersOh: new Set(),
    facilitiesAh: new Set(), facilitiesOh: new Set(), dates: new Map(), slotIndices: [],
  });

  const addSlot = (row, slot, sourceIndex) => {
    row[slot.y] += 1;
    row[`providers${slot.y === "ah" ? "Ah" : "Oh"}`].add(slot.p);
    row[`facilities${slot.y === "ah" ? "Ah" : "Oh"}`].add(slot.f);
    const earliestKey = slot.y === "ah" ? "earliestAh" : "earliestOh";
    if (!row[earliestKey] || slot.d < row[earliestKey]) row[earliestKey] = slot.d;
    if (!row.dates.has(slot.d)) row.dates.set(slot.d, { ah: 0, oh: 0 });
    row.dates.get(slot.d)[slot.y] += 1;
    row.slotIndices.push(sourceIndex);
  };

  if (marketRadiusMiles > 0) {
    const activeByFacility = new Map();
    for (const entry of active) {
      if (!activeByFacility.has(entry.slot.f)) activeByFacility.set(entry.slot.f, []);
      activeByFacility.get(entry.slot.f).push(entry);
    }
    const candidateZips = new Set(active.map(({ slot }) => model.facilities[slot.f]?.z).filter((zip) => zip && (!includeZips || includeZips.has(zip))));
    for (const zip of candidateZips) {
      const center = originByZip.get(zip);
      const centerFacility = model.facilities.find((facility) => facility?.z === zip);
      const row = createRow(zip, centerFacility?.ct || "");
      for (const [facilityIndex, entries] of activeByFacility) {
        const facility = model.facilities[facilityIndex];
        const facilityOrigin = originByZip.get(facility?.z);
        const inCatchment = facility?.z === zip || (center && facilityOrigin && miles(center.a, center.o, facilityOrigin.a, facilityOrigin.o) <= marketRadiusMiles);
        if (inCatchment) for (const { slot, index } of entries) addSlot(row, slot, index);
      }
      rows.set(zip, row);
    }
  } else {
    for (const { slot, index: sourceIndex } of active) {
      const facility = model.facilities[slot.f];
      if (!facility?.z || (includeZips && !includeZips.has(facility.z))) continue;
      if (!rows.has(facility.z)) rows.set(facility.z, createRow(facility.z, facility.ct || ""));
      addSlot(rows.get(facility.z), slot, sourceIndex);
    }
  }

  const activeAh = [...activeAhFacilities].map((index) => ({ index, origin: originByZip.get(model.facilities[index]?.z) })).filter((row) => row.origin);
  return [...rows.values()].map((row) => {
    const origin = originByZip.get(row.zip);
    let nearestAhMiles = Infinity, nearestAhFacility = null;
    if (origin) for (const candidate of activeAh) {
      const distance = miles(origin.a, origin.o, candidate.origin.a, candidate.origin.o);
      if (distance < nearestAhMiles) { nearestAhMiles = distance; nearestAhFacility = candidate.index; }
    }
    const score = opportunityScore({ ...row, nearestAhMiles });
    return {
      zip: row.zip, county: row.county, ah: row.ah, oh: row.oh,
      slotGap: row.oh - row.ah, earliestAh: row.earliestAh, earliestOh: row.earliestOh,
      timingGapDays: row.ah ? dateDays(row.earliestAh, row.earliestOh) : (row.oh ? null : 0),
      providersAh: row.providersAh.size, providersOh: row.providersOh.size,
      facilitiesAh: row.facilitiesAh.size, facilitiesOh: row.facilitiesOh.size,
      representedDates: row.dates.size, nearestAhMiles, nearestAhFacility,
      marketRadiusMiles, score, slotIndices: row.slotIndices,
    };
  }).sort((a, b) => b.score.total - a.score.total || b.slotGap - a.slotGap || a.zip.localeCompare(b.zip));
}
