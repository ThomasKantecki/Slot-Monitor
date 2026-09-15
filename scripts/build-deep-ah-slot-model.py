"""Build the dashboard model from a large AH CSV without loading raw JSON.

Usage:
  python scripts/build-deep-ah-slot-model.py --ah-source <AH raw slots CSV> --oh-source <OH physical slots CSV>
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CURRENT = ROOT / "data" / "cardiology" / "current"
PUBLIC_DATA = ROOT / "public" / "data" / "cardiology"


def clean(value: object) -> str:
    return str(value or "").strip()


def pieces(value: object) -> set[str]:
    return {item.strip() for item in clean(value).split("|") if item.strip()}


def add_row(groups: dict, system: str, row: dict[str, str]) -> None:
    provider_id = clean(row.get("provider_id"))
    facility_id = clean(row.get("facility_id") or row.get("department_id"))
    utc = clean(row.get("display_datetime_utc"))
    if not provider_id or not facility_id or not utc or clean(row.get("state")).upper() != "FL":
        return
    key = (system, provider_id, facility_id, utc)
    group = groups.get(key)
    if group is None:
        group = {
            "system": system,
            "provider_id": provider_id,
            "provider_name": clean(row.get("provider_name")) or "Provider not listed",
            "provider_credentials": clean(row.get("provider_credentials")),
            "facility_id": facility_id,
            "facility_name": clean(row.get("facility_name") or row.get("location_name")) or "Location not listed",
            "address": clean(row.get("address")),
            "city": clean(row.get("city")),
            "zip": clean(row.get("zip"))[:5],
            "utc": utc,
            "appointment_time": clean(row.get("appointment_time")),
            "duration": clean(row.get("duration_minutes") or row.get("length_minutes")),
            "types": set(),
            "reasons": set(),
        }
        groups[key] = group
    group["types"].update(pieces(row.get("appointment_types") or row.get("booking_categories") or row.get("appointment_type") or row.get("visit_type") or row.get("visit_types") or row.get("matching_visit_types")))
    group["reasons"].update(pieces(row.get("reasons") or row.get("reason_for_visit") or row.get("matching_reasons")))


def ingest(groups: dict, path: Path, system: str) -> int:
    rows = 0
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            rows += 1
            add_row(groups, system, row)
    return rows


def build_model(groups: dict, zip_county: dict[str, str]) -> dict:
    type_list = sorted({item for group in groups.values() for item in group["types"]})
    reason_list = sorted({item for group in groups.values() for item in group["reasons"]})
    type_index = {value: index for index, value in enumerate(type_list)}
    reason_index = {value: index for index, value in enumerate(reason_list)}
    provider_index: dict[tuple[str, str], int] = {}
    facility_index: dict[tuple[str, str], int] = {}
    providers, facilities, slots = [], [], []

    for group in groups.values():
        provider_key = (group["system"], group["provider_id"])
        if provider_key not in provider_index:
            provider_index[provider_key] = len(providers)
            providers.append({"i": group["provider_id"], "y": group["system"], "n": group["provider_name"], "c": group["provider_credentials"]})
        facility_key = (group["system"], group["facility_id"])
        if facility_key not in facility_index:
            facility_index[facility_key] = len(facilities)
            facilities.append({"i": group["facility_id"], "y": group["system"], "n": group["facility_name"], "a": group["address"], "c": group["city"], "z": group["zip"], "ct": zip_county.get(group["zip"], "")})
        slots.append({
            "y": group["system"], "p": provider_index[provider_key], "f": facility_index[facility_key],
            "d": group["utc"][:10], "t": group["appointment_time"], "u": group["utc"], "l": group["duration"],
            "ty": [type_index[item] for item in sorted(group["types"])],
            "rv": [reason_index[item] for item in sorted(group["reasons"])],
        })

    slots.sort(key=lambda slot: (slot["u"], slot["y"]))
    zip_areas: dict[str, dict[str, int]] = {}
    county_areas: dict[str, dict[str, int]] = {}
    totals = {"ah": 0, "oh": 0}
    max_date = {"ah": "", "oh": ""}
    for slot in slots:
        system = slot["y"]
        totals[system] += 1
        max_date[system] = max(max_date[system], slot["d"])
        facility = facilities[slot["f"]]
        zip_areas.setdefault(facility["z"], {"ah": 0, "oh": 0})[system] += 1
        if facility["ct"]:
            county_areas.setdefault(facility["ct"], {"ah": 0, "oh": 0})[system] += 1
    dates = sorted(value for value in max_date.values() if value)
    return {
        "types": type_list, "reasons": reason_list, "providers": providers, "facilities": facilities, "slots": slots,
        "areas": {"zip": zip_areas, "county": county_areas}, "totals": totals,
        "minDate": slots[0]["d"] if slots else "", "maxDate": slots[-1]["d"] if slots else "",
        "maxDateBySystem": max_date, "commonMaxDate": dates[0] if dates else "",
    }


def write_partitions(model: dict) -> None:
    """Publish a small model summary plus one static file per bookable date.

    The full model stays local for audit/build purposes. Browser pages load only
    the selected dates instead of embedding every appointment in their HTML.
    """
    slots_dir = PUBLIC_DATA / "slots"
    slots_dir.mkdir(parents=True, exist_ok=True)
    for path in slots_dir.glob("*.json"):
        path.unlink()

    by_date: dict[str, list[dict]] = {}
    for slot in model["slots"]:
        by_date.setdefault(slot["d"], []).append(slot)
    dates = sorted(by_date)
    summary = {key: value for key, value in model.items() if key not in {"slots", "areas"}}
    summary.update({"partitionVersion": 1, "partitionDates": dates, "totalPhysicalSlots": len(model["slots"])})
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA / "slot-times-summary.json").write_text(json.dumps(summary, separators=(",", ":")) + "\n", encoding="utf-8")
    for date, slots in by_date.items():
        (slots_dir / f"{date}.json").write_text(json.dumps({"date": date, "slots": slots}, separators=(",", ":")) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ah-source", required=True, type=Path)
    parser.add_argument("--oh-source", required=True, type=Path)
    args = parser.parse_args()
    groups: dict = {}
    ah_rows = ingest(groups, args.ah_source, "ah")
    oh_rows = ingest(groups, args.oh_source, "oh")
    zip_county = json.loads((ROOT / "data" / "zip-county.json").read_text(encoding="utf-8"))
    model = build_model(groups, zip_county)
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    ah_run_id = args.ah_source.resolve().parent.name
    oh_run_id = args.oh_source.resolve().parent.name
    manifest = {
        "status": "completed_with_warnings",
        "scope": "Florida Cardiology public appointment availability",
        "generatedAt": generated,
        "ah": {"runId": ah_run_id, "source": str(args.ah_source), "physicalSlots": model["totals"]["ah"], "bookingCategoriesRetained": True, "warning": "Specialists flow reached the temporary 10,000-page ceiling; New Patient ended after an AH non-JSON response."},
        "oh": {"runId": oh_run_id, "source": str(args.oh_source), "physicalSlots": model["totals"]["oh"], "bookingCategoriesRetained": True, "warning": "Physical-slot coverage passed the Sep 13 comparison; 28 questionnaire flows errored before slots, 14 slot flows preserved partial results after non-JSON responses, and 2 flows reached the 1,000-page guard."},
        "totalPhysicalSlots": len(model["slots"]),
        "modelSource": "streamed-large-ah-csv",
    }
    model.update({"generatedAt": generated, "status": manifest["status"], "scope": manifest["scope"], "sources": {"ah": manifest["ah"], "oh": manifest["oh"]}})
    CURRENT.mkdir(parents=True, exist_ok=True)
    with (CURRENT / "slot-times-model.json").open("w", encoding="utf-8") as handle:
        json.dump(model, handle, separators=(",", ":"))
        handle.write("\n")
    (CURRENT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    write_partitions(model)
    print(f"Built {len(model['slots']):,} physical slots ({model['totals']['ah']:,} AH, {model['totals']['oh']:,} OH) from {ah_rows:,} AH and {oh_rows:,} OH source rows.")


if __name__ == "__main__":
    main()
