import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSlotAvailability } from "../src/slot-times/data.js";

const valueOf = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
};

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (quoted && char === '"' && next === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(value); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...body] = rows;
  return body.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), values[index] ?? ""])));
}

function publishedAhRows(summary, root) {
  const providers = summary.providers;
  const facilities = summary.facilities;
  const rows = [];
  for (const date of summary.partitionDates) {
    const partition = JSON.parse(readFileSync(join(root, "public", "data", "cardiology", "slots", `${date}.json`), "utf8"));
    for (const slot of partition.slots) {
      if (slot.y !== "ah") continue;
      const provider = providers[slot.p], facility = facilities[slot.f];
      rows.push({
        system: "AH", provider_id: provider.i, provider_name: provider.n, provider_credentials: provider.c,
        facility_id: facility.i, facility_name: facility.n, address: facility.a, city: facility.c,
        state: "FL", zip: facility.z, appointment_time: slot.t, display_datetime_utc: slot.u,
        duration_minutes: slot.l, booking_categories: (slot.ty || []).map((index) => summary.types[index]).join("|"),
        reasons: (slot.rv || []).map((index) => summary.reasons[index]).join("|"),
      });
    }
  }
  return rows;
}

function writePartitions(model, root) {
  const publicRoot = join(root, "public", "data", "cardiology");
  const slotsRoot = join(publicRoot, "slots");
  const byDate = new Map();
  for (const slot of model.slots) {
    if (!byDate.has(slot.d)) byDate.set(slot.d, []);
    byDate.get(slot.d).push(slot);
  }
  const dates = [...byDate.keys()].sort();
  mkdirSync(slotsRoot, { recursive: true });
  for (const stale of readdirSync(slotsRoot)) {
    if (stale.endsWith(".json") && !byDate.has(stale.replace(/\.json$/, ""))) rmSync(join(slotsRoot, stale));
  }
  for (const date of dates) writeFileSync(join(slotsRoot, `${date}.json`), `${JSON.stringify({ date, slots: byDate.get(date) })}\n`);
  const summary = Object.fromEntries(Object.entries(model).filter(([key]) => key !== "slots" && key !== "areas"));
  const pairCounts = new Map();
  for (const slot of model.slots) {
    const key = `${slot.p}|${slot.f}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  summary.partitionVersion = 1;
  summary.partitionDates = dates;
  summary.totalPhysicalSlots = model.slots.length;
  summary.providerFacilities = [...pairCounts.entries()]
    .map(([key, count]) => [...key.split("|").map(Number), count])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  writeFileSync(join(publicRoot, "slot-times-summary.json"), `${JSON.stringify(summary)}\n`);
  return summary;
}

function main() {
  const source = valueOf("--source");
  const runId = valueOf("--run-id");
  if (!source || !runId) throw new Error("Usage: node scripts/replace-oh-published-slots.mjs --source <deduplicated-oh.csv> --run-id <run-id>");
  const root = process.cwd();
  const summaryPath = join(root, "public", "data", "cardiology", "slot-times-summary.json");
  if (!existsSync(summaryPath)) throw new Error("Published slot summary is missing.");
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  const ahRows = publishedAhRows(summary, root);
  if (ahRows.length !== summary.totals.ah) throw new Error(`AH reconstruction mismatch: ${ahRows.length} vs ${summary.totals.ah}`);
  const ohRows = parseCsv(readFileSync(source, "utf8")).filter((row) => String(row.state).toUpperCase() === "FL").map((row) => ({
    ...row, system: "OH", facility_id: row.department_id, facility_name: row.location_name,
    booking_categories: row.matching_visit_types || "", reasons: row.matching_reasons || "",
    duration_minutes: row.length_minutes,
  }));
  const zipCounty = JSON.parse(readFileSync(join(root, "data", "zip-county.json"), "utf8"));
  const model = buildSlotAvailability([...ahRows, ...ohRows], zipCounty);
  model.generatedAt = new Date().toISOString();
  model.status = summary.status;
  model.scope = summary.scope;
  model.sources = {
    ah: summary.sources.ah,
    oh: {
      runId, source: `data/cardiology/runs/${runId}/oh/source-oh-unique-physical-slots.csv`,
      physicalSlots: model.totals.oh, nonPhysicianSlots: model.nonPhysicianSlots.oh,
      telemedicineOnlySlots: 0, newPatientSlots: model.newPatientSlots.oh, bookingCategoriesRetained: false,
    },
  };
  const current = join(root, "data", "cardiology", "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(join(current, "slot-times-model.json"), `${JSON.stringify(model)}\n`);
  const nextSummary = writePartitions(model, root);
  const manifestPath = join(current, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  Object.assign(manifest, {
    status: model.status, scope: model.scope, ah: model.sources.ah, oh: model.sources.oh,
    totalPhysicalSlots: model.slots.length, generatedAt: model.generatedAt,
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Rebuilt ${model.slots.length.toLocaleString()} physical slots: ${model.totals.ah.toLocaleString()} AH unchanged + ${model.totals.oh.toLocaleString()} OH from ${runId}.`);
  console.log(`Published ${nextSummary.partitionDates.length} daily slot partitions from ${nextSummary.minDate} through ${nextSummary.maxDate}.`);
}

main();
