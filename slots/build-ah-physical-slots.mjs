// Refresh step 2 (AdventHealth): turns the raw slot rows the scraper wrote (one row per visit type) into physical slots,
// one per provider + location + time, and stores them with their audit under data/<specialty>/runs/<run-id>/ah (`--specialty <id>`,
// cardiology when absent). Called by extractor/refresh.py.
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { specialtyFromArgv, specialtyPaths } from "../pages/shared/specialties.js";

const TYPE_ORDER = [
  "New Patient",
  "Specialists Office Visit",
  "New patient telemedicine visit",
  "Patient Telemedicine Visit",
  "Telemedicine Established",
];
const TYPE_RANK = new Map(TYPE_ORDER.map((type, index) => [type, index]));
const PHYSICAL_FIELDS = [
  "specialty", "provider_name", "provider_id", "provider_credentials", "location_name", "department_id",
  "address", "city", "state", "zip", "appointment_date", "appointment_time", "display_datetime_utc",
  "days_ahead", "timezone", "decision_tree_path", "source_url",
];

function optionOf(row) {
  return {
    appointment_type: String(row.appointment_type ?? "").trim(),
    reason_for_visit: String(row.reason_for_visit ?? "").trim(),
    length_minutes: Number(row.length_minutes) || null,
  };
}

function physicalKey(row) {
  return [row.provider_id, row.department_id, row.display_datetime_utc].map((value) => String(value ?? "").trim()).join("|");
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows, headers) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n") + "\n";
}

// Rows are folded into physical slots one at a time, so a run of a million raw rows never has to be
// held as one JSON string (Node cannot even read a file that large into a single string).
export function createAccumulator() {
  const groups = new Map();
  return {
    add(row) {
      const key = physicalKey(row);
      if (!groups.has(key)) groups.set(key, { row, options: new Map() });
      const option = optionOf(row);
      groups.get(key).options.set(JSON.stringify(option), option);
    },
    finish() { return finishGroups(groups); },
  };
}

export function combineAhPhysicalSlots(rows) {
  const accumulator = createAccumulator();
  for (const row of rows) accumulator.add(row);
  return accumulator.finish();
}

function finishGroups(groups) {
  return [...groups.entries()].map(([key, group]) => {
    const options = [...group.options.values()].sort((a, b) =>
      (TYPE_RANK.get(a.appointment_type) ?? 99) - (TYPE_RANK.get(b.appointment_type) ?? 99)
      || a.appointment_type.localeCompare(b.appointment_type)
      || (a.length_minutes ?? 0) - (b.length_minutes ?? 0));
    const types = [...new Set(options.map((option) => option.appointment_type).filter(Boolean))];
    const durations = [...new Set(options.map((option) => option.length_minutes).filter(Boolean))].sort((a, b) => a - b);
    const output = Object.fromEntries(PHYSICAL_FIELDS.map((field) => [field, group.row[field] ?? ""]));
    return {
      physical_slot_id: `AH-${createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
      ...output,
      appointment_types: types.join(" | "),
      appointment_type_count: types.length,
      duration_minutes: durations.join(" | "),
      booking_options_json: JSON.stringify(options),
    };
  }).sort((a, b) => a.display_datetime_utc.localeCompare(b.display_datetime_utc)
    || a.provider_name.localeCompare(b.provider_name)
    || a.department_id.localeCompare(b.department_id));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// The source is a slots.json array (small runs), a JSON-lines file, or a directory of the extractor's
// per-flow JSON-lines part files (large runs); the last two are streamed line by line.
async function readSource(sourcePath, accumulator) {
  const hash = createHash("sha256");
  let rows = 0;
  const files = statSync(sourcePath).isDirectory()
    ? readdirSync(sourcePath).filter((name) => name.endsWith(".jsonl")).sort().map((name) => join(sourcePath, name))
    : [sourcePath];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) {
      const text = readFileSync(file, "utf8"); hash.update(text);
      for (const row of JSON.parse(text)) { accumulator.add(row); rows += 1; }
      continue;
    }
    const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      hash.update(line); hash.update("\n");
      accumulator.add(JSON.parse(line)); rows += 1;
    }
  }
  return { rows, sha256: hash.digest("hex"), files: files.map((file) => relative(process.cwd(), file).replaceAll("\\", "/")) };
}

function writeStreamed(path, write) {
  return new Promise((resolvePromise, reject) => {
    const stream = createWriteStream(path, { encoding: "utf8" });
    stream.on("error", reject); stream.on("finish", resolvePromise);
    write((chunk) => stream.write(chunk));
    stream.end();
  });
}

async function main() {
  const source = argument("--source");
  const runId = argument("--run-id");
  if (!source || !runId) throw new Error("Usage: node slots/build-ah-physical-slots.mjs --source <slots.json | slots.jsonl | parts dir> --run-id <run-id> [--specialty <id>]");

  const specialty = specialtyFromArgv();
  const sourcePath = resolve(source);
  const runPath = join(process.cwd(), specialtyPaths(specialty).runs, runId, "ah");
  if (!existsSync(sourcePath)) throw new Error(`Source does not exist: ${sourcePath}`);
  if (existsSync(runPath)) throw new Error(`Run path already exists: ${runPath}`);

  const accumulator = createAccumulator();
  const read = await readSource(sourcePath, accumulator);
  const physicalSlots = accumulator.finish();
  const outputJson = join(runPath, `ah-${specialty.id}-physical-slots.json`);
  const outputCsv = join(runPath, `ah-${specialty.id}-physical-slots.csv`);
  const headers = [
    "physical_slot_id", ...PHYSICAL_FIELDS, "appointment_types", "appointment_type_count", "duration_minutes", "booking_options_json",
  ];

  mkdirSync(dirname(runPath), { recursive: true });
  mkdirSync(runPath, { recursive: false });
  const streamed = statSync(sourcePath).isDirectory() || sourcePath.endsWith(".jsonl");
  if (!streamed) copyFileSync(sourcePath, join(runPath, "source-ah-slots.json"));
  await writeStreamed(outputJson, (write) => {
    write("[\n");
    physicalSlots.forEach((slot, index) => write(`${index ? ",\n" : ""}${JSON.stringify(slot)}`));
    write("\n]\n");
  });
  await writeStreamed(outputCsv, (write) => {
    write(`${headers.join(",")}\n`);
    for (const slot of physicalSlots) write(`${headers.map((header) => csvValue(slot[header])).join(",")}\n`);
  });
  writeFileSync(join(runPath, "manifest.json"), `${JSON.stringify({
    status: "imported",
    source: { originalPath: relative(process.cwd(), sourcePath).replaceAll("\\", "/"), files: read.files, sha256: read.sha256, rows: read.rows, streamed },
    physicalSlots: physicalSlots.length,
    overlapRowsCollapsed: read.rows - physicalSlots.length,
    outputs: [...(streamed ? [] : ["source-ah-slots.json"]), `ah-${specialty.id}-physical-slots.json`, `ah-${specialty.id}-physical-slots.csv`],
    importedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`Imported ${read.rows.toLocaleString()} AH rows into ${physicalSlots.length.toLocaleString()} physical slots.`);
  console.log(`Wrote ${outputCsv}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error); process.exit(1); });
