// Refresh step 3: picks the newest complete AdventHealth and Orlando Health runs under data/<specialty>/runs, joins them into
// data/<specialty>/current (the slot export + manifest.json) that the page builds read. Called by extractors/cardiology/refresh.py
// with `--specialty <id>` (cardiology when absent).
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isNewPatientSlot, isPhysicianSlot, isTelemedicineOnlySlot } from "../src/slot-rules.js";
import { specialtyFromArgv, specialtyPaths } from "../src/shared/specialties.js";

const ROOT = process.cwd();
const SPECIALTY = specialtyFromArgv();
const PATHS = specialtyPaths(SPECIALTY);
const RUNS = join(ROOT, PATHS.runs);
const OUT = join(ROOT, PATHS.current);

export function latestSystemFile(system, filename) {
  const candidates = readdirSync(RUNS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ runId: entry.name, path: join(RUNS, entry.name, system, filename) }))
    .filter((entry) => existsSync(entry.path))
    .sort((a, b) => b.runId.localeCompare(a.runId));
  if (!candidates.length) throw new Error(`No ${system.toUpperCase()} ${SPECIALTY.label} run contains ${filename}`);
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

// Both outputs are streamed in chunks: a full run is hundreds of megabytes, more than one JS string may hold.
function writeLines(path, head, lines, tail) {
  return new Promise((resolvePromise, reject) => {
    const stream = createWriteStream(path, { encoding: "utf8" });
    stream.on("error", reject); stream.on("finish", resolvePromise);
    stream.write(head);
    let batch = [];
    for (const line of lines) { batch.push(line); if (batch.length >= 4000) { stream.write(batch.join("")); batch = []; } }
    if (batch.length) stream.write(batch.join(""));
    stream.write(tail); stream.end();
  });
}

function writeCsv(path, rows) {
  const headers = ["system", "physical_slot_id", "provider_name", "provider_id", "provider_credentials", "facility_name", "facility_id", "address", "city", "state", "zip", "appointment_date", "appointment_time", "display_datetime_utc", "days_ahead", "duration_minutes", "booking_categories", "booking_category_count", "visit_types", "reasons", "matching_flow_count", "specialty"];
  return writeLines(path, `${headers.join(",")}\n`, rows.map((row) => `${headers.map((header) => csvValue(row[header])).join(",")}\n`), "");
}

const ahSource = latestSystemFile("ah", `ah-${SPECIALTY.id}-physical-slots.json`);
const ohSource = latestSystemFile("oh", "source-oh-unique-physical-slots.csv");
// A full AdventHealth run's physical-slot file is written one row per line and can exceed what Node will
// read into one string, so it is parsed line by line (a plain single-line JSON array still works).
function readJsonRows(path) {
  const size = statSync(path).size;
  if (size < 400 * 1024 * 1024) return JSON.parse(readFileSync(path, "utf8"));
  const rows = [];
  const fd = openSync(path, "r"); const chunk = Buffer.alloc(1 << 22); let leftover = "", position = 0;
  const take = (line) => { const text = line.trim().replace(/,$/, ""); if (text && text !== "[" && text !== "]") rows.push(JSON.parse(text)); };
  for (;;) {
    const read = readSync(fd, chunk, 0, chunk.length, position); if (!read) break; position += read;
    const parts = (leftover + chunk.toString("utf8", 0, read)).split("\n"); leftover = parts.pop();
    for (const line of parts) take(line);
  }
  closeSync(fd); if (leftover) take(leftover);
  return rows;
}
const ahFlorida = readJsonRows(ahSource.path).filter((row) => String(row.state).toUpperCase() === "FL");
const ohFlorida = parseCsv(readFileSync(ohSource.path, "utf8")).filter((row) => String(row.state).toUpperCase() === "FL");
// Every published Florida slot is kept. The pages show everything by default and offer the comparability
// rules in src/slot-rules.js as filters; the manifest records the mix for the data check.
const mix = (rows) => ({ nonPhysicianSlots: rows.filter((row) => !isPhysicianSlot(row)).length, telemedicineOnlySlots: rows.filter(isTelemedicineOnlySlot).length, newPatientSlots: rows.filter(isNewPatientSlot).length });
const ah = ahFlorida
  .map((row) => ({
    system: "AH", physical_slot_id: row.physical_slot_id, provider_name: row.provider_name, provider_id: row.provider_id,
    provider_credentials: row.provider_credentials, facility_name: row.location_name, facility_id: row.department_id,
    address: row.address, city: row.city, state: row.state, zip: row.zip, appointment_date: row.appointment_date,
    appointment_time: row.appointment_time, display_datetime_utc: row.display_datetime_utc, days_ahead: row.days_ahead,
    duration_minutes: row.duration_minutes, booking_categories: row.appointment_types, booking_category_count: row.appointment_type_count,
    visit_types: "", reasons: "",
    matching_flow_count: "",
    specialty: row.specialty ?? "",
  }));
const oh = ohFlorida
  .map((row) => ({
    system: "OH", physical_slot_id: `OH-${row.physical_slot_id}`, provider_name: row.provider_name, provider_id: row.provider_id,
    provider_credentials: row.provider_credentials, facility_name: row.location_name, facility_id: row.department_id,
    address: row.address, city: row.city, state: row.state, zip: row.zip, appointment_date: row.appointment_date,
    appointment_time: row.appointment_time, display_datetime_utc: row.display_datetime_utc, days_ahead: row.days_ahead,
    duration_minutes: row.length_minutes, booking_categories: "", booking_category_count: 0,
    visit_types: row.matching_visit_types || "", reasons: row.matching_reasons || "",
    matching_flow_count: row.matching_flow_count,
    specialty: row.specialty ?? "",
  }));
const slots = [...ah, ...oh].sort((a, b) => a.display_datetime_utc.localeCompare(b.display_datetime_utc) || a.system.localeCompare(b.system));
mkdirSync(OUT, { recursive: true });
// written one row per line so downstream readers can stream it; still a valid JSON array
await writeLines(join(ROOT, PATHS.export), "[\n", slots.map((slot, index) => `${index ? ",\n" : ""}${JSON.stringify(slot)}`), "\n]\n");
await writeCsv(join(ROOT, PATHS.exportCsv), slots);
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify({
  status: "completed_with_warnings", scope: `Florida ${SPECIALTY.label} public appointment availability`,
  rule: "all published slots are kept and shown by default; the pages offer physicians-only, in-person-only and new-patient filters (src/slot-rules.js)",
  ah: { runId: ahSource.runId, source: relative(ROOT, ahSource.path).replaceAll("\\", "/"), physicalSlots: ah.length, ...mix(ahFlorida), bookingCategoriesRetained: true },
  oh: { runId: ohSource.runId, source: relative(ROOT, ohSource.path).replaceAll("\\", "/"), physicalSlots: oh.length, ...mix(ohFlorida), bookingCategoriesRetained: false },
  totalPhysicalSlots: slots.length, generatedAt: new Date().toISOString(),
}, null, 2)}\n`);
const ahMix = mix(ahFlorida), ohMix = mix(ohFlorida);
console.log(`Built ${slots.length.toLocaleString()} Florida physical ${SPECIALTY.label} slots (${ah.length.toLocaleString()} AH, ${oh.length.toLocaleString()} OH). Mix: non-physician ${ahMix.nonPhysicianSlots.toLocaleString()} AH / ${ohMix.nonPhysicianSlots.toLocaleString()} OH, video-only ${ahMix.telemedicineOnlySlots.toLocaleString()} AH / ${ohMix.telemedicineOnlySlots.toLocaleString()} OH, new-patient ${ahMix.newPatientSlots.toLocaleString()} AH / ${ohMix.newPatientSlots.toLocaleString()} OH.`);
