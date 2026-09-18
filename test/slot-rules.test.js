// The three comparison filters (physicians only, in person, new patients) classify slots the same way everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILTER_DEFAULTS, isComparableSlot, isNewPatientSlot, isPhysicianSlot, isTelemedicineOnlySlot, visitTypesOf } from "../src/slot-rules.js";

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
  const src = readFileSync(new URL("../scripts/build-cardiology-current.mjs", import.meta.url), "utf8");
  assert.match(src, /import \{ isNewPatientSlot, isPhysicianSlot, isTelemedicineOnlySlot \} from "\.\.\/src\/slot-rules\.js"/);
  assert.doesNotMatch(src, /\.filter\(isPhysicianSlot\)\s*\n?\s*\.map/, "rows are not dropped by credential");
  assert.match(src, /const ah = ahFlorida\s*\n\s*\.map/);
  assert.match(src, /const oh = ohFlorida\s*\n\s*\.map/);
  for (const key of ["nonPhysicianSlots", "telemedicineOnlySlots", "newPatientSlots"]) assert.match(src, new RegExp(key));
  assert.match(src, /all published slots are kept/);
});
