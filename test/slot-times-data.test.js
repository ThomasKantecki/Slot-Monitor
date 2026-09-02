import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlotAvailability, deduplicatePhysicalSlots } from "../src/slot-times/data.js";

const base = {
  system: "AH", provider_id: "p1", provider_name: "Dr One", provider_credentials: "MD",
  facility_id: "f1", facility_name: "Heart Center", address: "1 Main St", city: "Orlando",
  state: "FL", zip: "32804", display_datetime_utc: "2026-09-03T12:00:00Z", appointment_time: "8:00 AM",
};

test("physical slots collapse duplicate AH booking categories without losing the categories", () => {
  const rows = [
    { ...base, booking_categories: "New Patient", reasons: "Check up", duration_minutes: "30" },
    { ...base, booking_categories: "Specialists Office Visit", reasons: "Chest pressure", duration_minutes: "15" },
  ];
  const result = deduplicatePhysicalSlots(rows);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].categories, ["New Patient", "Specialists Office Visit"]);
  assert.deepEqual(result[0].reasons, ["Check up", "Chest pressure"]);
});

test("slot model excludes non-Florida rows and reconciles ZIP/county aggregates", () => {
  const rows = [
    { ...base, booking_categories: "New Patient" },
    { ...base, system: "OH", provider_id: "p2", facility_id: "f2", booking_categories: "" },
    { ...base, state: "GA", provider_id: "p3", display_datetime_utc: "2026-09-04T12:00:00Z" },
  ];
  const model = buildSlotAvailability(rows, { "32804": "Orange" });
  assert.equal(model.slots.length, 2);
  assert.deepEqual(model.totals, { ah: 1, oh: 1 });
  assert.deepEqual(model.areas.zip["32804"], { ah: 1, oh: 1 });
  assert.deepEqual(model.areas.county.Orange, { ah: 1, oh: 1 });
  assert.deepEqual(model.maxDateBySystem, { ah: "2026-09-03", oh: "2026-09-03" });
  assert.equal(model.commonMaxDate, "2026-09-03");
  assert.deepEqual(model.reasons, []);
  assert.deepEqual(model.slots[0].rv, []);
  assert.equal(Object.values(model.areas.zip).reduce((sum, value) => sum + value.ah + value.oh, 0), model.slots.length);
});
