import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/slot-times/radius.js";

const centroidSource = readFileSync(new URL("../data/geography/florida-zip-centroids.js", import.meta.url), "utf8").trim();
const centroids = JSON.parse(centroidSource.replace(/^window\.FLORIDA_ZIP_CENTROIDS=/, "").replace(/;$/, ""));

test("radius distance uses v3's great-circle mile calculation", () => {
  assert.equal(globalThis.SLOT_RADIUS.miles(28.54, -81.38, 28.54, -81.38), 0);
  assert.ok(Math.abs(globalThis.SLOT_RADIUS.miles(28, -81, 29, -81) - 69.1) < 0.2);
});

test("local Florida origin data covers every current cardiology facility ZIP", () => {
  const model = JSON.parse(readFileSync(new URL("../data/cardiology/current/slot-times-model.json", import.meta.url), "utf8"));
  const originZips = new Set(centroids.map((row) => row.zip));
  assert.ok(centroids.length > 900);
  assert.ok(originZips.has("32804"));
  assert.deepEqual([...new Set(model.facilities.map((facility) => facility.z))].filter((zip) => !originZips.has(zip)), []);
});
