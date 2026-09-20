// The specialty registry shared by the Node scripts and the Python extractor, and the per-specialty build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY, SPECIALTIES, copyOf, specialtyFromArgv, specialtyOf, specialtyPaths } from "../src/shared/specialties.js";
import { isPublished } from "../scripts/build-specialties.mjs";

const registry = JSON.parse(readFileSync(new URL("../src/shared/specialties.json", import.meta.url), "utf8"));

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
  assert.match(pkg.scripts.build, /^node scripts\/build-specialties\.mjs && node src\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts.all, /build-specialties\.mjs && node src\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts["refresh:orthopedics"], /refresh\.py --specialty orthopedics$/);
  assert.match(pkg.scripts["probe:catalog"], /catalog_probe\.py$/);
  assert.equal(isPublished(specialtyOf("cardiology")), true, "cardiology has published data in this checkout");
});
