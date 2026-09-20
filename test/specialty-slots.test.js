// The slot pages' sub-specialty axis: the scheduling catalog entry each slot was pulled under.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSlotAvailability } from "../src/slot-times/data.js";
import { slotDataChecks } from "../src/shared/dataset-facts.js";
import { renderSlotTimes } from "../src/slot-times/render.js";

const row = (system, specialty, id, time) => ({ system, provider_id: `p${id}`, provider_name: `Doc ${id}, MD`, provider_credentials: "Physician", facility_id: `f${id}`, facility_name: "Clinic", address: "1 Main St", city: "Orlando", state: "FL", zip: "32801", display_datetime_utc: `2026-10-0${time}T13:00:00Z`, appointment_time: "9:00 AM", duration_minutes: "30", booking_categories: "New Patient", specialty });

test("slots carry their catalog entry only where a system has several, and the summary lists them", () => {
  const model = buildSlotAvailability([row("AH", "Orthopaedic Surgery", 1, 1), row("AH", "Hand Surgery", 2, 2), row("AH", "Orthopaedic Surgery", 3, 3), row("OH", "Orthopedics and Sports Medicine", 4, 4)], { 32801: "Orange" });
  assert.deepEqual(model.catalog, { ah: ["Hand Surgery", "Orthopaedic Surgery"], oh: ["Orthopedics and Sports Medicine"] });
  assert.deepEqual(model.catalogSlots, { ah: { "Orthopaedic Surgery": 2, "Hand Surgery": 1 }, oh: { "Orthopedics and Sports Medicine": 1 } });
  assert.deepEqual(model.slots.map((slot) => [slot.y, slot.sp]), [["ah", 1], ["ah", 0], ["ah", 1], ["oh", undefined]], "sp indexes the system's sorted entries; a single-entry system carries none");
  const checks = slotDataChecks({ ...model, sources: { ah: { runId: "2026-09-20T1" }, oh: { runId: "2026-09-20T1" } } }, { 32801: "Orange" }).checks.map((item) => item.text);
  assert.ok(checks.some((text) => text.startsWith("Scheduling catalog entries pulled: AdventHealth Hand Surgery (1), Orthopaedic Surgery (2); Orlando Health Orthopedics and Sports Medicine (1).")), checks.join("\n"));
});

test("a specialty with one catalog entry per system gets no sub-specialty menu and no extra check", () => {
  const model = buildSlotAvailability([row("AH", "Cardiology", 1, 1), row("OH", "Cardiology", 2, 2)], { 32801: "Orange" });
  assert.deepEqual(model.catalog, { ah: ["Cardiology"], oh: ["Cardiology"] });
  assert.ok(model.slots.every((slot) => slot.sp === undefined));
  const checks = slotDataChecks({ ...model, sources: { ah: { runId: "x" }, oh: { runId: "x" } } }).checks.map((item) => item.text);
  assert.ok(!checks.some((text) => text.startsWith("Scheduling catalog entries")));
  const legacy = buildSlotAvailability([{ ...row("AH", "", 1, 1), specialty: undefined }], {});
  assert.deepEqual(legacy.catalog, { ah: [], oh: [] }, "an export without the column leaves the lists empty");
});

test("the slot page carries a hidden sub-specialty select that the client fills when entries exist", () => {
  const html = renderSlotTimes();
  assert.match(html, /<div class="control-group sub-specialty-group" role="group" aria-label="Sub-specialty" hidden><select id="sub-specialty" class="field sub-specialty" aria-label="Sub-specialty">/);
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  assert.match(client, /catalogKey\(slot\) === state\.subSpecialty/);
  assert.match(client, /\.some\(\(system\) => \(DATA\.catalog\?\.\[system\] \?\? \[\]\)\.length > 1\)/);
  assert.match(client, /state\.subSpecialty = ""; if \(\$\("sub-specialty"\)\)/);
});
