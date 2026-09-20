"""Run the complete Cardiology extraction-to-dashboard pipeline."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def run_id() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds").replace(":", "")


# The promote and site-build steps hold every physical slot in memory (about 1 GB of JSON for a full
# AdventHealth run); Node's default heap is 2 GB on an 8 GB machine, so both get the same 6 GB heap as
# the AdventHealth import.
NODE_HEAP = "--max-old-space-size=6144"


def execute(command: list[str], dry_run: bool, node_heap: bool = False) -> None:
    print("+ " + subprocess.list2cmdline(command), flush=True)
    env = {**os.environ, "NODE_OPTIONS": NODE_HEAP} if node_heap else None
    if not dry_run: subprocess.run(command, cwd=REPO, check=True, env=env)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", default=run_id())
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-slot-loads", type=int, default=20000)
    parser.add_argument("--max-paths", type=int, default=10000)
    parser.add_argument("--request-delay", type=float, default=0.5)
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()
    extraction = REPO / "data" / "cardiology" / "extractions" / args.run_id
    common = ["--run-id", args.run_id, "--max-slot-loads", str(args.max_slot_loads),
              "--max-paths", str(args.max_paths), "--request-delay", str(args.request_delay)]
    # The two systems are different hosts and each takes hours, so they are pulled side by side.
    commands = {system: [sys.executable, str(HERE / "extract_system.py"), "--system", system, *common] for system in ("ah", "oh")}
    for command in commands.values(): print("+ " + subprocess.list2cmdline(command), flush=True)
    if not args.dry_run:
        processes = {system: subprocess.Popen(command, cwd=REPO) for system, command in commands.items()}
        failed = [system for system, process in processes.items() if process.wait() != 0]
        if failed: raise SystemExit(f"Extraction failed for: {', '.join(failed)}")
    ah_json = extraction / "ah" / "ah-cardiology-slots.json"
    oh_csv = extraction / "oh" / "oh-cardiology-slots.csv"
    oh_audit = extraction / "oh" / "oh-cardiology-flow-audit.json"
    oh_unique = extraction / "oh" / "oh-cardiology-unique-physical-slots.csv"
    execute([sys.executable, str(HERE / "deduplicate.py"), "--input", str(oh_csv), "--output", str(oh_unique)], args.dry_run)
    # the per-flow part files are streamed; a full AH run's single slots.json is too large to read as one string
    ah_parts = extraction / "ah" / "parts"
    execute(["node", "--max-old-space-size=6144", "scripts/build-ah-physical-slots.mjs", "--source", str(ah_parts if ah_parts.exists() or args.dry_run else ah_json), "--run-id", args.run_id], args.dry_run)
    execute(["node", "scripts/import-oh-physical-slots.mjs", "--source", str(oh_unique), "--audit", str(oh_audit), "--run-id", args.run_id], args.dry_run)
    execute(["node", NODE_HEAP, "scripts/build-cardiology-current.mjs"], args.dry_run)
    if not args.skip_build:
        execute([shutil.which("npm") or "npm", "run", "build"], args.dry_run, node_heap=True)
    if not args.dry_run:
        summary = {"status": "complete", "runId": args.run_id, "extraction": str(extraction),
                   "current": str(REPO / "data" / "cardiology" / "current"), "siteBuilt": not args.skip_build}
        (extraction / "refresh-manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary, indent=2))


if __name__ == "__main__": main()
