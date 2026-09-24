#!/usr/bin/env python3
"""Run AH and OH Gastro extraction, deduplication and the Slot-Monitor site build.

--extract runs the network extractors; --from-files uses explicit raw files.
By default the run is staged only. Add --publish to build and audit in an isolated
workspace, then replace the Gastro current dataset, daily JSON and three pages.
No Git commit or GitHub deployment is performed.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DATA = REPO / "data" / "gastroenterology"
AH = HERE / "AH_Gastroenterology_Slot_Extractor.py"
OH = HERE / "OH_Gastro_Slot_Extractor.py"
AH_DEDUP = HERE / "AH_Gastro_Deduplicate_Slots.py"
OH_DEDUP = HERE / "OH_Gastro_Deduplicate_Slots.py"
AH_ENGINE = "epic_scheduling_extractor_AH.py"
OH_ENGINE = "epic_scheduling_extractor_OH.py"
REQUIRED = ("provider_id", "department_id", "display_datetime_utc", "length_minutes")
AH_FIELDS = ("specialty", "provider_name", "provider_id", "provider_credentials",
             "location_name", "department_id", "address", "city", "state", "zip",
             "appointment_date", "appointment_time", "display_datetime_utc",
             "days_ahead", "timezone", "decision_tree_path", "source_url")
BAD_OH = {"coverage_failure", "flow_error", "slot_response_error", "slot_lookup_error",
          "page_guard_reached", "repeated_page_stop", "repeated_continue_stop"}


def check_file(path: Path) -> Path:
    path = path.resolve()
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Missing or empty file: {path}")
    return path


def module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, check_file(path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def command(*args: str) -> None:
    print("RUN:", " ".join(map(str, args)), flush=True)
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, (str(HERE), str(REPO), env.get("PYTHONPATH", ""))))
    subprocess.run(list(map(str, args)), cwd=REPO, env=env, check=True)


def latest_run(root: Path, pattern: str) -> Path:
    candidates = [p for p in root.iterdir() if p.is_dir() and list(p.glob(pattern))]
    if not candidates:
        raise RuntimeError(f"No run with {pattern} found under {root}")
    return max(candidates, key=lambda p: p.stat().st_mtime)


def validate_oh(audit_path: Path, health_path: Path) -> None:
    health = json.loads(check_file(health_path).read_text(encoding="utf-8-sig"))
    audit = json.loads(check_file(audit_path).read_text(encoding="utf-8-sig"))
    if not isinstance(audit, list) or not audit:
        raise RuntimeError("OH flow audit is empty or not an array")
    bad = [row for row in audit if row.get("status") in BAD_OH]
    if health.get("status") != "accepted" or bad:
        raise RuntimeError(f"OH extraction is not accepted: health={health.get('status')}, bad flows={len(bad)}")


def validate_ah_summary(path: Path) -> None:
    data = json.loads(check_file(path).read_text(encoding="utf-8-sig"))
    if not isinstance(data, list) or not data:
        raise RuntimeError("AH flow summary is empty or not an array; inspect its format")
    bad = [row for row in data if str(row.get("status", "")).lower() in
           {"slot_response_error", "flow_error", "request_failed", "page_guard_reached",
            "slot_lookup_error", "repeated_page_stop", "repeated_continue_stop",
            "run_error", "incomplete", "coverage_failure"}]
    if bad:
        raise RuntimeError(f"AH extraction has {len(bad)} failed flows; refusing publication")
    if not all("status" in row for row in data):
        raise RuntimeError("AH summary lacks per-flow status; cannot establish completeness")


def dedup(raw_ah: Path, raw_oh: Path, work: Path) -> tuple[Path, Path]:
    # Override the old scripts' automatic 'latest file' lookup so BOTH consume this run only.
    ah = module(AH_DEDUP, "ah_gastro_dedup_current_run")
    ah.latest_slots_csv = lambda: raw_ah
    ah.DASHBOARD_ROOT = work / "ah-dedup"
    ah.main()
    ah_csv = check_file(ah.DASHBOARD_ROOT / "current" / "source-ah-unique-physical-slots.csv")
    ah_manifest = json.loads((ah.DASHBOARD_ROOT / "current" / "deduplication-manifest.json").read_text())
    if ah_manifest.get("rows_skipped_missing_key_values") or not ah_manifest.get("unique_physical_slots"):
        raise RuntimeError("AH dedup skipped physical keys or produced zero slots")

    oh = module(OH_DEDUP, "oh_gastro_dedup_current_run")
    oh.latest_slots_csv = lambda: raw_oh
    oh.V5_ROOT = work / "oh-dedup"
    oh.build()
    oh_csv = check_file(oh.V5_ROOT / "current" / "source-oh-unique-physical-slots.csv")
    return ah_csv, oh_csv


def stage_ah(raw: Path, target: Path) -> int:
    """Match Slot-Monitor's AH contract: one provider/department/UTC start;
    keep ALL appointment type/reason/duration combinations in booking_options_json.
    A duration-specific dedup CSV is retained separately for auditing.
    """
    target.mkdir(parents=True, exist_ok=False)
    fd, temp = tempfile.mkstemp(prefix="ah-slot-groups-", suffix=".sqlite3", dir=target.parent)
    os.close(fd)
    db = sqlite3.connect(temp)
    try:
        db.execute("CREATE TABLE slot (k TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE option (k TEXT NOT NULL, t TEXT NOT NULL, r TEXT NOT NULL, d INTEGER, "
                   "PRIMARY KEY (k,t,r,d))")
        with raw.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            if not set(REQUIRED).issubset(reader.fieldnames or ()):
                raise RuntimeError("AH raw CSV is missing physical-slot fields")
            count = 0
            for row in reader:
                key_fields = [row.get(field, "").strip() for field in REQUIRED[:3]]
                if not all(key_fields):
                    raise RuntimeError(f"AH raw row {count + 1} lacks provider, department or UTC time")
                key = "|".join(key_fields)
                payload = {field: row.get(field, "") for field in AH_FIELDS}
                payload["specialty"] = payload["specialty"] or "Gastroenterology"
                db.execute("INSERT OR IGNORE INTO slot VALUES (?,?)", (key, json.dumps(payload, ensure_ascii=False)))
                duration = row.get("length_minutes", "").strip()
                if not duration:
                    raise RuntimeError(f"AH raw row {count + 1} has no duration; dedup would skip it")
                minutes = int(float(duration))
                db.execute("INSERT OR IGNORE INTO option VALUES (?,?,?,?)",
                           (key, row.get("appointment_type", "").strip(),
                            row.get("reason_for_visit", "").strip(), minutes))
                count += 1
                if count % 10000 == 0:
                    db.commit()
        db.commit()
        out = target / "ah-gastroenterology-physical-slots.json"
        n = 0
        with out.open("w", encoding="utf-8") as handle:
            handle.write("[\n")
            for key, payload in db.execute("SELECT k,payload FROM slot ORDER BY k"):
                options = [{"appointment_type": t, "reason_for_visit": r, "length_minutes": d}
                           for t, r, d in db.execute("SELECT t,r,d FROM option WHERE k=? ORDER BY t,r,d", (key,))]
                if not options:
                    raise RuntimeError(f"No booking options for {key}")
                row = json.loads(payload)
                row["physical_slot_id"] = "AH-" + hashlib.sha256(key.encode()).hexdigest()[:20]
                row["appointment_types"] = " | ".join(dict.fromkeys(o["appointment_type"] for o in options if o["appointment_type"]))
                row["appointment_type_count"] = len({o["appointment_type"] for o in options if o["appointment_type"]})
                row["duration_minutes"] = " | ".join(map(str, sorted({o["length_minutes"] for o in options if o["length_minutes"]})))
                row["booking_options_json"] = json.dumps(options, ensure_ascii=False, separators=(",", ":"))
                handle.write((",\n" if n else "") + json.dumps(row, ensure_ascii=False, separators=(",", ":")))
                n += 1
            handle.write("\n]\n")
        if not n:
            raise RuntimeError("AH site-format output contains zero physical slots")
        (target / "manifest.json").write_text(json.dumps({"status": "imported", "physicalSlots": n,
            "source": {"originalPath": str(raw), "rows": count},
            "outputs": [out.name]}, indent=2), encoding="utf-8")
        return n
    finally:
        db.close()
        Path(temp).unlink(missing_ok=True)


def stage_oh(source: Path, target: Path) -> int:
    """Collapse duration variants to the site's physical key; retain all labels."""
    target.mkdir(parents=True, exist_ok=False)
    grouped = {}
    with source.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        required = {"provider_id", "department_id", "display_datetime_utc", "length_minutes"}
        if not required.issubset(reader.fieldnames or ()):
            raise RuntimeError("OH dedup output is missing physical-slot columns")
        for row in reader:
            key = tuple(row.get(field, "").strip() for field in
                        ("provider_id", "department_id", "display_datetime_utc"))
            if not all(key):
                raise RuntimeError("OH dedup output has a missing physical-slot key")
            if key not in grouped:
                grouped[key] = {"row": dict(row), "types": set(), "reasons": set(), "flows": 0}
            group = grouped[key]
            group["types"].update(x.strip() for x in row.get("matching_visit_types", "").split("|") if x.strip())
            group["reasons"].update(x.strip() for x in row.get("matching_reasons", "").split("|") if x.strip())
            group["flows"] = max(group["flows"], int(row.get("matching_flow_count") or 0))
    if not grouped:
        raise RuntimeError("OH dedup output contains no slots")
    output = target / "source-oh-unique-physical-slots.csv"
    with output.open("w", newline="", encoding="utf-8") as handle:
        fields = list(next(iter(grouped.values()))["row"])
        if "specialty" not in fields:
            fields.append("specialty")
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for key in sorted(grouped):
            group = grouped[key]
            row = group["row"]
            row["specialty"] = "Gastroenterology"
            row["matching_visit_types"] = " | ".join(sorted(group["types"]))
            row["matching_reasons"] = " | ".join(sorted(group["reasons"]))
            row["matching_visit_type_count"] = len(group["types"])
            row["matching_reason_count"] = len(group["reasons"])
            row["matching_flow_count"] = group["flows"]
            writer.writerow(row)
    return len(grouped)


def build_and_publish(run: Path, run_id: str) -> None:
    """Build in a separate tree and only install audited Gastro outputs."""
    if not (REPO / "slots" / "build-specialty-current.mjs").is_file():
        raise RuntimeError("Slot-Monitor builder not found beside extractors/")
    with tempfile.TemporaryDirectory(prefix=".gastro-build-", dir=REPO) as temp:
        shadow = Path(temp)
        for directory in ("slots", "pages", "rosters", "checks", "assets",
                          "data/geography", "data/rosters", "data/raw"):
            source = REPO / directory
            if not source.is_dir():
                raise RuntimeError(f"Required site-build directory missing: {source}")
            shutil.copytree(source, shadow / directory)
        for name in ("specialties.json", "package.json"):
            shutil.copy2(check_file(REPO / name), shadow / name)
        staged = shadow / "data" / "gastroenterology" / "runs" / run_id
        shutil.copytree(run, staged)
        def node(script: str, *arguments: str, heap: bool = False) -> None:
            argv = ["node"] + (["--max-old-space-size=6144"] if heap else [])
            argv += [script, *arguments, "--specialty", "gastroenterology"]
            print("BUILD:", " ".join(argv), flush=True)
            subprocess.run(argv, cwd=shadow, check=True)
        node("slots/build-specialty-current.mjs", heap=True)
        node("slots/build-slot-times-data.mjs", heap=True)
        node("slots/build-slot-partitions.mjs", heap=True)
        for script in ("pages/provider-index/render.js",
                       "pages/slot-availability/render.js",
                       "pages/market-opportunities/render.js"):
            node(script, heap=True)
        node("checks/audit-dataset.mjs", heap=True)
        manifest = json.loads(check_file(shadow / "data/gastroenterology/current/manifest.json").read_text())
        summary = json.loads(check_file(shadow / "public/data/gastroenterology/slot-times-summary.json").read_text())
        if manifest["ah"]["runId"] != run_id or manifest["oh"]["runId"] != run_id:
            raise RuntimeError("Site builder selected stale or mismatched runs")
        if manifest["totalPhysicalSlots"] != summary["totalPhysicalSlots"]:
            raise RuntimeError("Summary and manifest counts disagree")
        if not summary.get("partitionDates"):
            raise RuntimeError("No daily partitions were produced")
        for date in summary["partitionDates"]:
            part = json.loads(check_file(shadow / "public/data/gastroenterology/slots" / f"{date}.json").read_text())
            if part.get("date") != date:
                raise RuntimeError(f"Invalid partition date: {date}")
        outputs = (
            (shadow / "data/gastroenterology/current", REPO / "data/gastroenterology/current"),
            (shadow / "public/data/gastroenterology", REPO / "public/data/gastroenterology"),
            (shadow / "public/gastroenterology", REPO / "public/gastroenterology"),
        )
        for src, _ in outputs:
            if not src.is_dir() or not any(src.iterdir()):
                raise RuntimeError(f"Built output missing: {src}")
        backup = shadow / "backup"
        backup.mkdir()
        installed = []
        try:
            for index, (src, dest) in enumerate(outputs):
                dest.parent.mkdir(parents=True, exist_ok=True)
                old = backup / str(index)
                existed = dest.exists()
                if existed:
                    dest.rename(old)
                installed.append((dest, old, existed))
                shutil.copytree(src, dest)
        except BaseException:
            for dest, old, existed in reversed(installed):
                if dest.exists():
                    shutil.rmtree(dest)
                if existed:
                    old.rename(dest)
            raise
        print(f"PUBLISHED locally: {summary['totalPhysicalSlots']:,} Gastro slots; "
              f"{len(summary['partitionDates'])} daily JSON files; all 3 pages rebuilt")
        print("No git commit or GitHub Pages deployment performed.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract", action="store_true", help="Run AH and OH extractors (network calls)")
    parser.add_argument("--from-files", action="store_true", help="Convert explicit existing raw files offline")
    parser.add_argument("--ah-raw", type=Path)
    parser.add_argument("--oh-raw", type=Path)
    parser.add_argument("--ah-summary", type=Path)
    parser.add_argument("--oh-audit", type=Path)
    parser.add_argument("--oh-health", type=Path)
    parser.add_argument("--run-id", default=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ"))
    parser.add_argument("--publish", action="store_true", help="Build, audit and replace Gastro site files locally")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", args.run_id) or args.run_id in (".", ".."):
        parser.error("--run-id must be a simple unique folder name")
    if args.extract == args.from_files:
        parser.error("Choose exactly one of --extract or --from-files")
    for script in (AH, OH, AH_DEDUP, OH_DEDUP):
        check_file(script)
    if args.extract:
        for engine in (AH_ENGINE, OH_ENGINE):
            if not any((base / engine).is_file() for base in (HERE, REPO)):
                raise RuntimeError(f"Missing {engine}; place both engine files in extractors/ before running")
        import openpyxl  # noqa: F401: AH engine's workbook finalization requires it.
        import pandas  # noqa: F401: standalone deduplicators require it.
        # The AH wrapper may relaunch into a repository .venv. Check THAT interpreter
        # before a network run so missing openpyxl cannot fail at finalization.
        for base in (HERE, REPO):
            venv_python = base / ".venv" / "Scripts" / "python.exe"
            if venv_python.is_file():
                subprocess.run([str(venv_python), "-c", "import openpyxl, pandas"],
                               cwd=REPO, check=True)
                break
        ah_root = DATA / "extractions" / args.run_id / "ah-standalone"
        oh_root = DATA / "extractions" / args.run_id / "oh-standalone"
        if ah_root.exists() or oh_root.exists():
            raise RuntimeError("Run ID already exists; refuse to mix runs")
        ah_root.mkdir(parents=True)
        oh_root.mkdir(parents=True)
        command(sys.executable, AH, "--artifacts", ah_root)
        command(sys.executable, OH, "--artifacts", oh_root, "--max-days-ahead", "730")
        ah_run = latest_run(ah_root, "*_slots.csv")
        oh_run = latest_run(oh_root, "*_slots.csv")
        ah_raw = next(ah_run.glob("*_slots.csv"))
        oh_raw = next(oh_run.glob("*_slots.csv"))
        ah_summary = next(ah_run.glob("*_flow_summary.json"))
        oh_audit = next(oh_run.glob("*_flow_audit.json"))
        oh_health = next(oh_run.glob("*_run_health.json"))
    else:
        if not all((args.ah_raw, args.oh_raw, args.ah_summary, args.oh_audit, args.oh_health)):
            parser.error("--from-files requires --ah-raw, --oh-raw, --ah-summary, --oh-audit and --oh-health")
        ah_raw, oh_raw, ah_summary, oh_audit, oh_health = map(check_file,
            (args.ah_raw, args.oh_raw, args.ah_summary, args.oh_audit, args.oh_health))
    validate_ah_summary(ah_summary)
    validate_oh(oh_audit, oh_health)
    run = DATA / "runs" / args.run_id
    if run.exists():
        raise RuntimeError(f"Staging run already exists: {run}")
    work = DATA / "extractions" / args.run_id / "standalone-dedup"
    work.mkdir(parents=True, exist_ok=False)
    ah_csv, oh_csv = dedup(ah_raw, oh_raw, work)
    try:
        ah_count = stage_ah(ah_raw, run / "ah")
        oh_count = stage_oh(oh_csv, run / "oh")
        shutil.copy2(oh_audit, run / "oh" / "source-oh-flow-audit.json")
        shutil.copy2(ah_csv, work / "ah-unique-by-duration.csv")
        (run / "oh" / "manifest.json").write_text(json.dumps({
            "status": "imported", "source": {"physicalSlots": oh_count},
            "outputs": ["source-oh-unique-physical-slots.csv", "source-oh-flow-audit.json"]
        }, indent=2), encoding="utf-8")
        print(f"STAGED: AH={ah_count:,}, OH={oh_count:,}; site-compatible inputs at {run}")
        if args.publish:
            build_and_publish(run, args.run_id)
        else:
            print("STAGED ONLY: current/ and public/ unchanged; add --publish to build and audit")
    except Exception:
        print(f"FAILED: inspect staged run {run}; do not publish", file=sys.stderr)
        raise

if __name__ == "__main__":
    main()
