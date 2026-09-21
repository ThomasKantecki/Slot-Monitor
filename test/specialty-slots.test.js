// The slot pages' sub-specialty axis: the scheduling catalog entry each slot was pulled under.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSlotAvailability } from "../src/slot-times/data.js";
import { slotDataChecks } from "../pages/shared/dataset-facts.js";


const row = (system, specialty, id, time) => ({ system, provider_id: `p${id}`, provider_name: `Doc ${id}, MD`, provider_credentials: "Physician", facility_id: `f${id}`, facility_name: "Clinic", address: "1 Main St", city: "Orlando", state: "FL", zip: "32801", display_datetime_utc: `2026-10-0${time}T13:00:00Z`, appointment_time: "9:00 AM", duration_minutes: "30", booking_categories: "New Patient", specialty });

test("slots carry their catalog entry only where a system has several, and the summary lists them", () => {
  const model = buildSlotAvailability([row("AH", "Orthopaedic Surgery", 1, 1), row("AH", "Hand Surgery", 2, 2), row("AH", "Orthopaedic Surgery", 3, 3), row("OH", "Orthopedics and Sports Medicine", 4, 4)], { 32801: "Orange" });
  assert.deepEqual(model.catalog, { ah: ["Hand Surgery", "Orthopaedic Surgery"], oh: ["Orthopedics and Sports Medicine"] });
  assert.deepEqual(model.catalogSlots, { ah: { "Orthopaedic Surgery": 2, "Hand Surgery": 1 }, oh: { "Orthopedics and Sports Medicine": 1 } });
  assert.ok(model.slots.every((slot) => !("sp" in slot)), "slots carry no per-slot catalog field; the entries count together");
  const checks = slotDataChecks({ ...model, sources: { ah: { runId: "2026-09-20T1" }, oh: { runId: "2026-09-20T1" } } }, { 32801: "Orange" }).checks.map((item) => item.text);
  assert.ok(checks.some((text) => text === "Scheduling catalog entries pulled: AdventHealth Hand Surgery (1), Orthopaedic Surgery (2); Orlando Health Orthopedics and Sports Medicine (1). Their slots count together."), checks.join("\n"));
});

test("a specialty with one catalog entry per system gets no extra check", () => {
  const model = buildSlotAvailability([row("AH", "Cardiology", 1, 1), row("OH", "Cardiology", 2, 2)], { 32801: "Orange" });
  assert.deepEqual(model.catalog, { ah: ["Cardiology"], oh: ["Cardiology"] });
  const checks = slotDataChecks({ ...model, sources: { ah: { runId: "x" }, oh: { runId: "x" } } }).checks.map((item) => item.text);
  assert.ok(!checks.some((text) => text.startsWith("Scheduling catalog entries")));
  const legacy = buildSlotAvailability([{ ...row("AH", "", 1, 1), specialty: undefined }], {});
  assert.deepEqual(legacy.catalog, { ah: [], oh: [] }, "an export without the column leaves the lists empty");
});

