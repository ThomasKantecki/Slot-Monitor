// The Python extractor reads the same registry: a dry run per specialty, catalog matching, the probe compiles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SPECIALTIES } from "../pages/shared/specialties.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const python = [process.env.SLOT_MONITOR_PYTHON, join(ROOT, ".venv", "bin", "python"), "python3", "python"]
  .filter(Boolean).find((candidate) => (candidate.includes("/") ? existsSync(candidate) : true) && spawnSync(candidate, ["--version"]).status === 0);
const run = (args) => execFileSync(python, args, { cwd: ROOT, encoding: "utf8" });

test("a dry run for orthopedics writes under data/orthopedics and reports the registry label", { skip: !python && "no python" }, () => {
  const output = JSON.parse(run(["extractor/extract_system.py", "--system", "oh", "--run-id", "test-run", "--specialty", "orthopedics", "--dry-run"]));
  assert.equal(output.specialty, "Orthopedics");
  assert.equal(output.specialtyId, "orthopedics");
  assert.match(output.output, /data\/orthopedics\/extractions\/test-run\/oh$/);
  const cardio = JSON.parse(run(["extractor/extract_system.py", "--system", "ah", "--run-id", "test-run", "--dry-run"]));
  assert.equal(cardio.specialty, "Cardiology");
  assert.deepEqual(cardio.catalogNames, ["Cardiology"]);
  assert.match(cardio.output, /data\/cardiology\/extractions\/test-run\/ah$/);
});

test("the extractor matches several catalog names, ignoring case and spacing, and reads the same registry ids", { skip: !python && "no python" }, () => {
  const script = [
    "import json, sys; sys.path.insert(0, 'extractor'); import epic_public as ep",
    "catalog = {'Specialties': [{'ID': '1', 'Name': 'Orthopedic  Surgery'}, {'ID': '2', 'Name': 'Cardiology'}, {'ID': '3', 'Name': 'sports medicine'}]}",
    "picked = ep.select_catalog_entries(catalog, ['orthopedic surgery', 'Sports Medicine'])",
    "print(json.dumps({'picked': [item['ID'] for item in picked], 'ids': [entry['id'] for entry in json.loads(ep.REGISTRY.read_text())]}))",
  ].join("; ");
  const output = JSON.parse(run(["-c", script]));
  assert.deepEqual(output.picked, ["1", "3"]);
  assert.deepEqual(output.ids, SPECIALTIES.map((entry) => entry.id));
});

test("the catalog probe and the refresh orchestrator accept --specialty", { skip: !python && "no python" }, () => {
  run(["-m", "py_compile", "extractor/catalog_probe.py"]);
  const plan = run(["extractor/refresh.py", "--specialty", "orthopedics", "--run-id", "test-run", "--dry-run"]);
  assert.match(plan, /extract_system\.py --system ah --run-id test-run --specialty orthopedics/);
  assert.match(plan, /build-specialty-current\.mjs --specialty orthopedics/);
  assert.match(plan, /oh-orthopedics-unique-physical-slots\.csv/);
});
