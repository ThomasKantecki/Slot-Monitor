import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const RUNS = join(ROOT, "data", "cardiology", "runs");
const OUT = join(ROOT, "data", "cardiology", "current");

export function latestSystemFile(system, filename) {
  const candidates = readdirSync(RUNS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ runId: entry.name, path: join(RUNS, entry.name, system, filename) }))
    .filter((entry) => existsSync(entry.path))
    .sort((a, b) => b.runId.localeCompare(a.runId));
  if (!candidates.length) throw new Error(`No ${system.toUpperCase()} Cardiology run contains ${filename}`);
  return candidates[0];
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (quoted && char === '"' && next === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(value); value = ""; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...body] = rows;
  return body.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), values[index] ?? ""])));
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(path, rows) {
  const headers = ["system", "physical_slot_id", "provider_name", "provider_id", "provider_credentials", "facility_name", "facility_id", "address", "city", "state", "zip", "appointment_date", "appointment_time", "display_datetime_utc", "days_ahead", "duration_minutes", "booking_categories", "booking_category_count", "visit_types", "reasons", "matching_flow_count"];
  writeFileSync(path, [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n") + "\n");
}

const ahSource = latestSystemFile("ah", "ah-cardiology-physical-slots.json");
const ohSource = latestSystemFile("oh", "source-oh-unique-physical-slots.csv");
const ah = JSON.parse(readFileSync(ahSource.path, "utf8"))
  .filter((row) => String(row.state).toUpperCase() === "FL")
  .map((row) => ({
    system: "AH", physical_slot_id: row.physical_slot_id, provider_name: row.provider_name, provider_id: row.provider_id,
    provider_credentials: row.provider_credentials, facility_name: row.location_name, facility_id: row.department_id,
    address: row.address, city: row.city, state: row.state, zip: row.zip, appointment_date: row.appointment_date,
    appointment_time: row.appointment_time, display_datetime_utc: row.display_datetime_utc, days_ahead: row.days_ahead,
    duration_minutes: row.duration_minutes, booking_categories: row.appointment_types, booking_category_count: row.appointment_type_count,
    visit_types: "", reasons: "",
    matching_flow_count: "",
  }));
const oh = parseCsv(readFileSync(ohSource.path, "utf8"))
  .filter((row) => String(row.state).toUpperCase() === "FL")
  .map((row) => ({
    system: "OH", physical_slot_id: `OH-${row.physical_slot_id}`, provider_name: row.provider_name, provider_id: row.provider_id,
    provider_credentials: row.provider_credentials, facility_name: row.location_name, facility_id: row.department_id,
    address: row.address, city: row.city, state: row.state, zip: row.zip, appointment_date: row.appointment_date,
    appointment_time: row.appointment_time, display_datetime_utc: row.display_datetime_utc, days_ahead: row.days_ahead,
    duration_minutes: row.length_minutes, booking_categories: "", booking_category_count: 0,
    visit_types: row.matching_visit_types || "", reasons: row.matching_reasons || "",
    matching_flow_count: row.matching_flow_count,
  }));
const slots = [...ah, ...oh].sort((a, b) => a.display_datetime_utc.localeCompare(b.display_datetime_utc) || a.system.localeCompare(b.system));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "cardiology-physical-slots.json"), `${JSON.stringify(slots)}\n`);
writeCsv(join(OUT, "cardiology-physical-slots.csv"), slots);
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify({
  status: "completed_with_warnings", scope: "Florida Cardiology public appointment availability",
  ah: { runId: ahSource.runId, source: relative(ROOT, ahSource.path).replaceAll("\\", "/"), physicalSlots: ah.length, bookingCategoriesRetained: true },
  oh: { runId: ohSource.runId, source: relative(ROOT, ohSource.path).replaceAll("\\", "/"), physicalSlots: oh.length, bookingCategoriesRetained: false },
  totalPhysicalSlots: slots.length, generatedAt: new Date().toISOString(),
}, null, 2)}\n`);
console.log(`Built ${slots.length.toLocaleString()} Florida physical Cardiology slots (${ah.length.toLocaleString()} AH, ${oh.length.toLocaleString()} OH).`);
