// From the current dataset to the compact slot model: dedup, Florida filter, Eastern day and time, the
// video and new-patient flags, the catalog list, and the three comparison filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSlotAvailability, deduplicatePhysicalSlots, easternDate, isNewPatientType, isTelemedicineSlot, isTelemedicineType } from "../slots/slot-model.js";
import { slotDataChecks } from "../pages/shared/dataset-facts.js";
import { readFileSync } from "node:fs";
import { FILTER_DEFAULTS, isComparableSlot, isNewPatientSlot, isPhysicianSlot, isTelemedicineOnlySlot, visitTypesOf } from "../slots/slot-rules.js";

// ---- slot-times-data ----
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

test("a slot's day is its Eastern calendar day, not the date of its UTC instant", () => {
  assert.equal(easternDate("2026-11-11T00:00:00Z"), "2026-11-10"); // 7:00 PM EST on November 10
  assert.equal(easternDate("2026-07-02T02:30:00Z"), "2026-07-01"); // 10:30 PM EDT on July 1
  assert.equal(easternDate("2026-09-03T12:00:00Z"), "2026-09-03");
  const model = buildSlotAvailability([{ ...base, booking_categories: "New Patient", display_datetime_utc: "2026-11-11T00:00:00Z", appointment_time: "7:00 PM" }], { "32804": "Orange" });
  assert.equal(model.slots[0].d, "2026-11-10");
  assert.equal(model.slots[0].t, "7:00 PM");
  assert.equal(model.minDate, "2026-11-10");
});

test("the catalog list names every registry entry, with zero for an entry that published nothing, and attributes an older export to its single entry", () => {
  const rows = [{ ...base, specialty: "Orthopaedic Surgery", booking_categories: "New Patient" }, { ...base, system: "OH", provider_id: "p2", facility_id: "f2", booking_categories: "" }];
  const model = buildSlotAvailability(rows, { "32804": "Orange" }, { catalogNames: { ah: ["Orthopaedic Surgery", "Sports Medicine"], oh: ["Orthopedics and Sports Medicine"] } });
  assert.deepEqual(model.catalog, { ah: ["Orthopaedic Surgery", "Sports Medicine"], oh: ["Orthopedics and Sports Medicine"] });
  assert.deepEqual(model.catalogSlots, { ah: { "Orthopaedic Surgery": 1, "Sports Medicine": 0 }, oh: { "Orthopedics and Sports Medicine": 1 } });
});

// ---- specialty-slots ----
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

// ---- slot-rules ----
test("video-only slots are recognised from whichever field carries the visit types", () => {
  assert.deepEqual(visitTypesOf({ appointment_types: "New Patient | Specialists Office Visit" }), ["New Patient", "Specialists Office Visit"]);
  assert.deepEqual(visitTypesOf({ matching_visit_types: "Orlando Health New Cardiology Patient" }), ["Orlando Health New Cardiology Patient"]);
  assert.equal(isTelemedicineOnlySlot({ appointment_types: "New patient telemedicine visit | Patient Telemedicine Visit" }), true);
  assert.equal(isTelemedicineOnlySlot({ appointment_types: "New Patient | Telemedicine Established" }), false, "bookable in person too");
  assert.equal(isTelemedicineOnlySlot({ matching_visit_types: "Orlando Health New Cardiology Patient" }), false);
  assert.equal(isTelemedicineOnlySlot({}), false);
  assert.equal(isComparableSlot({ provider_credentials: "Physician", appointment_types: "New Patient" }), true);
  assert.equal(isComparableSlot({ provider_credentials: "Physician", appointment_types: "Patient Telemedicine Visit" }), false);
  assert.equal(isComparableSlot({ provider_credentials: "Nurse Practitioner", appointment_types: "New Patient" }), false);
});

test("only physician schedules count as appointment slots", () => {
  assert.equal(isPhysicianSlot({ provider_credentials: "Physician" }), true);
  assert.equal(isPhysicianSlot({ provider_credentials: " Physician " }), true);
  for (const credential of ["Nurse Practitioner", "Physician Assistant", "Resource", "Pharmacist", "Referring Provider", "", undefined]) {
    assert.equal(isPhysicianSlot({ provider_credentials: credential }), false, String(credential));
  }
  assert.equal(isPhysicianSlot(undefined), false);
});

test("new-patient slots are recognised from the visit types", () => {
  assert.equal(isNewPatientSlot({ appointment_types: "New Patient | Specialists Office Visit" }), true);
  assert.equal(isNewPatientSlot({ appointment_types: "Specialists Office Visit" }), false);
  assert.equal(isNewPatientSlot({ matching_visit_types: "Florida Medical Clinic Orlando Health New Cardiology Patient" }), true);
  assert.deepEqual(FILTER_DEFAULTS, { physiciansOnly: false, inPersonOnly: false, newPatientOnly: false });
});

test("the current-snapshot builder keeps every published slot and records the mix the filters act on", () => {
  const src = readFileSync(new URL("../slots/build-specialty-current.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ isNewPatientSlot, isPhysicianSlot, isTelemedicineOnlySlot \} from "\.\/slot-rules\.js"/);
  assert.doesNotMatch(src, /\.filter\(isPhysicianSlot\)\s*\n?\s*\.map/, "rows are not dropped by credential");
  assert.match(src, /const ah = ahFlorida\s*\n\s*\.map/);
  assert.match(src, /const oh = ohFlorida\s*\n\s*\.map/);
  for (const key of ["nonPhysicianSlots", "telemedicineOnlySlots", "newPatientSlots"]) assert.match(src, new RegExp(key));
  assert.match(src, /all published slots are kept/);
});
