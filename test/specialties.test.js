// The specialty registry: its shape and paths, the specialty menu on every page, and placeholder pages
// for a specialty that has no data yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { COPY, copyOf, SPECIALTIES, specialtyFromArgv, specialtyHref, specialtyOf, specialtyPaths } from "../pages/shared/specialties.js";
import { isPublished } from "../slots/build-specialties.mjs";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteTitle } from "../pages/shared/suite-navigation.js";
import { renderSpecialtyPlaceholder } from "../pages/shared/specialty-placeholders.js";

// ---- specialties ----
const registry = JSON.parse(readFileSync(new URL("../specialties.json", import.meta.url), "utf8"));

test("the registry names both specialties, their Epic catalog entries and their roster groups", () => {
  assert.deepEqual(registry.map((entry) => entry.id), ["cardiology", "orthopedics"]);
  assert.deepEqual(SPECIALTIES.map((entry) => entry.id), registry.map((entry) => entry.id));
  for (const entry of registry) {
    assert.deepEqual(Object.keys(entry.catalog).sort(), ["ah", "oh"], `${entry.id} lists a catalog per system`);
    assert.ok(entry.roster.members.includes(entry.roster.group) || entry.id !== "cardiology", `${entry.id} group label is a member`);
    assert.ok(new Set(entry.roster.members).size === entry.roster.members.length, `${entry.id} members are distinct`);
    assert.ok(COPY[entry.id]?.newPatientTip && COPY[entry.id]?.rosterNote, `${entry.id} has page copy`);
  }
  assert.deepEqual(registry[0].catalog, { ah: ["Cardiology"], oh: ["Cardiology"] });
  assert.equal(specialtyOf("orthopedics").dataDir, "data/orthopedics");
  assert.equal(copyOf(specialtyOf("cardiology")).newPatientTip.slice(0, 44), "Keeps only the visit types a new patient can");
});

test("specialtyPaths keeps cardiology at the root and puts other specialties one folder down", () => {
  const cardio = specialtyPaths(specialtyOf("cardiology")), ortho = specialtyPaths(specialtyOf("orthopedics"));
  assert.equal(cardio.export, "data/cardiology/current/cardiology-physical-slots.json");
  assert.equal(cardio.summary, "public/data/cardiology/slot-times-summary.json");
  assert.equal(cardio.pages, "public/");
  assert.equal(cardio.partitionBase, "data/cardiology/slots");
  assert.equal(ortho.runs, "data/orthopedics/runs");
  assert.equal(ortho.model, "data/orthopedics/current/slot-times-model.json");
  assert.equal(ortho.pages, "public/orthopedics/");
  assert.equal(ortho.partitionBase, "../data/orthopedics/slots");
});

test("--specialty on a script's command line selects the specialty, cardiology when absent", () => {
  assert.equal(specialtyFromArgv(["node", "script.mjs"]).id, "cardiology");
  assert.equal(specialtyFromArgv(["node", "script.mjs", "--run-id", "x", "--specialty", "orthopedics"]).id, "orthopedics");
  assert.throws(() => specialtyFromArgv(["node", "script.mjs", "--specialty", "dermatology"]), /Unknown specialty/);
});

test("npm run build goes through the per-specialty orchestrator and ends with the placeholder step", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /^node slots\/build-specialties\.mjs && node pages\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts.all, /build-specialties\.mjs && node pages\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts["refresh:orthopedics"], /refresh\.py --specialty orthopedics$/);
  assert.match(pkg.scripts["probe:catalog"], /catalog_probe\.py$/);
  assert.equal(isPublished(specialtyOf("cardiology")), true, "cardiology has published data in this checkout");
});

// ---- specialty-switch ----
test("the title box offers every specialty and links each one to the same view", () => {
  assert.deepEqual(SPECIALTIES.map((specialty) => specialty.id), ["cardiology", "orthopedics"]);
  const cardio = suiteTitle("slot-times");
  assert.match(cardio, /<select class="specialty-select" aria-label="Specialty">/);
  assert.match(cardio, /<option value="cardiology" data-href="\.\/index\.html" selected>Cardiology<\/option>/);
  assert.match(cardio, /<option value="orthopedics" data-href="\.\/orthopedics\/index\.html">Orthopedics<\/option>/);
  assert.match(cardio, /class="pixel-heart"/);
  assert.doesNotMatch(cardio, /pixel-bone/);
  const ortho = suiteTitle("provider-map", "orthopedics");
  assert.match(ortho, /<span class="specialty-sizer" aria-hidden="true">Orthopedics<\/span>/);
  assert.match(ortho, /<option value="cardiology" data-href="\.\.\/provider-map\.html">Cardiology<\/option>/);
  assert.match(ortho, /<option value="orthopedics" data-href="\.\/provider-map\.html" selected>Orthopedics<\/option>/);
  assert.match(ortho, /<b>Provider Index<\/b><\/span><span class="pixel-bone" aria-hidden="true">/);
  assert.doesNotMatch(ortho, /pixel-heart/);
  assert.throws(() => suiteTitle("slot-times", "dermatology"), /Unknown specialty/);
  assert.equal(specialtyHref(specialtyOf("orthopedics"), specialtyOf("cardiology"), "index.html"), "../index.html");
});

test("choosing a specialty navigates to that specialty's copy of the view", () => {
  assert.match(SUITE_INFO_SCRIPT, /querySelector\("\.specialty-select"\)[\s\S]*addEventListener\("change"[\s\S]*dataset\.href[\s\S]*location\.href = href/);
  assert.match(SUITE_NAV_STYLES, /\.specialty-select\{position:absolute;inset:0;width:100%;height:100%[^}]*appearance:none/);
  assert.match(SUITE_NAV_STYLES, /\.specialty-sizer\{display:inline-block;visibility:hidden/);
});

test("a specialty without published data gets placeholder pages that carry the shared header", () => {
  for (const [page, view, name] of [["slot-times", "Slot Availability", "Slot Availability"], ["opportunities", "AH Market Opportunities", "Market Opportunities"], ["provider-map", "Provider Index", "Provider Index"]]) {
    const html = renderSpecialtyPlaceholder("orthopedics", page);
    assert.match(html, new RegExp(`<title>Orthopedics ${name}</title>`));
    assert.match(html, /<option value="orthopedics"[^>]*selected>Orthopedics<\/option>/);
    assert.match(html, new RegExp(`<b>${view}</b></span><span class="pixel-bone"`));
    assert.match(html, /Orthopedics data is coming soon\./);
    assert.match(html, /<nav class="suite-switcher" aria-label="Dashboard views">/);
    assert.match(html, /id="dataset-info-button"/);
    assert.match(html, /<li class="warn"><span class="check-mark">!<\/span><span>Orthopedics slot data has not been published yet/);
    assert.match(html, /--ah-logo-img:url\(data:image\/png;base64,/);
    assert.doesNotMatch(html, /__[A-Z_]+__/);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /node pages\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts.all, /node pages\/shared\/specialty-placeholders\.js$/);
});

test("a specialty whose data is published has real pages, not placeholders", () => {
  for (const specialty of SPECIALTIES.filter((entry) => entry.folder)) {
    const summary = new URL(`../public/${specialty.dataDir}/slot-times-summary.json`, import.meta.url);
    if (!existsSync(summary)) continue;
    for (const file of ["index.html", "market-opportunities.html", "provider-map.html"]) {
      const html = readFileSync(new URL(`../public/${specialty.folder}${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(html, /data is coming soon/, `${specialty.id}/${file} is still a placeholder`);
      assert.match(html, new RegExp(`<option value="${specialty.id}"[^>]*selected>`));
    }
  }
});
