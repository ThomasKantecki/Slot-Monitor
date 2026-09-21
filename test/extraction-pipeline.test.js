// The scraper: scripts compile, the offline paging replay passes, deduplication keeps counts, and the audit script runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Same lookup as scripts/run-python.mjs: CARDIOLOGY_PYTHON, then a repository .venv, then Python on PATH.
function findPython() {
  const configured = process.env.CARDIOLOGY_PYTHON;
  const candidates = [
    ...(configured ? [[configured]] : []),
    [join(ROOT, ".venv", "Scripts", "python.exe")],
    [join(ROOT, ".venv", "bin", "python")],
    ["python3"], ["python"], ["py", "-3"],
  ];
  for (const [command, ...prefix] of candidates) {
    if ((command.includes("\\") || command.includes("/")) && !existsSync(command)) continue;
    const probe = spawnSync(command, [...prefix, "--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return { command, prefix };
  }
  throw new Error("Python 3.9+ was not found. Create .venv or set CARDIOLOGY_PYTHON to a Python executable.");
}
const { command: PYTHON_COMMAND, prefix: PYTHON_PREFIX } = findPython();
const python = (args, options) => spawnSync(PYTHON_COMMAND, [...PYTHON_PREFIX, ...args], options);

test("Cardiology extraction scripts compile and expose an offline dry run", () => {
  const scripts = ["epic_public.py", "extract_system.py", "extract_ah.py", "extract_oh.py", "deduplicate.py", "refresh.py", "walk_check.py", "catalog_probe.py"]
    .map((name) => join(ROOT, "extractors", "cardiology", name));
  const source = scripts.map((path) => readFileSync(path, "utf8"));
  source.forEach((code, index) => assert.doesNotThrow(() => {
    const result = python(["-c", "compile(open(r'''" + scripts[index] + "''', encoding='utf-8').read(), r'''" + scripts[index] + "''', 'exec')"]);
    if (result.status !== 0) throw new Error(result.stderr.toString());
  }));
  const dry = python([scripts[1], "--system", "ah", "--run-id", "test-run", "--dry-run"], { encoding: "utf8" });
  assert.equal(dry.status, 0, dry.stderr);
  const output = JSON.parse(dry.stdout);
  assert.equal(output.status, "dry_run");
  assert.equal(output.system, "AH");
  assert.equal(output.specialty, "Cardiology");
});

test("slot paging survives Epic's empty closing pages, re-served pages and stalls without losing a slot", () => {
  const result = python([join(ROOT, "extractors", "cardiology", "paging_check.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /stall_new_tokens .* ok/);
  assert.match(result.stdout, /stall_same_token .* ok/);
  assert.match(result.stdout, /reserve_once .* restarts=  0 ok/);
  assert.match(result.stdout, /reserve_window .* restarts=  0 ok/, "re-served chunks under advancing tokens are followed, not restarted past");
  assert.match(result.stdout, /failed_resume .* restarts=  0 ok/, "a flow that failed after its checkpoint resumes from it");
  assert.match(result.stdout, /year_jump +schedule_end/, "Epic's year jump past the last opening is the schedule's end, not the cap");
  assert.match(result.stdout, /search identity ok/);
});

test("the questionnaire walker finds every search of an exhaustive walk with far fewer requests and withdraws a rule that fails its re-check", () => {
  const result = python([join(ROOT, "extractors", "cardiology", "walk_check.py")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /walk check ok/);
});

test("OH physical deduplication collapses flow overlap without losing counts", () => {
  const folder = mkdtempSync(join(tmpdir(), "slot-monitor-dedup-"));
  try {
    const input = join(folder, "slots.csv"), output = join(folder, "unique.csv");
    const header = "flow_id,provider_id,department_id,display_datetime_utc,provider_name,visit_type,reason_for_visit,questionnaire_path\n";
    writeFileSync(input, header + [
      "a,p1,d1,2026-09-02T13:00:00Z,Doctor One,New Patient,Check up,path-a",
      "b,p1,d1,2026-09-02T13:00:00Z,Doctor One,Check up,Chest pressure,path-b",
      "c,p1,d1,2026-09-02T14:00:00Z,Doctor One,New Patient,Check up,path-a",
    ].join("\n") + "\n");
    const result = python([join(ROOT, "extractors", "cardiology", "deduplicate.py"), "--input", input, "--output", output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const rows = readFileSync(output, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    assert.equal(rows.length, 3, "header plus two physical slots");
    assert.match(rows[0], /matching_reasons,matching_visit_types/);
    assert.match(rows[1], /Check up\|Chest pressure/);
    assert.match(rows[1], /Check up\|New Patient/);
    assert.match(rows[1], /,2,2,2,2,2$/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("current snapshot builder selects latest system files instead of pinned run IDs", () => {
  const source = readFileSync(new URL("../scripts/build-specialty-current.mjs", import.meta.url), "utf8");
  assert.match(source, /latestSystemFile\("ah"/);
  assert.match(source, /latestSystemFile\("oh"/);
  assert.doesNotMatch(source, /2026-09-01T110649|2026-09-01T125802/);
});

test("every current facility ZIP maps to both ZIP and county geometry", () => {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "audit-geography-coverage.mjs")], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.mappedSlotRate, 100);
  assert.equal(audit.countyAggregateReconciles, true);
  assert.deepEqual(audit.unmappedFacilities, []);
  assert.deepEqual(audit.facilityZipsMissingMapShape, []);
  assert.deepEqual(audit.mappedCountiesMissingShape, []);
});
