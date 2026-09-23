// The Provider Index rosters: rebuilding people from the roster files, grouping a specialty's labels,
// the scope rules, MyChart-only additions and person matching, and the roster data check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADULT_CARDIOLOGY, buildProviderIndex, CARDIOLOGY_GROUP, peopleFromRoster, regroupSpecialties, schedulingClinicians } from "../rosters/people.js";
import { CARDIOLOGY_CHECK, providerDataChecks } from "../pages/shared/dataset-facts.js";
import { COPY, specialtyOf } from "../pages/shared/specialties.js";
import { canonicalSpecialty } from "../rosters/labels.js";

// ---- provider-index-people ----
const office = (n, a, c, z) => ({ n, a, c, z });
const rosterAll = {
  "32804": [{ i: "1000000001", n: "Manjunath Raju", s: "Cardiology", y: "ah", cr: "MD", ph: "p.jpg", u: "u", l: [office("Innovation Tower", "265 E Rollins St", "Orlando", "32804")] }],
  "32819": [{ i: "1000000001", n: "Manjunath Raju", s: "Cardiology", y: "ah", cr: "MD", ph: "p.jpg", u: "u", l: [office("Dr. Phillips", "7940 Via Dellagio Way", "Orlando", "32819")] }],
  "34972": [{ i: "1000000002", n: "Robert B. Boswell", s: "Cardiology - Interventional", y: "oh", cr: "MD", l: [office("HVI Okeechobee", "1006 N Parrot Ave", "Okeechobee", "34972")] }],
  "32806": [{ i: "1000000003", n: "Joel A. Garcia-Fernandez", s: "Cardiology - Interventional", y: "oh", cr: "MD", l: [office("HVI", "1222 S Orange Ave", "Orlando", "32806")] },
            { i: "1000000004", n: "Pediatric Person", s: "Pediatric Cardiology", y: "oh", cr: "MD", l: [office("Kids", "1 Kid St", "Orlando", "32806")] }],
};
const rosterPrimary = { "32819": [{ i: "1000000001", n: "Manjunath Raju", s: "Cardiology", y: "ah", cr: "MD", l: [office("Dr. Phillips", "7940 Via Dellagio Way", "Orlando", "32819")] }] };
const zipCounty = { "32804": "Orange", "32819": "Orange", "34972": "Okeechobee", "32806": "Orange", "32827": "Orange" };
const slotModel = {
  providers: [{ n: "Manjunath Raju, MD, FACC", y: "ah", c: "Physician" }, { n: "Joel Garcia, MD", y: "oh", c: "Physician" }, { n: "Mayra McKoy, APRN", y: "ah", c: "Nurse Practitioner" }, { n: "George Abreut, DO", y: "ah", c: "Physician" }, { n: "A Resource", y: "ah", c: "Resource" }],
  facilities: [{ n: "AH Cardiology at Lake Nona", a: "9975 Tavistock Lakes Blvd", c: "Orlando", z: "32827", ct: "Orange" }, { n: "AH Cardiology at Innovation Tower", a: "265 E Rollins St", c: "Orlando", z: "32804", ct: "Orange" }],
  slots: [{ p: 2, f: 0 }, { p: 2, f: 0 }, { p: 3, f: 1 }, { p: 3, f: 1 }, { p: 3, f: 0 }, { p: 0, f: 1 }, { p: 1, f: 1 }],
};

test("people are rebuilt from the rosters with every office and the primary one flagged", () => {
  const people = peopleFromRoster(rosterAll, rosterPrimary);
  const raju = people.find((p) => p.npi === "1000000001");
  assert.equal(people.length, 4);
  assert.deepEqual(raju.locations.map((l) => [l.zip, l.primary]), [["32804", false], ["32819", true]]);
  assert.equal(raju.photo, "p.jpg");
  assert.equal(people.find((p) => p.npi === "1000000002").locations[0].primary, true, "first office is primary when the primary roster has no entry");
});

test("adult cardiology labels regroup under Cardiology and keep their label", () => {
  const people = regroupSpecialties(peopleFromRoster(rosterAll, rosterPrimary));
  const boswell = people.find((p) => p.npi === "1000000002"), kids = people.find((p) => p.npi === "1000000004");
  assert.equal(boswell.specialty, "Cardiology"); assert.equal(boswell.label, "Cardiology - Interventional");
  assert.equal(kids.specialty, "Pediatric Cardiology"); assert.equal(kids.label, undefined);
  assert.equal(ADULT_CARDIOLOGY.has("Cardiothoracic Surgery"), false);
});

test("MyChart-only clinicians are added at their clinics, busiest clinic primary, name variants skipped", () => {
  const people = regroupSpecialties(peopleFromRoster(rosterAll, rosterPrimary));
  const added = schedulingClinicians(people, slotModel, zipCounty);
  assert.deepEqual(added.map((p) => p.name), ["Mayra McKoy", "George Abreut"], "Raju and Garcia-Fernandez match by name; resources are ignored");
  const abreut = added[1];
  assert.equal(abreut.cred, "DO"); assert.equal(abreut.src, "mychart"); assert.equal(abreut.specialty, "Cardiology");
  assert.deepEqual(abreut.locations.map((l) => [l.zip, l.primary]), [["32804", true], ["32827", false]]);
  assert.equal(added[0].cred, "APRN");
});

test("the rebuilt index counts adult cardiology together and reconciles by construction", () => {
  const index = buildProviderIndex({ rosterAll, rosterPrimary, slotModel, zipCounty, generatedAt: "2026-08-31T19:22:44.469Z" });
  const cardiology = index.all.byZip.specialties.find((s) => s.name === "Cardiology");
  assert.deepEqual(index.added, { ah: 2, oh: 0 });
  assert.deepEqual([cardiology.ah, cardiology.oh, cardiology.ahLocations, cardiology.ohLocations], [3, 2, 5, 2]);
  assert.deepEqual(index.all.byZip.zips["34972"], { ah: 0, oh: 1, spec: { Cardiology: { a: 0, o: 1 }, "Cardiology - Interventional": { a: 0, o: 1 } } }, "Okeechobee shows the interventional cardiologist under the group and under her own label");
  assert.equal(index.all.byZip.zips["32806"].spec["Pediatric Cardiology"].o, 1, "pediatric cardiology keeps its own label");
  assert.deepEqual(index.all.byZip.totals, { ah: 3, oh: 3, note: index.all.byZip.totals.note });
  assert.equal(index.all.byZip.generatedAt, "2026-08-31T19:22:44.469Z");
  const lakeNona = index.all.rosterZip["32827"];
  assert.deepEqual(lakeNona.map((e) => [e.n, e.src, e.cr]), [["George Abreut", "mychart", "DO"], ["Mayra McKoy", "mychart", "APRN"]]);
  const okee = index.all.rosterZip["34972"][0];
  assert.equal(okee.s, "Cardiology"); assert.equal(okee.sl, "Cardiology - Interventional");
  assert.equal(index.primary.byZip.zips["32827"].ah, 1, "primary mode places Abreut at his busiest clinic only");
  assert.equal(index.primary.byZip.zips["32804"].ah, 1, "Abreut primary in 32804, Raju primary in 32819");
  assert.equal(index.primary.byZip.totals.ah, 3);
  assert.equal(Object.values(index.all.byZip.zips).reduce((sum, z) => sum + z.ah + z.oh, 0), 8, "footprint counts each person once per ZIP");
});

test("a scheduling clinician whose first name the directory spells differently is the same person, a namesake at the same clinic is not", () => {
  const dir = (npi, n, s, y, cr, offices) => ({ i: npi, n, s, y, cr, l: offices });
  const roster = {
    "32792": [dir("1000000010", "Ram Yakkanti", "Orthopedic Surgery", "ah", "MD", [office("Winter Park", "255 N Lakemont Ave, Suite 207", "Winter Park", "32792")])],
    "32789": [dir("1000000011", "M. Pierce Ebaugh", "Orthopedic Surgery", "oh", "DO", [office("Jewett", "1285 N. Orange Ave.", "Winter Park", "32789")])],
    "32117": [dir("1000000012", "Katie Pate", "Orthopedic Surgery", "ah", "MPAS, PA-C", [office("Daytona", "305 Memorial Medical Parkway, Suite 301", "Daytona Beach", "32117")])],
    "34715": [dir("1000000013", "John Nwosu", "Cardiology", "ah", "MD", [office("Clermont", "1804 Oakley Seaver Dr", "Clermont", "34715"), office("Minneola", "2071 N Hancock Rd", "Minneola", "34711")])],
    "32819": [dir("1000000014", "Rushik Bhuva", "Cardiology", "oh", "MD", [office("HVI", "7236 Stonerock Cir.", "Orlando", "32819")]),
              dir("1000000015", "Sagar Patel", "Cardiology", "ah", "MD", [office("Medical Park", "3000 Medical Park Drive, Suite 300", "Tampa", "33613")]),
              dir("1000000016", "Mehul Patel", "Cardiology", "ah", "MD", [office("Medical Park", "3000 Medical Park Drive, Suite 300", "Tampa", "33613")])],
  };
  const group = { group: "Cardiology", members: ["Cardiology", "Orthopedic Surgery"], weak: [], exclude: [], excludeCredentials: [] };
  const people = regroupSpecialties(peopleFromRoster(roster), group);
  const facilities = [
    { n: "Rothman Winter Park", a: "255 North Lakemont, Suite 207, Winter Park FL 32792-3229", c: "Winter Park", z: "32792" },
    { n: "Jewett Winter Park", a: "1285 Orange Ave, Winter Park FL 32789-4984", c: "Winter Park", z: "32789" },
    { n: "Daytona", a: "305 Memorial Medical Parkway, Suite 301, Daytona Beach FL 32117-5169", c: "Daytona Beach", z: "32117" },
    { n: "Clermont", a: "1804 Oakley Seaver Dr, Clermont FL 34715", c: "Clermont", z: "34715" },
    { n: "HVI Dr Phillips", a: "7236 Stonerock Cir, Orlando FL 32819-8000", c: "Orlando", z: "32819" },
    { n: "Medical Park", a: "3000 Medical Park Drive, Suite 300, Tampa FL 33613", c: "Tampa", z: "33613" },
  ];
  const providers = [
    { i: "WP-1", n: "Ramakanth Yakkanti, MD", y: "ah", c: "Physician" },       // first-name prefix
    { i: "WP-2", n: "Michael Ebaugh, DO", y: "oh", c: "Physician" },           // initial at a shared office
    { i: "WP-3", n: "Katherine Pate, PA-C", y: "ah", c: "Physician Assistant" }, // prefix "kat" + shared office
    { i: "WP-4", n: "Chukwunweike Nwosu, MD", y: "ah", c: "Physician" },       // unique surname at a shared office
    { i: "WP-5", n: "Rushikkumar Bhuva, MD", y: "oh", c: "Physician" },        // prefix
    { i: "WP-6", n: "Hemal Patel, MD", y: "ah", c: "Physician" },              // a namesake at the same clinic: a different person
    { i: "WP-7", n: "Rushik Bhuva, APRN", y: "oh", c: "Nurse Practitioner" },   // same name, other credential class: a different person
  ];
  const slotModel = { providers, facilities, providerFacilities: [[0, 0, 5], [1, 1, 5], [2, 2, 5], [3, 3, 5], [4, 4, 5], [5, 5, 5], [6, 4, 5]] };
  const zipCounty = { "32792": "Orange", "32789": "Orange", "32117": "Volusia", "34711": "Lake", "34715": "Lake", "32819": "Orange", "33613": "Hillsborough" };
  const added = schedulingClinicians(people, slotModel, zipCounty, group);
  assert.deepEqual(added.map((p) => p.name), ["Hemal Patel", "Rushik Bhuva"], "only the namesake and the other-credential clinician are new people");
  assert.deepEqual(added.elsewhere, []);
});

test("scheduling clinicians listed in a directory under another specialty are reported, not added; excluded credentials are reported", () => {
  const roster = { "32801": [{ i: "1000000020", n: "Murali K Iyyani", s: "Internal Medicine", y: "oh", cr: "MD", l: [office("Underwood", "52 Underwood St", "Orlando", "32801")] }] };
  const group = { group: "Orthopedics", members: ["Orthopedics", "Orthopedic Surgery"], weak: [], exclude: [], excludeCredentials: ["DPM"] };
  const people = regroupSpecialties(peopleFromRoster(roster), group);
  const slotModel = { providers: [{ i: "WP-1", n: "Murali Iyyani, MD", y: "oh", c: "Physician" }, { i: "WP-2", n: "Foot Person, DPM", y: "ah", c: "Physician" }],
    facilities: [{ n: "Underwood", a: "52 Underwood St, Orlando FL 32801", c: "Orlando", z: "32801" }], providerFacilities: [[0, 0, 3], [1, 0, 3]] };
  const added = schedulingClinicians(people, slotModel, { "32801": "Orange" }, group);
  assert.deepEqual(added, []);
  assert.deepEqual(added.elsewhere.map((p) => [p.name, p.label]), [["Murali Iyyani", "Internal Medicine"]]);
  assert.deepEqual(added.excluded.map((p) => [p.name, p.cred]), [["Foot Person", "DPM"]]);
  assert.deepEqual(added.gaps, { ah: 0, oh: 0 });
});

// ---- specialty-roster ----
const ortho = specialtyOf("orthopedics").roster;
const person = (name, specialty, sys = "oh") => ({ sys, npi: name.length + "000000000", name, cred: "MD", specialty, photo: "", profile: "", locations: [{ name: "Clinic", addr: "1 Main St", city: "Orlando", zip: "32801", primary: true }] });

test("orthopedic sub-specialties count under Orthopedics and keep their label; pediatrics and podiatry stay apart", () => {
  const people = regroupSpecialties([person("A", "Orthopedic Surgery - Spine"), person("B", "Orthopedics"), person("C", "Pediatric Orthopedics"), person("D", "Podiatry"), person("E", "Orthopedics - Sports Medicine", "ah")], ortho);
  assert.deepEqual(people.map((p) => [p.specialty, p.label ?? ""]), [["Orthopedics", "Orthopedic Surgery - Spine"], ["Orthopedics", "Orthopedics - General"], ["Pediatric Orthopedics", ""], ["Podiatry", ""], ["Orthopedics", "Orthopedics - Sports Medicine"]]);
  assert.equal(CARDIOLOGY_GROUP.group, "Cardiology");
  assert.deepEqual(regroupSpecialties([person("F", "Cardiology - Interventional")]).map((p) => p.specialty), ["Cardiology"], "cardiology stays the default");
});

test("gastroenterology sub-specialties count under the GI group; pediatric GI, colorectal surgery and GI cancer stay apart", () => {
  const gi = specialtyOf("gastroenterology").roster;
  // AdventHealth's plain "Gastroenterology" and "Hepatology" are Orlando Health's "(GI)" and "(Liver)" labels
  assert.equal(canonicalSpecialty("Gastroenterology"), gi.group);
  assert.equal(canonicalSpecialty("Hepatology"), "Hepatology (Liver)");
  const people = regroupSpecialties([person("A", "Gastroenterology (GI)"), person("B", "Hepatology (Liver)", "ah"), person("C", "Advanced Endoscopy"), person("D", "Pediatric Gastroenterology (GI)"), person("E", "Colon and Rectal Surgery", "ah"), person("F", "Cancer - GI (Gastrointestinal)")], gi);
  assert.deepEqual(people.map((p) => [p.specialty, p.label ?? ""]), [["Gastroenterology (GI)", "Gastroenterology (GI) - General"], ["Gastroenterology (GI)", "Hepatology (Liver)"], ["Gastroenterology (GI)", "Advanced Endoscopy"], ["Pediatric Gastroenterology (GI)", ""], ["Colon and Rectal Surgery", ""], ["Cancer - GI (Gastrointestinal)", ""]]);
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
