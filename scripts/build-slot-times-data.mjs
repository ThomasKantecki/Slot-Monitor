// Build step: reads data/<specialty>/current and writes the slot model (data/<specialty>/current/slot-times-model.json, local only)
// that the page builds and the partition writer use. If the export is missing it keeps the model already on disk.
// One specialty per run (`--specialty <id>`, cardiology when absent).
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { buildSlotAvailability } from "../src/slot-times/data.js";
import { specialtyFromArgv, specialtyPaths } from "../src/shared/specialties.js";

const SPECIALTY = specialtyFromArgv();
const PATHS = specialtyPaths(SPECIALTY);

// one row per line (see build-specialty-current.mjs); read line by line when the file is large
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
// The physical-slot file is a refresh artifact too large for git; a checkout without it keeps the committed model.
if (!existsSync(PATHS.export)) {
  if (existsSync(PATHS.model)) { console.log(`${SPECIALTY.id}-physical-slots.json is not present; keeping the local slot-times-model.json`); process.exit(0); }
  if (existsSync(PATHS.summary)) { console.log("no slot export or model here; the pages build from the published summary and date partitions"); process.exit(0); }
  throw new Error(`no ${SPECIALTY.id}-physical-slots.json, no slot-times-model.json and no published partitions: run the ${SPECIALTY.id} refresh first`);
}
const rows = readJsonRows(PATHS.export);
const zipCounty = JSON.parse(readFileSync("data/zip-county.json", "utf8"));
const manifest = JSON.parse(readFileSync(PATHS.manifest, "utf8"));
const model = buildSlotAvailability(rows, zipCounty);
model.generatedAt = manifest.generatedAt;
model.status = manifest.status;
model.scope = manifest.scope;
model.sources = { ah: manifest.ah, oh: manifest.oh };
if (model.slots.length !== manifest.totalPhysicalSlots) {
  throw new Error(`slot model mismatch: ${model.slots.length} vs manifest ${manifest.totalPhysicalSlots}`);
}
writeFileSync(PATHS.model, `${JSON.stringify(model)}\n`);
console.log(`wrote slot-times-model.json — ${model.slots.length.toLocaleString()} slots, ${model.providers.length.toLocaleString()} providers, ${model.facilities.length.toLocaleString()} facilities`);
