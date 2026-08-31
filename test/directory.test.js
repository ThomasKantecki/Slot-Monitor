import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, specialtyOf, isFlZip, zip5, toRoster, dedupByNpi, NPI_FIXES } from "../src/sources/directory.js";

// Their fullName appends the credential; the panel shows it separately.
test("cleanName strips the credential the directory appends", () => {
  assert.equal(cleanName("Ali S. Abbood, MD", "MD"), "Ali S. Abbood");
  assert.equal(cleanName("Awad Haroon Abass, PA-C", "PA-C"), "Awad Haroon Abass");
  assert.equal(cleanName("Mazen A Abboud, DPM", "DPM"), "Mazen A Abboud");
  assert.equal(cleanName("Jane Roe", ""), "Jane Roe");
});

// Stray whitespace in their data would otherwise split one specialty into two.
test("specialtyOf trims, and falls back to the credential's role", () => {
  assert.equal(specialtyOf({ specialties: [{ name: "Hematology and Oncology " }] }), "Hematology and Oncology");
  assert.equal(specialtyOf({ specialties: [], title: "APRN" }), "Nurse Practitioner");
  assert.equal(specialtyOf({ specialties: [], title: "CRNA" }), "Nurse Anesthetist");
  assert.equal(specialtyOf({ specialties: [], title: "" }), "Not Specified");
});

test("isFlZip accepts Florida ZIPs only", () => {
  for (const z of ["32806", "33701", "34711"]) assert.ok(isFlZip(z), z);
  for (const z of ["28803", "66067", "", null, "3280"]) assert.ok(!isFlZip(z), String(z));
  assert.equal(zip5("33701-4814"), "33701");
});

// The roster is employed clinicians with a Florida practice location; the
// directory also lists people who merely hold privileges, and out-of-state sites.
test("toRoster keeps only employed clinicians with a Florida location", () => {
  const rec = (over) => ({ npi: "1", slug: "a-b-md", fullName: "A B, MD", title: "MD", isEmployed: true,
    specialties: [{ name: "Cardiology" }], locations: [{ zipCode: "32806", city: "Orlando", address1: "1 Main" }], ...over });
  assert.equal(toRoster([rec({})]).length, 1);
  assert.equal(toRoster([rec({ isEmployed: false })]).length, 0, "privileges only");
  assert.equal(toRoster([rec({ locations: [{ zipCode: "66067", city: "Ottawa" }] })]).length, 0, "out of state");
  assert.equal(toRoster([rec({ locations: [] })]).length, 0, "no location");
  const multi = toRoster([rec({ locations: [{ zipCode: "32806", city: "Orlando" }, { zipCode: "66067", city: "Ottawa" }] })]);
  assert.deepEqual(multi[0].locations.map((l) => l.zip), ["32806"], "non-Florida sites dropped");
  const pictured = toRoster([rec({})], { records: [{ slug: "a-b-md", photo: "https://images.example/a.jpg" }] });
  assert.equal(pictured[0].photo, "https://images.example/a.jpg");
  assert.equal(pictured[0].profile, "https://www.orlandohealth.com/physician-finder/a-b-md");
});

// Their published ZIP, city and geocode disagree on ~4% of locations, and the
// genuine errors run in both directions — so no single field can be trusted
// outright. These guard the three rules that resolve it.
test("buildLocationResolver arbitrates between the published ZIP and the geocode", async () => {
  const { buildIndex, buildLocationResolver } = await import("../src/geo.js");
  const square = (zip, x, y) => ({ type: "Feature", properties: { zip },
    geometry: { type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] } });
  const zcta = { features: [square("33618", -82.5, 28.0), square("32750", -81.4, 28.7)] };
  const zipIndex = buildIndex(zcta, "zip");
  const at = (over) => ({ name: "Clinic", addr: "1 Main", city: "Tampa", zip: "33618", lon: -82.4, lat: 28.5, ...over });

  // A minority ZIP at a clinic several doctors share is a typo.
  let resolve = buildLocationResolver({ zipIndex, zctaGeojson: zcta,
    allLocations: [at({}), at({}), at({ zip: "99999" })] });
  assert.equal(resolve(at({ zip: "99999" })).zip, "33618", "clinic consensus wins");

  // A real USPS ZIP with no census polygon would otherwise drop off the map.
  resolve = buildLocationResolver({ zipIndex, zctaGeojson: zcta, allLocations: [at({ zip: "33750", city: "Longwood", lon: -81.2, lat: 28.9 })] });
  assert.equal(resolve(at({ zip: "33750", city: "Longwood", lon: -81.2, lat: 28.9 })).zip, "32750", "falls back to the geocode");

  // Published ZIP far away AND the city matches the geocode: the ZIP is wrong.
  const tampa = at({ zip: "32750" });                    // published a Longwood ZIP, geocode is Tampa
  resolve = buildLocationResolver({ zipIndex, zctaGeojson: zcta, allLocations: [at({}), tampa] });
  assert.equal(resolve(tampa).zip, "33618", "city evidence breaks the tie");

  // Boundary noise must be left alone.
  const near = at({ zip: "32750", city: "Longwood", lon: -81.35, lat: 28.75 });
  resolve = buildLocationResolver({ zipIndex, zctaGeojson: zcta, allLocations: [near] });
  assert.equal(resolve(near).zip, "32750", "a correct nearby ZIP is not second-guessed");
});

// The directory sometimes lists one clinician twice under one NPI (nickname vs
// legal name, different specialty per record). Merge those; but two records
// sharing an NPI with NO name in common means one carries someone else's NPI —
// keep them as separate people rather than silently deleting a clinician.
test("dedupByNpi merges same-person records and refuses to merge different people", () => {
  const row = (over) => ({ npi: "1477916245", name: "Kathy Temperato", specialty: "Interventional Pain",
    updated: "2026-06-11", slug: "kathy", locations: [{ zip: "34639", addr: "1 Main" }], ...over });
  // same surname -> one person; the later record wins, locations union
  const merged = dedupByNpi([
    row({ name: "Yekaterina Temperato", specialty: "Physical Medicine and Rehabilitation", updated: "2026-03-04",
          locations: [{ zip: "34639", addr: "1 Main" }, { zip: "33607", addr: "2 Oak" }] }),
    row({}),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].specialty, "Interventional Pain", "later record wins the specialty");
  assert.deepEqual(merged[0].locations.map((l) => l.zip).sort(), ["33607", "34639"], "locations unioned");
  // unrelated names -> two people, the duplicate NPI is dropped from one
  const kept = dedupByNpi([row({}), row({ name: "Maura Alambert", slug: "maura" })]);
  assert.equal(kept.length, 2, "two people stay two people");
  assert.equal(kept.filter((p) => p.npi).length, 1, "only one keeps the contested NPI");
});

// Verified against NPPES 2026-08-30: the directory publishes a few NPIs that
// are malformed or belong to another clinician. toRoster must apply the fixes.
test("toRoster applies the NPPES-verified NPI corrections", () => {
  assert.ok(NPI_FIXES.size >= 4);
  const rec = { npi: "19829558062", slug: "fran-firestone-pac", fullName: "Fran Firestone, PA-C", title: "PA-C",
    isEmployed: true, specialties: [], locations: [{ zipCode: "32806", city: "Orlando", address1: "1 Main" }] };
  assert.equal(toRoster([rec])[0].npi, "1982958062");
});

// 33 employed clinicians are published only at corporate HQs (Envision in Fort
// Lauderdale, Healogics in Jacksonville) — not practice sites. They stay in the
// roster (the headline counts them) but must not be placed on the map there.
test("toRoster strips administrative HQ addresses but keeps the clinician", () => {
  const rec = { npi: "1", fullName: "A B, MD", title: "MD", isEmployed: true, specialties: [{ name: "Anesthesiology" }],
    locations: [{ name: "Envision Physician Services", zipCode: "33309", city: "Fort Lauderdale", address1: "1525 West Cypress Creek Rd" }] };
  const out = toRoster([rec]);
  assert.equal(out.length, 1, "still counted as an employed clinician");
  assert.deepEqual(out[0].locations, [], "but placed nowhere");
  // a real Broward clinic would NOT be stripped
  const real = { ...rec, locations: [{ name: "Orlando Health Cardiology", zipCode: "33309", city: "Fort Lauderdale", address1: "9 Elm" }] };
  assert.equal(toRoster([real])[0].locations.length, 1);
});

// ---- AdventHealth source (browser-harvested listing) ------------------------
test("toAhRoster keeps employed AdventHealth clinicians and repairs their data errors", async () => {
  const { toAhRoster, isEmployedGroup, isFacilityCard, primarySpecialty, splitNameCred, clinicConsensus, verifiedLocationZip }
    = await import("../src/sources/ah-directory.js");
  // employment is the group-name prefix, catching their spelling variants
  assert.ok(isEmployedGroup("AdventHealth Medical Group Cardiology at Celebration"));
  assert.ok(isEmployedGroup("Adventhealth Primary Care Oviedo") && isEmployedGroup("Advent Health Clinic"));
  assert.ok(!isEmployedGroup("Florida Medical Clinic Orlando Health"), "in-network independents are not employed");
  // facility cards carry organizational NPIs and no credential
  assert.ok(isFacilityCard("AdventHealth Care Pavilion Westchase"));
  assert.ok(!isFacilityCard("Atiya Aamer, MD"));
  // their specialty field concatenates a taxonomy list; first segment aligns with OH names
  assert.equal(primarySpecialty("Cardiology, Cardiovascular Disease"), "Cardiology");
  assert.equal(primarySpecialty(""), "Not Specified");
  assert.deepEqual(splitNameCred("Fernando Melocoton Abanilla, MD"), { name: "Fernando Melocoton Abanilla", cred: "MD" });
  assert.deepEqual(splitNameCred("Shilpa Abraham, DNP, APRN, FNP-C"), { name: "Shilpa Abraham", cred: "DNP, APRN, FNP-C" }, "multi-part credentials all peel off");
  assert.deepEqual(splitNameCred("Gus Agocha, MD, PhD"), { name: "Gus Agocha", cred: "MD, PhD" });

  const rec = (over) => ({ npi: "1234567890", name: "A B, MD", spec: "Cardiology", state: "FL",
    locName: "AdventHealth Medical Group Cardiology at X", street: "1 Main", city: "Orlando", zip: "32801", ...over });
  // FL-labeled rows with out-of-state ZIPs (their Kansas rows) are dropped
  assert.equal(toAhRoster({ records: [rec({ zip: "66211" })] }).length, 0);
  // page-boundary duplicates collapse to one clinician
  assert.equal(toAhRoster({ records: [rec({}), rec({})] }).length, 1);
  // clinic+city consensus: a lone ZIP against >=3 same-clinic same-city colleagues is a typo…
  const cohort = [rec({ npi: "1" }), rec({ npi: "2" }), rec({ npi: "3" }), rec({ npi: "4", zip: "32870" })];
  assert.equal(clinicConsensus(cohort)(cohort[3]), "32801");
  // …but a different city is a different office, even under one chain name
  const chain = [rec({ city: "Tampa", zip: "33607" }), rec({ city: "Tampa", zip: "33607" }),
                 rec({ city: "Tampa", zip: "33607" }), rec({ npi: "9", city: "Sebring", zip: "33870" })];
  assert.equal(clinicConsensus(chain)(chain[3]), "33870", "Sebring office keeps its ZIP");
  // truncated ZIPs adopt the clinic's
  assert.equal(clinicConsensus(cohort)({ ...rec({}), zip: "3280" }), "32801");
  // two published Celebration rows carry a valid-looking but incorrect Panhandle ZIP
  const celebration = rec({ city: "Celebration", street: "380 Celebration Place, 2nd Floor", zip: "32474" });
  assert.equal(verifiedLocationZip(celebration), "34747");
  assert.equal(clinicConsensus([celebration])(celebration), "34747");

  const rich = toAhRoster({ scope: "adventhealth-medical-group", fetchedAt: "2026-08-31", records: [{
    npi: "1234567890", name: "Ada Example, MD", spec: "Cardiology",
    photo: "https://images.example/ada.jpg", profile: "https://www.adventhealth.com/doctors/ada-example-1234567890",
    locations: [
      { locName: "AH Orlando", street: "1 Main", city: "Orlando", state: "FL", zip: "32801", primary: true },
      { locName: "AH Tampa", street: "2 Bay", city: "Tampa", state: "FL", zip: "33607", primary: false },
    ],
  }] });
  assert.equal(rich.length, 1);
  assert.equal(rich[0].locations.length, 2, "all published locations are retained");
  assert.equal(rich[0].photo, "https://images.example/ada.jpg");
});

test("aggregate counts the two systems independently", async () => {
  const { aggregate } = await import("../src/aggregate.js");
  const p = (sys, npi, zip) => ({ npi, name: "P" + npi, cred: "MD", specialty: "Cardiology",
    locations: [{ zip, city: "X", addr: "1 Main" }] });
  const out = aggregate({ rosters: { oh: [p("oh", "1", "32806")], ah: [p("ah", "2", "32806"), p("ah", "3", "33607")] },
    zipCounty: { "32806": "Orange", "33607": "Hillsborough" }, source: "t" });
  assert.deepEqual({ ah: out.byZip.totals.ah, oh: out.byZip.totals.oh }, { ah: 2, oh: 1 });
  assert.deepEqual(out.byZip.zips["32806"].spec.Cardiology, { a: 1, o: 1 });
  assert.equal(out.byCounty.zips.Hillsborough.ah, 1);
  assert.equal(out.rosterZip["32806"].length, 2);
});

test("aggregate places one distinct provider in every work area and groups their offices", async () => {
  const { aggregate } = await import("../src/aggregate.js");
  const clinician = { npi: "1234567890", name: "Ada Example", cred: "MD", specialty: "Cardiology",
    photo: "https://images.example/ada.jpg", profile: "https://example.test/ada", locations: [
      { name: "Downtown", zip: "32801", city: "Orlando", addr: "1 Main" },
      { name: "Lake Nona", zip: "32801", city: "Orlando", addr: "2 Lake" },
      { name: "Tampa", zip: "33607", city: "Tampa", addr: "3 Bay" },
    ] };
  const out = aggregate({ rosters: { ah: [clinician], oh: [] },
    zipCounty: { "32801": "Orange", "33607": "Hillsborough" }, source: "t", locationMode: "all" });
  assert.equal(out.byZip.totals.ah, 1, "statewide headline is distinct");
  assert.equal(out.byZip.zips["32801"].ah, 1, "same person counts once in a ZIP");
  assert.equal(out.byZip.zips["33607"].ah, 1, "the person also appears in their other ZIP");
  assert.equal(out.rosterZip["32801"].length, 1, "one provider card per area");
  assert.equal(out.rosterZip["32801"][0].l.length, 2, "card lists both offices in that ZIP");
  assert.equal(out.rosterZip["32801"][0].ph, clinician.photo);
  assert.deepEqual(out.byZip.locationTotals, out.byCounty.locationTotals,
    "provider-location headline does not change with geography");
  assert.equal(out.byZip.locationTotals.ah, 3, "every distinct provider-office assignment is counted");
  assert.equal(out.byZip.specialties[0].ahLocations, 3);
});

test("AdventHealth listing parser captures photo and every location", async () => {
  const { parseListingPage } = await import("../scripts/capture-ah-directory.mjs");
  const html = `<div>1 provider matches your search</div>
    <li class="physicians-search-block__item">
      <a href="/doctors/ada-example-1234567890"><div class="physician-block__image"><img src="/ada.jpg"></div></a>
      <div class="physician-block__name">Ada Example, MD</div>
      <div class="physician-block__specialty">Cardiology</div>
      <li class="ahs-location-selector__list-item" data-location-lat="28.5" data-location-lng="-81.3">
        <div class="address-name">AdventHealth Orlando</div><span property="streetAddress">1 Main<br>Suite 2</span>
        <span property="addressLocality">Orlando</span><span property="addressRegion">FL</span><span property="postalCode">32801</span>
      </li>
      <li class="ahs-location-selector__list-item" data-location-lat="28.6" data-location-lng="-81.4">
        <div class="address-name">AdventHealth Winter Park</div><span property="streetAddress">2 Park</span>
        <span property="addressLocality">Winter Park</span><span property="addressRegion">FL</span><span property="postalCode">32789</span>
      </li>
    </li>`;
  const parsed = parseListingPage(html);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].photo, "https://www.adventhealth.com/ada.jpg");
  assert.equal(parsed.records[0].locations.length, 2);
  assert.equal(parsed.records[0].locations[0].street, "1 Main, Suite 2");
});

// The two directories name the same medicine differently (AH "OBGYN", OH
// "Obstetrics and Gynecology") — without one vocabulary the filter shows each
// side as having nobody in the other's column.
test("canonicalSpecialty folds both systems' names into one vocabulary", async () => {
  const { canonicalSpecialty } = await import("../src/specialty.js");
  assert.equal(canonicalSpecialty("OBGYN"), "Obstetrics and Gynecology");
  assert.equal(canonicalSpecialty("Cardiovascular Disease"), "Cardiology");
  assert.equal(canonicalSpecialty("Gastroenterology"), "Gastroenterology (GI)");
  assert.equal(canonicalSpecialty("Surgery - General"), "General Surgery", "OH internal duplicate");
  assert.equal(canonicalSpecialty("Neurology"), "Neurology", "unmapped names pass through");
  assert.equal(canonicalSpecialty("Critical Care Medicine"), "Critical Care Medicine", "hospital-based families NOT collapsed");
});

// The map counts clinicians a patient can book. OH's directory also lists its
// hospital machinery (anesthesia teams, hospitalists, reading-room radiology,
// PT/nutrition, surgical assists) which AH's consumer directory omits —
// counting those on one side only would distort every per-area comparison.
test("isBookable excludes hospital-based and support staff, keeps clinic care", async () => {
  const { isBookable } = await import("../src/specialty.js");
  for (const s of ["Anesthesiology (Hospital-Based)", "Internal Medicine (Hospital-Based)",
                   "Radiology", "Radiology - Breast Imaging", "Pediatric Radiology", "Neuroradiology",
                   "Physical Therapy", "Dietitian", "Nurse Anesthetist", "Not Specified"])
    assert.ok(!isBookable(s), s + " should be excluded");
  for (const s of ["Family Medicine", "Cardiology", "Audiology", "Nurse Midwife",
                   "Licensed Mental Health Counselor", "Nurse Practitioner", "Neuropsychology"])
    assert.ok(isBookable(s), s + " should stay");
});
