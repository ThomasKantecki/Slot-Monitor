"""Run the complete Cardiology extraction-to-dashboard pipeline."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def run_id() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds").replace(":", "")


def execute(command: list[str], dry_run: bool) -> None:
    print("+ " + subprocess.list2cmdline(command), flush=True)
    if not dry_run: subprocess.run(command, cwd=REPO, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default=run_id())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-slot-loads", type=int, default=1000)
    parser.add_argument("--max-paths", type=int, default=10000)
    parser.add_argument("--request-delay", type=float, default=0.5)
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()
    extraction = REPO / "data" / "cardiology" / "extractions" / args.run_id
    common = ["--run-id", args.run_id, "--max-slot-loads", str(args.max_slot_loads),
              "--max-paths", str(args.max_paths), "--request-delay", str(args.request_delay)]
    for system in ("ah", "oh"):
        execute([sys.executable, str(HERE / "extract_system.py"), "--system", system, *common], args.dry_run)
    ah_json = extraction / "ah" / "ah-cardiology-slots.json"
    oh_csv = extraction / "oh" / "oh-cardiology-slots.csv"
    oh_audit = extraction / "oh" / "oh-cardiology-flow-audit.json"
    oh_unique = extraction / "oh" / "oh-cardiology-unique-physical-slots.csv"
    execute([sys.executable, str(HERE / "deduplicate.py"), "--input", str(oh_csv), "--output", str(oh_unique)], args.dry_run)
    execute(["node", "scripts/build-ah-physical-slots.mjs", "--source", str(ah_json), "--run-id", args.run_id], args.dry_run)
    execute(["node", "scripts/import-oh-physical-slots.mjs", "--source", str(oh_unique), "--audit", str(oh_audit), "--run-id", args.run_id], args.dry_run)
    execute(["node", "scripts/build-cardiology-current.mjs"], args.dry_run)
    if not args.skip_build:
        execute([shutil.which("npm") or "npm", "run", "build"], args.dry_run)
    if not args.dry_run:
        summary = {"status": "complete", "runId": args.run_id, "extraction": str(extraction),
                   "current": str(REPO / "data" / "cardiology" / "current"), "siteBuilt": not args.skip_build}
        (extraction / "refresh-manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary, indent=2))


if __name__ == "__main__": main()
