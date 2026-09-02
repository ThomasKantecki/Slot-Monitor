import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export function combineAhPhysicalSlots(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = physicalKey(row);
    if (!groups.has(key)) groups.set(key, { row, options: new Map() });
    const option = optionOf(row);
    const optionKey = JSON.stringify(option);
    groups.get(key).options.set(optionKey, option);
  }

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

function main() {
  const source = argument("--source");
  const runId = argument("--run-id");
  if (!source || !runId) throw new Error("Usage: node scripts/build-ah-physical-slots.mjs --source <slots.json> --run-id <run-id>");

  const sourcePath = resolve(source);
  const runPath = join(process.cwd(), "data", "cardiology", "runs", runId, "ah");
  if (!existsSync(sourcePath)) throw new Error(`Source does not exist: ${sourcePath}`);
  if (existsSync(runPath)) throw new Error(`Run path already exists: ${runPath}`);

  const sourceRows = JSON.parse(readFileSync(sourcePath, "utf8"));
  const physicalSlots = combineAhPhysicalSlots(sourceRows);
  const outputJson = join(runPath, "ah-cardiology-physical-slots.json");
  const outputCsv = join(runPath, "ah-cardiology-physical-slots.csv");
  const importedRaw = join(runPath, "source-ah-slots.json");
  const headers = [
    "physical_slot_id", ...PHYSICAL_FIELDS, "appointment_types", "appointment_type_count", "duration_minutes", "booking_options_json",
  ];

  mkdirSync(dirname(runPath), { recursive: true });
  mkdirSync(runPath, { recursive: false });
  copyFileSync(sourcePath, importedRaw);
  writeFileSync(outputJson, `${JSON.stringify(physicalSlots, null, 2)}\n`);
  writeFileSync(outputCsv, csv(physicalSlots, headers));
  writeFileSync(join(runPath, "manifest.json"), `${JSON.stringify({
    status: "imported",
    source: { originalPath: relative(process.cwd(), sourcePath).replaceAll("\\", "/"), sha256: sha256(sourcePath), rows: sourceRows.length },
    physicalSlots: physicalSlots.length,
    overlapRowsCollapsed: sourceRows.length - physicalSlots.length,
    outputs: ["source-ah-slots.json", "ah-cardiology-physical-slots.json", "ah-cardiology-physical-slots.csv"],
    importedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`Imported ${sourceRows.length.toLocaleString()} AH rows into ${physicalSlots.length.toLocaleString()} physical slots.`);
  console.log(`Wrote ${outputCsv}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
