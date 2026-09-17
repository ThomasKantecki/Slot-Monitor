import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlotAvailability, deduplicatePhysicalSlots, isNewPatientType, isTelemedicineSlot, isTelemedicineType } from "../src/slot-times/data.js";

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

test("telemedicine booking categories are recognised by name", () => {
  for (const name of ["New patient telemedicine visit", "Patient Telemedicine Visit", "Telemedicine Established", "Telephone Visit", "Video Visit"]) {
    assert.equal(isTelemedicineType(name), true, name);
  }
  for (const name of ["New Patient", "Specialists Office Visit", "Orlando Health New Cardiology Patient", ""]) {
    assert.equal(isTelemedicineType(name), false, name);
  }
  assert.equal(isTelemedicineSlot(["New patient telemedicine visit", "Patient Telemedicine Visit"]), true);
  assert.equal(isTelemedicineSlot(["New Patient", "Telemedicine Established"]), false, "bookable in person too");
  assert.equal(isTelemedicineSlot([]), false, "no categories is not telemedicine");
});

test("slot model flags only slots that are bookable purely as telemedicine", () => {
  const rows = [
    { ...base, booking_categories: "New patient telemedicine visit | Patient Telemedicine Visit" },
    { ...base, display_datetime_utc: "2026-09-03T13:00:00Z", booking_categories: "New Patient | Telemedicine Established" },
    { ...base, display_datetime_utc: "2026-09-03T14:00:00Z", booking_categories: "New Patient" },
    { ...base, provider_id: "p3", provider_credentials: "Nurse Practitioner", display_datetime_utc: "2026-09-03T15:00:00Z", booking_categories: "Specialists Office Visit" },
    { ...base, system: "OH", provider_id: "p2", provider_credentials: "Physician", facility_id: "f2", booking_categories: "", visit_types: "Orlando Health New Cardiology Patient" },
  ];
  const model = buildSlotAvailability(rows, { "32804": "Orange" });
  assert.deepEqual(model.slots.map((slot) => [slot.y, slot.u.slice(11, 16), Boolean(slot.v), Boolean(slot.np)]), [
    ["ah", "12:00", true, true], ["oh", "12:00", false, true], ["ah", "13:00", false, true], ["ah", "14:00", false, true], ["ah", "15:00", false, false],
  ]);
  assert.equal(model.telemedicineSlots, 1);
  assert.deepEqual(model.totals, { ah: 4, oh: 1 });
  assert.deepEqual(model.newPatientSlots, { ah: 3, oh: 1 });
  assert.deepEqual(model.nonPhysicianSlots, { ah: 4, oh: 0 }, "the fixture's MD credential is not the catalog's 'Physician' label");
});

test("new-patient visit types are recognised on both sides", () => {
  for (const name of ["New Patient", "New patient telemedicine visit", "Orlando Health New Cardiology Patient", "Florida Medical Clinic Orlando Health New Cardiology Patient", "ED Cardiology Follow Up New"]) {
    assert.equal(isNewPatientType(name), true, name);
  }
  for (const name of ["Specialists Office Visit", "Patient Telemedicine Visit", "Telemedicine Established", "Established Cardiology Patient", "Renewed Prescription Visit", ""]) {
    assert.equal(isNewPatientType(name), false, name);
  }
});
