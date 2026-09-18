// Build step: reads data/cardiology/current and writes the slot model (data/cardiology/current/slot-times-model.json, local only)
// that the page builds and the partition writer use. If the export is missing it keeps the model already on disk.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { buildSlotAvailability } from "../src/slot-times/data.js";

// one row per line (see build-cardiology-current.mjs); read line by line when the file is large
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
if (!existsSync("data/cardiology/current/cardiology-physical-slots.json")) {
  if (existsSync("data/cardiology/current/slot-times-model.json")) { console.log("cardiology-physical-slots.json is not present; keeping the local slot-times-model.json"); process.exit(0); }
  if (existsSync("public/data/cardiology/slot-times-summary.json")) { console.log("no slot export or model here; the pages build from the published summary and date partitions"); process.exit(0); }
  throw new Error("no cardiology-physical-slots.json, no slot-times-model.json and no published partitions: run the cardiology refresh first");
}
const rows = readJsonRows("data/cardiology/current/cardiology-physical-slots.json");
const zipCounty = JSON.parse(readFileSync("data/zip-county.json", "utf8"));
const manifest = JSON.parse(readFileSync("data/cardiology/current/manifest.json", "utf8"));
const model = buildSlotAvailability(rows, zipCounty);
model.generatedAt = manifest.generatedAt;
model.status = manifest.status;
model.scope = manifest.scope;
model.sources = { ah: manifest.ah, oh: manifest.oh };
if (model.slots.length !== manifest.totalPhysicalSlots) {
  throw new Error(`slot model mismatch: ${model.slots.length} vs manifest ${manifest.totalPhysicalSlots}`);
}
writeFileSync("data/cardiology/current/slot-times-model.json", `${JSON.stringify(model)}\n`);
console.log(`wrote slot-times-model.json — ${model.slots.length.toLocaleString()} slots, ${model.providers.length.toLocaleString()} providers, ${model.facilities.length.toLocaleString()} facilities`);
