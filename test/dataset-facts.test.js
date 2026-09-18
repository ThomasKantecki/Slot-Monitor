// The "Data check" dialog text on each page must describe the data correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryGaps, nameKeys, opportunityDataChecks, providerDataChecks, slotDataChecks } from "../src/shared/dataset-facts.js";

const model = {
  generatedAt: "2026-09-14T03:14:23.283Z", status: "completed_with_warnings",
  sources: { ah: { runId: "2026-09-13T000000-0400" }, oh: { runId: "2026-09-13T000000-0400" } },
  totals: { ah: 2, oh: 1 }, slots: [{}, {}, {}], areas: { zip: { "32804": { ah: 2, oh: 0 }, "32746": { ah: 0, oh: 1 } } },
  facilities: [{ z: "32804", ct: "Orange" }, { z: "32746", ct: "Seminole" }],
  providers: new Array(3), minDate: "2026-09-14", maxDateBySystem: { ah: "2027-10-11", oh: "2028-02-22" }, commonMaxDate: "2027-10-11", telemedicineSlots: 1,
};
const zipCounty = { "32804": "Orange", "32746": "Seminole" };

test("slot checks pass on a consistent model and name the pull for live freshness", () => {
  const report = slotDataChecks(model, zipCounty);
  assert.equal(report.pulled.at, model.generatedAt);
  assert.match(report.pulled.label, /^Pulled Sep 13, 2026, 11:14 PM$/);
  assert.equal(report.pulled.freshDays, 7);
  assert.deepEqual(report.checks.map((check) => check.ok), [true, true, true, true, true, true]);
  assert.match(report.checks[4].text, /^Video-only slots: 1 AdventHealth, 0 Orlando Health\. Orlando Health publishes no video visits online/);
  assert.match(report.checks[5].text, /^Other clinicians: 0 AdventHealth and 0 Orlando Health slots/);
  assert.match(report.checks[0].text, /Both systems read on Sep 13, 2026\./);
  assert.match(report.checks[1].text, /Totals reconcile: 2 AdventHealth and 1 Orlando Health slots\./);
  assert.match(report.checks[3].text, /Sep 14, 2026 to Oct 11, 2027/);
  assert.equal(opportunityDataChecks(model, zipCounty).checks.length, 7);
  const mixed = { ...model, providers: [{ c: "Physician" }, { c: "Nurse Practitioner" }], slots: [{ y: "ah", p: 0 }, { y: "ah", p: 1 }, { y: "oh", p: 0 }] };
  const last = slotDataChecks(mixed, zipCounty).checks.at(-1);
  assert.equal(last.ok, true, "the mix is information, not a failure");
  assert.match(last.text, /^Other clinicians: 1 AdventHealth and 0 Orlando Health slots/);
});

test("slot checks fail when runs differ, totals drift, or a facility has no map location", () => {
  const broken = { ...model, sources: { ah: { runId: "2026-09-13T000000-0400" }, oh: { runId: "2026-09-12T000000-0400" } }, totals: { ah: 5, oh: 1 }, facilities: [{ z: "99999", ct: "" }] };
  const checks = slotDataChecks(broken, zipCounty).checks;
  assert.deepEqual(checks.slice(0, 3).map((check) => check.ok), [false, false, false]);
  assert.match(checks[0].text, /not from the same day/);
  assert.match(checks[1].text, /do not reconcile/);
  assert.match(checks[2].text, /1 facilities have no map location/);
});

test("provider checks reconcile the roster and report scheduling-catalog gaps", () => {
  const data = { generatedAt: "2026-08-31T19:22:44.469Z", totals: { ah: 2, oh: 1 }, specialties: [{ name: "Cardiology", ah: 1, oh: 1 }] };
  const roster = { "32804": [{ i: "1234567890", n: "A", y: "ah" }, { i: "2234567890", n: "B", y: "ah" }], "32746": [{ i: "3234567890", n: "C", y: "oh" }] };
  const good = providerDataChecks({ data, roster, zipCounty, zipShapes: new Set(["32804", "32746"]), ahCapturedAt: "2026-08-31T16:32:17.304Z", ohCapturedAt: "2026-09-15T04:20:00.000Z", gaps: { ah: 0, oh: 0 } });
  assert.equal(good.pulled.label, "Directories captured Aug 31, 2026 (AdventHealth) and Sep 15, 2026 (Orlando Health)");
  assert.equal(good.pulled.at, "2026-08-31T16:32:17.304Z", "freshness is judged on the older capture");
  assert.equal(good.pulled.freshDays, 30);
  assert.deepEqual(good.checks.map((check) => check.ok), [true, true, true, true, true]);
  const bad = providerDataChecks({ data, roster: { ...roster, "00000": [{ i: "x", n: "D", y: "oh" }] }, zipCounty, zipShapes: new Set(["32804", "32746"]), gaps: { ah: 33, oh: 5 } });
  assert.deepEqual(bad.checks.map((check) => check.ok), [false, false, false, true, false]);
  assert.match(bad.checks[4].text, /33 AdventHealth and 5 Orlando Health clinicians who book Cardiology visits in MyChart are missing from the index/);
  const withAdded = providerDataChecks({ data: { ...data, totals: { ah: 3, oh: 1 } }, roster: { ...roster, "32827": [{ i: "WP-24abc", n: "Mayra McKoy", y: "ah", src: "mychart" }] }, zipCounty: { ...zipCounty, "32827": "Orange" }, zipShapes: new Set(["32804", "32746", "32827"]), gaps: { ah: 0, oh: 0 }, added: { ah: 1, oh: 0 } });
  assert.deepEqual(withAdded.checks.map((check) => check.ok), [true, true, true, true, true]);
  assert.match(withAdded.checks[2].text, /Every directory clinician has an NPI\. The 1 added from MyChart scheduling carry their scheduling ID instead\./);
  assert.match(withAdded.checks[4].text, /1 AdventHealth and 0 Orlando Health clinicians came from the scheduling catalog/);
});

test("directory gaps match slot providers to the roster by first and last name", () => {
  const roster = { "32804": [{ i: "1", n: "Manjunath Raju", y: "ah" }, { i: "2", n: "Ricardo J Villasmil", y: "ah" }], "32806": [{ i: "3", n: "Shivanand Karkal", y: "oh" }, { i: "4", n: "Lucianne Alers Sanchez", y: "oh" }] };
  const slotModel = { providers: [
    { n: "Manjunath Raju, MD, FACC", y: "ah", c: "Physician" }, { n: "Ricardo Villasmil, MD", y: "ah", c: "Physician" },
    { n: "George Abreut, DO", y: "ah", c: "Physician" }, { n: "Mayra McKoy, APRN", y: "ah", c: "Nurse Practitioner" },
    { n: "Shivanand Karkal, MD", y: "oh", c: "Physician" }, { n: "Joel Garcia, MD", y: "oh", c: "Physician" },
    { n: "Lucianne Alers-Sanchez, MD", y: "oh", c: "Physician" }, { n: "Shivanand Karkal Jr, MD", y: "oh", c: "Physician" },
    { n: "Some Resource", y: "ah", c: "Resource" },
  ] };
  assert.deepEqual(directoryGaps(roster, slotModel), { ah: 2, oh: 1 });
  assert.deepEqual(directoryGaps({ "32806": [{ i: "9", n: "Joel A. Garcia-Fernandez", y: "oh" }] }, { providers: [{ n: "Joel Garcia, MD", y: "oh", c: "Physician" }] }), { ah: 0, oh: 0 }, "double surnames match on either part");
  assert.deepEqual(directoryGaps({}, {}), { ah: 0, oh: 0 });
});

test("name keys strip credentials and suffixes and cover double surnames", () => {
  assert.deepEqual(nameKeys("Joel A. Garcia-Fernandez, MD"), ["joel|fernandez", "joel|garcia"]);
  assert.deepEqual(nameKeys("Shivanand Karkal Jr, MD"), ["shivanand|karkal"]);
  assert.deepEqual(nameKeys("Tiji Joseph, APRN,RN"), ["tiji|joseph"]);
  assert.deepEqual(nameKeys(""), []);
});
