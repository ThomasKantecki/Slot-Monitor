// The Provider Index provider list, including clinicians known only from the scheduling data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADULT_CARDIOLOGY, buildProviderIndex, peopleFromRoster, regroupSpecialties, schedulingClinicians } from "../rosters/people.js";

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
