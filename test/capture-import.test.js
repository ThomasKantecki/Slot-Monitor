// The browser-made AdventHealth capture goes through the same guards as a direct one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCapture, mergeRecords, validateCapture } from "../directories/capture-adventhealth.mjs";

const record = (npi, extra = {}) => ({ npi, name: `Doc ${npi}, MD`, spec: "Cardiology", photo: "", profile: `https://www.adventhealth.com/doctors/doc-${npi}`, locations: [{ locName: "Clinic", street: "1 Main St", city: "Orlando", state: "FL", zip: "32801", lat: 28.5, lon: -81.4, primary: true }], ...extra });

test("validateCapture enforces the scope, the 98% record guard and the 90% location guard", () => {
  const ok = { scope: "adventhealth-medical-group", listedTotal: 100, records: Array.from({ length: 99 }, (_, i) => record(String(1000000000 + i))) };
  assert.deepEqual(validateCapture(ok), { records: 99, located: 99 });
  assert.throws(() => validateCapture({ ...ok, scope: "network" }), /scope must be adventhealth-medical-group/);
  assert.throws(() => validateCapture({ ...ok, records: ok.records.slice(0, 97) }), /97 unique records from 100/);
  const unlocated = ok.records.map((r, i) => (i < 15 ? { ...r, locations: [] } : r));
  assert.throws(() => validateCapture({ ...ok, records: unlocated }), /only 84 of 99 records have a location/);
});

test("importCapture merges page-boundary duplicates, drops rows without a 10-digit NPI and keeps the capture time", () => {
  const dir = mkdtempSync(join(tmpdir(), "ah-capture-"));
  const file = join(dir, "capture.json");
  const dup = record("1234567890", { locations: [{ locName: "Other", street: "2 Side St", city: "Tampa", state: "FL", zip: "33602", lat: 27.9, lon: -82.4, primary: true }] });
  writeFileSync(file, JSON.stringify({ fetchedAt: "2026-09-20T15:00:00.000Z", scope: "adventhealth-medical-group", listedTotal: 2, pages: 1, records: [record("1234567890"), dup, { npi: "", name: "Facility" , locations: [] }, record("2345678901")] }));
  const result = importCapture(file);
  assert.equal(result.fetchedAt, "2026-09-20T15:00:00.000Z");
  assert.equal(result.scope, "adventhealth-medical-group");
  assert.equal(result.listedTotal, 2);
  assert.deepEqual(result.records.map((r) => r.npi), ["1234567890", "2345678901"]);
  assert.equal(result.records[0].locations.length, 2, "locations from both pages are kept");
  assert.equal(mergeRecords([record("1"), record("1")]).length, 1);
});
