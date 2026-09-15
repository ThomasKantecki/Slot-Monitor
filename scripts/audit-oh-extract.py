"""Compare an OH extractor output with the currently trusted OH physical-slot file."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def text(value: object) -> str:
    return str(value or "").strip()


def profile(path: Path) -> tuple[dict, set[tuple[str, str, str]]]:
    raw_rows = 0
    physical: set[tuple[str, str, str]] = set()
    providers: set[str] = set()
    facilities: set[str] = set()
    years: Counter[str] = Counter()
    dates: list[str] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            raw_rows += 1
            if text(row.get("state")).upper() != "FL":
                continue
            provider = text(row.get("provider_id"))
            facility = text(row.get("facility_id") or row.get("department_id"))
            utc = text(row.get("display_datetime_utc"))
            if not provider or not facility or not utc:
                continue
            key = (provider, facility, utc)
            if key in physical:
                continue
            physical.add(key)
            providers.add(provider)
            facilities.add(facility)
            date = utc[:10]
            dates.append(date)
            years[date[:4]] += 1
    return {
        "sourceRows": raw_rows,
        "physicalSlots": len(physical),
        "providers": len(providers),
        "facilities": len(facilities),
        "minDate": min(dates, default=""),
        "maxDate": max(dates, default=""),
        "yearCounts": dict(sorted(years.items())),
    }, physical


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--latest", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--flow-audit", type=Path)
    parser.add_argument("--baseline-flow-audit", type=Path)
    args = parser.parse_args()
    latest, latest_keys = profile(args.latest)
    baseline, baseline_keys = profile(args.baseline)
    comparison = {
        "retainedFromBaseline": len(latest_keys & baseline_keys),
        "newVsBaseline": len(latest_keys - baseline_keys),
        "missingFromBaseline": len(baseline_keys - latest_keys),
    }
    report = {"latest": latest, "baseline": baseline, "comparison": comparison}
    def summarize_flows(path: Path) -> dict:
        flows = json.loads(path.read_text(encoding="utf-8"))
        statuses = Counter(text(flow.get("status")) or "unknown" for flow in flows)
        return {
            "flows": len(flows),
            "statuses": dict(sorted(statuses.items())),
            "maxLoadsCompleted": max((int(flow.get("loads_completed") or 0) for flow in flows), default=0),
        }
    if args.flow_audit:
        report["flowAudit"] = summarize_flows(args.flow_audit)
    if args.baseline_flow_audit:
        report["baselineFlowAudit"] = summarize_flows(args.baseline_flow_audit)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
