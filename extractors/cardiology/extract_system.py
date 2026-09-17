"""Run one self-contained Cardiology extractor."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from epic_public import SITES, extract

REPO = Path(__file__).resolve().parents[2]


def run_id() -> str:
    value = datetime.now().astimezone().isoformat(timespec="seconds")
    return re.sub(r":(?![^+-]*$)", "", value).replace(":", "")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--system", choices=sorted(SITES), required=True)
    result.add_argument("--run-id", default="")
    result.add_argument("--output-root", type=Path, default=REPO / "data" / "cardiology" / "extractions")
    result.add_argument("--max-slot-loads", type=int, default=20000)
    result.add_argument("--max-days-ahead", type=int, default=560, help="Stop restarting a stalled search past this many days from the catalog date")
    result.add_argument("--max-paths", type=int, default=10000)
    result.add_argument("--max-depth", type=int, default=50)
    result.add_argument("--max-answers", type=int, default=1000)
    result.add_argument("--request-delay", type=float, default=0.5)
    result.add_argument("--retries", type=int, default=5)
    result.add_argument("--resume", action="store_true", help="Continue an interrupted run from its checkpoint files (same --run-id)")
    result.add_argument("--only-visit", dest="only_visits", action="append", default=None,
                        help="Run only this visit type (repeatable), e.g. to split a system across processes")
    result.add_argument("--only-answer-path", dest="only_answer_paths", action="append", default=None,
                        help='Run only the flows with this questionnaire answer path (a JSON list, repeatable), e.g. to retry a failed flow')
    result.add_argument("--dry-run", action="store_true", help="Validate configuration without contacting either website")
    return result


def main() -> None:
    args = parser().parse_args()
    identifier = args.run_id or run_id()
    output = args.output_root.resolve() / identifier / args.system
    site = SITES[args.system]
    config = {
        "system": site.code, "site": site.name, "specialty": "Cardiology",
        "runId": identifier, "output": str(output), "maxSlotLoads": args.max_slot_loads,
        "maxPaths": args.max_paths, "requestDelay": args.request_delay,
    }
    if args.dry_run:
        print(json.dumps({"status": "dry_run", **config}, indent=2))
        return
    result = extract(site, output, args)
    (output / "extraction-manifest.json").write_text(json.dumps({"status": "complete", **config, **result}, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Extraction interrupted; checkpoint files remain in the run folder.", file=sys.stderr)
        raise SystemExit(130)
