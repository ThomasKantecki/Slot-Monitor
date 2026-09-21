// The Provider Index roster group and data check are data-driven: orthopedics behaves like cardiology.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDIOLOGY_GROUP, regroupSpecialties, schedulingClinicians } from "../rosters/people.js";
import { CARDIOLOGY_CHECK, providerDataChecks } from "../pages/shared/dataset-facts.js";
import { COPY, specialtyOf } from "../pages/shared/specialties.js";

const ortho = specialtyOf("orthopedics").roster;
const person = (name, specialty, sys = "oh") => ({ sys, npi: name.length + "000000000", name, cred: "MD", specialty, photo: "", profile: "", locations: [{ name: "Clinic", addr: "1 Main St", city: "Orlando", zip: "32801", primary: true }] });

test("orthopedic sub-specialties count under Orthopedics and keep their label; pediatrics and podiatry stay apart", () => {
  const people = regroupSpecialties([person("A", "Orthopedic Surgery - Spine"), person("B", "Orthopedics"), person("C", "Pediatric Orthopedics"), person("D", "Podiatry"), person("E", "Orthopedics - Sports Medicine", "ah")], ortho);
  assert.deepEqual(people.map((p) => [p.specialty, p.label ?? ""]), [["Orthopedics", "Orthopedic Surgery - Spine"], ["Orthopedics", "Orthopedics - General"], ["Pediatric Orthopedics", ""], ["Podiatry", ""], ["Orthopedics", "Orthopedics - Sports Medicine"]]);
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
  const disclosed = providerDataChecks({ data, roster, zipCounty: { 32801: "Orange" }, zipShapes: new Set(["32801"]), gaps: { ah: 0, oh: 0 }, specialty: { group: "Orthopedics", label: "Orthopedics", note: COPY.orthopedics.rosterNote },
    elsewhere: [{ sys: "ah", name: "Pain Person", cred: "MD", label: "Pain Medicine" }, { sys: "ah", name: "Rehab Person", cred: "MD", label: "Physical Medicine and Rehabilitation" }, { sys: "oh", name: "Other Pain", cred: "MD", label: "Pain Medicine" }],
    excluded: [{ sys: "ah", name: "Foot Person", cred: "DPM" }] });
  const last = disclosed.checks.at(-1).text;
  assert.match(last, /3 more who book Orthopedics visits are listed in the directories under other specialties \(Pain Medicine 2, Physical Medicine and Rehabilitation 1\) and are counted there, not here\./);
  assert.match(last, /1 who book Orthopedics visits are outside this roster's scope \(DPM\) and are not counted\./);
  assert.equal(CARDIOLOGY_CHECK.note, COPY.cardiology.rosterNote, "the default check note is the cardiology copy");
});

test("scope rules: podiatrists, neurosurgeons and pain physicians with a spine or foot tag stay out; orthopedic surgeons with those tags stay in", () => {
  const tagged = (name, specialty, labels, cred = "MD") => ({ ...person(name, specialty), cred, labels });
  const people = regroupSpecialties([
    tagged("Neuro", "Neurosurgery", ["Orthopedic Surgery - Spine"]),
    tagged("Pain", "Interventional Spine and Pain Management", ["Orthopedic Surgery - Spine"]),
    tagged("Ortho spine", "Orthopedic Surgery", ["Orthopedic Surgery - Spine"]),
    tagged("Foot DPM", "Orthopedic Surgery - Foot and Ankle", [], "DPM"),
    tagged("Foot DPM ortho", "Orthopedic Surgery", ["Orthopedic Surgery - Foot and Ankle"], "DPM, FACFAS"),
    tagged("Rehab electro", "Physical Medicine and Rehabilitation", ["Orthopedics - Electrodiagnostic Medicine"]),
    tagged("General", "Orthopedics", []),
  ], ortho);
  assert.deepEqual(people.map((p) => [p.name, p.specialty, p.label ?? ""]), [
    ["Neuro", "Neurosurgery", ""], ["Pain", "Interventional Spine and Pain Management", ""], ["Ortho spine", "Orthopedics", "Orthopedic Surgery"],
    ["Foot DPM", "Orthopedic Surgery - Foot and Ankle", ""], ["Foot DPM ortho", "Orthopedic Surgery", ""],
    ["Rehab electro", "Orthopedics", "Orthopedics - Electrodiagnostic Medicine"], ["General", "Orthopedics", "Orthopedics - General"],
  ]);
});
