"""Collapse flow-level rows into physical appointments without pandas."""
from __future__ import annotations

import argparse
import csv
import hashlib
from collections import defaultdict
from pathlib import Path

PHYSICAL_KEY = ("provider_id", "department_id", "display_datetime_utc")
FLOW_FIELDS = ("flow_id", "questionnaire_path", "reason_for_visit", "visit_type", "appointment_type", "load_number")


def slot_id(row: dict[str, str]) -> str:
    raw = "\x1f".join(" ".join(row.get(field, "").strip().split()) for field in PHYSICAL_KEY)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def deduplicate(source: Path, output: Path) -> tuple[int, int]:
    with source.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle); source_fields = reader.fieldnames or []; rows = list(reader)
    missing = [field for field in PHYSICAL_KEY if field not in source_fields]
    if missing: raise ValueError("Missing physical-slot fields: " + ", ".join(missing))
    groups: dict[tuple[str, ...], list[dict[str, str]]] = defaultdict(list)
    for row in rows: groups[tuple(row.get(field, "").strip() for field in PHYSICAL_KEY)].append(row)
    unique = []
    for key, matches in groups.items():
        row = {field: value.strip() for field, value in matches[0].items()}
        row["physical_slot_id"] = slot_id(row)
        row["matching_row_count"] = str(len(matches))
        for field, target in (("flow_id", "matching_flow_count"), ("questionnaire_path", "matching_questionnaire_path_count"),
                              ("reason_for_visit", "matching_reason_count"), ("visit_type", "matching_visit_type_count")):
            row[target] = str(len({item.get(field, "").strip() for item in matches if item.get(field, "").strip()}))
        row["matching_reasons"] = "|".join(sorted({item.get("reason_for_visit", "").strip() for item in matches if item.get("reason_for_visit", "").strip()}))
        row["matching_visit_types"] = "|".join(sorted({item.get("visit_type", "").strip() for item in matches if item.get("visit_type", "").strip()}))
        for field in FLOW_FIELDS: row.pop(field, None)
        unique.append(row)
    unique.sort(key=lambda row: (row.get("display_datetime_utc", ""), row.get("provider_name", ""), row.get("department_id", "")))
    metric_fields = ["matching_row_count", "matching_flow_count", "matching_questionnaire_path_count", "matching_reason_count", "matching_visit_type_count"]
    fields = ["physical_slot_id", *[field for field in source_fields if field not in FLOW_FIELDS], "matching_reasons", "matching_visit_types", *metric_fields]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader(); writer.writerows(unique)
    return len(rows), len(unique)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(); source, output = args.input.resolve(), args.output.resolve()
    if not source.is_file(): raise FileNotFoundError(source)
    total, unique = deduplicate(source, output)
    print(f"Deduplicated {total:,} flow rows into {unique:,} physical slots: {output}")


if __name__ == "__main__": main()
