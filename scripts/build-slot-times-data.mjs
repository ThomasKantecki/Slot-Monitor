import { readFileSync, writeFileSync } from "node:fs";
import { buildSlotAvailability } from "../src/slot-times/data.js";

const rows = JSON.parse(readFileSync("data/cardiology/current/cardiology-physical-slots.json", "utf8"));
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
