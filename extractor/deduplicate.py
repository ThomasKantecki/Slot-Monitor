"""Collapse flow-level rows into physical appointments without pandas."""
from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path
from typing import Any

PHYSICAL_KEY = ("provider_id", "department_id", "display_datetime_utc")
FLOW_FIELDS = ("flow_id", "questionnaire_path", "reason_for_visit", "visit_type", "appointment_type", "load_number")
COUNTED = ("flow_id", "questionnaire_path", "reason_for_visit", "visit_type")  # distinct values kept per physical slot


def slot_id(row: dict[str, str]) -> str:
    raw = "\x1f".join(" ".join(row.get(field, "").strip().split()) for field in PHYSICAL_KEY)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def deduplicate(source: Path, output: Path) -> tuple[int, int]:
    """One pass over the rows: each physical slot keeps its first row and the distinct values of the counted fields,
    so memory grows with the slots, not the rows. A questionnaire whose paths all share one search lists every slot
    once per path (Orlando Health gastroenterology, 2026-09-22: 131 paths, 669,000 rows for 5,105 openings, which
    held in memory at once needed about 4.4 GB)."""
    total = 0
    groups: dict[tuple[str, ...], dict[str, Any]] = {}
    with source.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle); source_fields = reader.fieldnames or []
        missing = [field for field in PHYSICAL_KEY if field not in source_fields]
        if missing: raise ValueError("Missing physical-slot fields: " + ", ".join(missing))
        for item in reader:
            total += 1
            group = groups.setdefault(tuple(item.get(field, "").strip() for field in PHYSICAL_KEY), {"first": item, "rows": 0, **{field: set() for field in COUNTED}})
            group["rows"] += 1
            for field in COUNTED:
                if item.get(field, "").strip(): group[field].add(item.get(field, "").strip())
    unique = []
    for key, group in groups.items():
        row = {field: value.strip() for field, value in group["first"].items()}
        row["physical_slot_id"] = slot_id(row)
        row["matching_row_count"] = str(group["rows"])
        for field, target in (("flow_id", "matching_flow_count"), ("questionnaire_path", "matching_questionnaire_path_count"),
                              ("reason_for_visit", "matching_reason_count"), ("visit_type", "matching_visit_type_count")):
            row[target] = str(len(group[field]))
        row["matching_reasons"] = "|".join(sorted(group["reason_for_visit"]))
        row["matching_visit_types"] = "|".join(sorted(group["visit_type"]))
        for field in FLOW_FIELDS: row.pop(field, None)
        unique.append(row)
    unique.sort(key=lambda row: (row.get("display_datetime_utc", ""), row.get("provider_name", ""), row.get("department_id", "")))
    metric_fields = ["matching_row_count", "matching_flow_count", "matching_questionnaire_path_count", "matching_reason_count", "matching_visit_type_count"]
    fields = ["physical_slot_id", *[field for field in source_fields if field not in FLOW_FIELDS], "matching_reasons", "matching_visit_types", *metric_fields]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(unique)
    return total, len(unique)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); source, output = args.input.resolve(), args.output.resolve()
    if not source.is_file(): raise FileNotFoundError(source)
    total, unique = deduplicate(source, output)
    print(f"Deduplicated {total:,} flow rows into {unique:,} physical slots: {output}")


if __name__ == "__main__": main()
