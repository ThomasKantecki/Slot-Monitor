// Sanity check for the Market Opportunities numbers: the per-ZIP rows must add up to the slot total, then prints the top markets. `npm run audit:opportunities`.
import { readFileSync } from "node:fs";
import { specialtyFromArgv, specialtyPaths } from "../src/shared/specialties.js";
import { buildOpportunityRows } from "../src/opportunities/scoring.js";
import "../src/slot-times/radius.js";
import "../src/shared/date.js";

const model = JSON.parse(readFileSync(specialtyPaths(specialtyFromArgv()).model, "utf8"));
const source = readFileSync("data/geography/florida-zip-centroids.js", "utf8").trim();
model.origins = JSON.parse(source.replace(/^window\.FLORIDA_ZIP_CENTROIDS=/, "").replace(/;$/, "")).map((row) => ({ z: row.zip, a: row.latitude, o: row.longitude }));
const through = model.commonMaxDate || model.maxDate;
const rows = buildOpportunityRows(model, { from: model.minDate, through, miles: globalThis.SLOT_RADIUS.miles });
const expected = model.slots.filter((slot) => slot.d >= model.minDate && slot.d <= through).length;
const observed = rows.reduce((sum, row) => sum + row.ah + row.oh, 0);
if (observed !== expected) throw new Error(`ZIP opportunity reconciliation failed: ${observed} vs ${expected}`);

console.log(`Opportunity audit: ${rows.length} represented ZIPs, ${observed.toLocaleString()} reconciled slots, ${model.minDate} through ${through}`);
console.table(rows.slice(0, 10).map((row, index) => ({ rank: index + 1, zip: row.zip, county: row.county, score: row.score.total, ah: row.ah, oh: row.oh, gap: row.slotGap, ahEarliest: row.earliestAh || "none", ohEarliest: row.earliestOh || "none", nearestAhMiles: Number.isFinite(row.nearestAhMiles) ? row.nearestAhMiles.toFixed(1) : "none" })));
console.table(rows.filter((row) => ["32804", "33701"].includes(row.zip)).map((row) => ({ zip: row.zip, county: row.county, score: row.score.total, ah: row.ah, oh: row.oh, ahEarliest: row.earliestAh || "none", ohEarliest: row.earliestOh || "none", nearestAhMiles: Number.isFinite(row.nearestAhMiles) ? row.nearestAhMiles.toFixed(1) : "none" })));

const originByZip = new Map(model.origins.map((origin) => [origin.z, origin]));
const center = originByZip.get("32804");
const defaultZips = model.origins.filter((origin) => globalThis.SLOT_RADIUS.miles(center.a, center.o, origin.a, origin.o) <= 140).map((origin) => origin.z);
const defaultExactRows = buildOpportunityRows(model, { from: globalThis.SUITE_DATE.today(), through, includeZips: defaultZips, miles: globalThis.SLOT_RADIUS.miles });
const defaultExactGaps = defaultExactRows.filter((row) => row.oh > 0 && row.ah === 0);
const defaultRows = buildOpportunityRows(model, { from: globalThis.SUITE_DATE.today(), through, includeZips: defaultZips, marketRadiusMiles: 25, miles: globalThis.SLOT_RADIUS.miles });
const defaultLeaders = defaultRows.filter((row) => row.oh > row.ah);
const coverageGaps = defaultLeaders.filter((row) => row.ah === 0);
const sharedMarkets = defaultLeaders.filter((row) => row.ah > 0);
if (!defaultExactGaps.length) throw new Error("Expected at least one default-scope exact-ZIP gap");
console.log(`Default map layers: ${defaultExactGaps.length} exact-ZIP gaps + ${sharedMarkets.length} AH-present/OH-leading 25-mile markets (${coverageGaps.length} additional 25-mile AH-absent markets)`);
console.table(defaultExactGaps.map((row) => ({ zip: row.zip, county: row.county, ah: row.ah, oh: row.oh, gap: row.slotGap })));
console.table(sharedMarkets.map((row) => ({ zip: row.zip, county: row.county, score: row.score.total, ah: row.ah, oh: row.oh, gap: row.slotGap })));

const statewideToday = buildOpportunityRows(model, { from: globalThis.SUITE_DATE.today(), through, miles: globalThis.SLOT_RADIUS.miles });
const statewideSharedLeaders = statewideToday.filter((row) => row.ah > 0 && row.oh > row.ah);
console.log(`Statewide exact-ZIP overlap: ${statewideSharedLeaders.length} ZIPs have both systems and an OH slot lead`);
console.table(statewideSharedLeaders.map((row) => ({ zip: row.zip, county: row.county, ah: row.ah, oh: row.oh, gap: row.slotGap })));

const statewideMarkets = buildOpportunityRows(model, { from: globalThis.SUITE_DATE.today(), through, marketRadiusMiles: 25, miles: globalThis.SLOT_RADIUS.miles });
const statewideMarketLeaders = statewideMarkets.filter((row) => row.ah > 0 && row.oh > row.ah);
if (!sharedMarkets.length) console.log("No default-scope 25-mile market has both systems with an OH lead in this specialty: AH leads every market where both have openings.");
console.log(`Statewide 25-mile overlap: ${statewideMarketLeaders.length} represented market centers have both systems and an OH slot lead`);
console.table(statewideMarketLeaders.slice(0, 12).map((row) => ({ zip: row.zip, county: row.county, ah: row.ah, oh: row.oh, gap: row.slotGap })));
