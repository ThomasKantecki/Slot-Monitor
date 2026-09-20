// Build step: writes public/data/<specialty> (the summary the pages embed and one slot file per day). `npm run build` runs it after
// build-slot-times-data, once per specialty (`--specialty <id>`, cardiology when absent).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { specialtyFromArgv, specialtyPaths } from "../src/shared/specialties.js";

// Publishes the slot model the way the pages load it: a compact summary (the model without its slots and area
// aggregates) plus one static file per bookable date under public/data/<specialty>/slots. The pages fetch only the
// dates in the selected period, so no page has to embed 700k slots. A checkout without the deep model keeps the
// committed partitions.
const SPECIALTY = specialtyFromArgv();
const PATHS = specialtyPaths(SPECIALTY);
const MODEL = PATHS.model;
const PUBLIC = PATHS.publicData;
const SLOTS = PATHS.slots;

if (!existsSync(MODEL)) {
  if (!existsSync(join(PUBLIC, "slot-times-summary.json"))) throw new Error(`no slot-times-model.json and no published partitions for ${SPECIALTY.id}: run its refresh first`);
  console.log("slot-times-model.json is not present; keeping the published date partitions");
  process.exit(0);
}
const model = JSON.parse(readFileSync(MODEL, "utf8"));
const byDate = new Map();
for (const slot of model.slots) { if (!byDate.has(slot.d)) byDate.set(slot.d, []); byDate.get(slot.d).push(slot); }
const dates = [...byDate.keys()].sort();
const summary = Object.fromEntries(Object.entries(model).filter(([key]) => key !== "slots" && key !== "areas"));
// provider-facility pairs with their slot counts: the Provider Index build adds MyChart-only clinicians at their busiest clinics from these
const pairCounts = new Map();
for (const slot of model.slots) { const key = `${slot.p}|${slot.f}`; pairCounts.set(key, (pairCounts.get(key) || 0) + 1); }
const providerFacilities = [...pairCounts.entries()].map(([key, count]) => [...key.split("|").map(Number), count]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
Object.assign(summary, { partitionVersion: 1, partitionDates: dates, totalPhysicalSlots: model.slots.length, providerFacilities });
mkdirSync(SLOTS, { recursive: true });
for (const stale of readdirSync(SLOTS)) if (stale.endsWith(".json") && !byDate.has(stale.replace(/\.json$/, ""))) rmSync(join(SLOTS, stale));
let bytes = 0;
for (const date of dates) { const text = `${JSON.stringify({ date, slots: byDate.get(date) })}\n`; bytes += text.length; writeFileSync(join(SLOTS, `${date}.json`), text); }
writeFileSync(join(PUBLIC, "slot-times-summary.json"), `${JSON.stringify(summary)}\n`);
console.log(`wrote ${PATHS.summary} and ${dates.length} date partitions (${dates[0]} to ${dates[dates.length - 1]}, ${(bytes / 1e6).toFixed(1)} MB, ${model.slots.length.toLocaleString()} slots)`);
