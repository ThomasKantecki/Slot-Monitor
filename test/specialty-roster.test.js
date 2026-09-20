// The Provider Index roster group and data check are data-driven: orthopedics behaves like cardiology.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDIOLOGY_GROUP, regroupSpecialties, schedulingClinicians } from "../src/provider-index-people.js";
import { CARDIOLOGY_CHECK, providerDataChecks } from "../src/shared/dataset-facts.js";
import { COPY, specialtyOf } from "../src/shared/specialties.js";

const ortho = specialtyOf("orthopedics").roster;
const person = (name, specialty, sys = "oh") => ({ sys, npi: name.length + "000000000", name, cred: "MD", specialty, photo: "", profile: "", locations: [{ name: "Clinic", addr: "1 Main St", city: "Orlando", zip: "32801", primary: true }] });

test("orthopedic sub-specialties count under Orthopedics and keep their label; pediatrics and podiatry stay apart", () => {
  const people = regroupSpecialties([person("A", "Orthopedic Surgery - Spine"), person("B", "Orthopedics"), person("C", "Pediatric Orthopedics"), person("D", "Podiatry"), person("E", "Orthopedics - Sports Medicine", "ah")], ortho);
  assert.deepEqual(people.map((p) => [p.specialty, p.label ?? ""]), [["Orthopedics", "Orthopedic Surgery - Spine"], ["Orthopedics", ""], ["Pediatric Orthopedics", ""], ["Podiatry", ""], ["Orthopedics", "Orthopedics - Sports Medicine"]]);
  assert.equal(CARDIOLOGY_GROUP.group, "Cardiology");
  assert.deepEqual(regroupSpecialties([person("F", "Cardiology - Interventional")]).map((p) => p.specialty), ["Cardiology"], "cardiology stays the default");
});

test("clinicians who only book in MyChart are stamped with the page's group", () => {
  const slotModel = { providers: [{ i: "1234567890", y: "oh", n: "New Person, MD", c: "Physician" }], facilities: [{ n: "Ortho Clinic", a: "9 Bone Rd", c: "Tampa", z: "33602" }], providerFacilities: [[0, 0, 5]] };
  const added = schedulingClinicians([], slotModel, { 33602: "Hillsborough" }, ortho);
  assert.equal(added.length, 1);
  assert.equal(added[0].specialty, "Orthopedics");
  assert.equal(schedulingClinicians([], slotModel, { 33602: "Hillsborough" })[0].specialty, "Cardiology");
});

test("the provider data check names the page's specialty and its roster note", () => {
  const data = { totals: { ah: 1, oh: 1 }, specialties: [{ name: "Orthopedics", ah: 1, oh: 1 }] };
  const roster = { 32801: [{ i: "1000000000", y: "ah" }, { i: "2000000000", y: "oh" }] };
  const check = providerDataChecks({ data, roster, zipCounty: { 32801: "Orange" }, zipShapes: new Set(["32801"]), gaps: { ah: 0, oh: 0 }, specialty: { group: "Orthopedics", label: "Orthopedics", note: COPY.orthopedics.rosterNote } });
  const texts = check.checks.map((item) => item.text);
  assert.ok(texts.some((text) => text.startsWith("Orthopedics roster: 1 AdventHealth and 1 Orlando Health clinicians, counting orthopedic surgery")), texts.join("\n"));
  assert.ok(texts.some((text) => text === "The directories cover everyone who books Orthopedics visits in MyChart."), texts.join("\n"));
  assert.equal(CARDIOLOGY_CHECK.note, COPY.cardiology.rosterNote, "the default check note is the cardiology copy");
});
