import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const model = read("data/cardiology/current/slot-times-model.json");
const zipCounty = read("data/zip-county.json");
const countyGeo = read("data/fl-county.geojson");
const zipGeo = read("data/fl-zcta.geojson");
const countyShapes = new Set(countyGeo.features.map((feature) => String(feature.properties.name).trim()));
const zipShapes = new Set(zipGeo.features.map((feature) => String(feature.properties.zip).trim()));
const slotTotals = new Map(model.facilities.map((_, index) => [index, { ah: 0, oh: 0 }]));
for (const slot of model.slots) slotTotals.get(slot.f)[slot.y] += 1;

const systems = { ah: { slots: 0, mapped: 0 }, oh: { slots: 0, mapped: 0 } };
const zips = new Set(), mappedCounties = new Set(), unmapped = [], missingZipShapes = [], missingCountyShapes = new Set();
for (let index = 0; index < model.facilities.length; index += 1) {
  const facility = model.facilities[index], counts = slotTotals.get(index), zip = String(facility.z || "").slice(0, 5);
  zips.add(zip); systems.ah.slots += counts.ah; systems.oh.slots += counts.oh;
  const county = zipCounty[zip];
  if (county) {
    mappedCounties.add(county); systems.ah.mapped += counts.ah; systems.oh.mapped += counts.oh;
    if (!countyShapes.has(county)) missingCountyShapes.add(county);
  } else unmapped.push({ zip, system: facility.y, facility: facility.n, slots: counts.ah + counts.oh });
  if (!zipShapes.has(zip)) missingZipShapes.push({ zip, system: facility.y, facility: facility.n, slots: counts.ah + counts.oh });
}
const countyAggregateSlots = Object.values(model.areas.county).reduce((sum, row) => sum + row.ah + row.oh, 0);
const activeCounties = [...mappedCounties].sort();
const result = {
  currentSlots: model.slots.length,
  facilities: model.facilities.length,
  uniqueFacilityZips: zips.size,
  activeCounties: activeCounties.length,
  countyShapes: countyShapes.size,
  zipShapes: zipShapes.size,
  systems,
  mappedSlotRate: Number(((systems.ah.mapped + systems.oh.mapped) / model.slots.length * 100).toFixed(4)),
  countyAggregateSlots,
  countyAggregateReconciles: countyAggregateSlots === model.slots.length,
  unmappedFacilities: unmapped,
  facilityZipsMissingMapShape: missingZipShapes,
  mappedCountiesMissingShape: [...missingCountyShapes].sort(),
  activeCountyNames: activeCounties,
  countyShapesWithoutCurrentSlots: [...countyShapes].filter((county) => !mappedCounties.has(county)).sort(),
};
console.log(JSON.stringify(result, null, 2));
