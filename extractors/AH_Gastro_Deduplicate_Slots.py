#!/usr/bin/env python3
"""
Deduplicate the latest AdventHealth Gastroenterology slots CSV.

Physical-slot key:
    provider_id
    + department_id
    + display_datetime_utc
    + length_minutes

The raw extraction is never modified.

Outputs:
    dashboard_slots/current/source-ah-unique-physical-slots.csv
    dashboard_slots/current/deduplication-manifest.json

A timestamped copy is also stored under:
    dashboard_slots/runs/<timestamp>/ah/
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ModuleNotFoundError:
    raise SystemExit(
        "pandas is required. Run with:\n"
        r"C:\Users\PBA96B\.local\bin\uv.exe run --no-project "
        r'--with pandas "AH_Gastro_Deduplicate_Slots.py"'
    )


ROOT = Path(__file__).resolve().parent
OUTPUTS_ROOT = ROOT / "outputs"
DASHBOARD_ROOT = ROOT / "dashboard_slots"

CHUNK_SIZE = 100_000

KEY_COLUMNS = [
    "provider_id",
    "department_id",
    "display_datetime_utc",
    "length_minutes",
]

RAW_COLUMNS_EXCLUDED_FROM_OUTPUT = {
    "specialty",
    "appointment_type",
    "reason_for_visit",
    "decision_tree_path",
    "load_number",
}

DESCRIPTIVE_COLUMNS = [
    "provider_name",
    "provider_id",
    "provider_credentials",
    "location_name",
    "department_id",
    "address",
    "city",
    "state",
    "zip",
    "appointment_date",
    "appointment_time",
    "display_datetime_utc",
    "days_ahead",
    "length_minutes",
    "timezone",
    "source_url",
]


def clean(value) -> str:
    """Return a clean string for a CSV value."""
    if value is None or pd.isna(value):
        return ""

    return str(value).strip()


def latest_slots_csv() -> Path:
    """
    Find the newest non-empty AH slots CSV under the outputs folder.
    """
    files = [
        path
        for path in OUTPUTS_ROOT.rglob("*_slots.csv")
        if path.is_file() and path.stat().st_size > 0
    ]

    if not files:
        raise FileNotFoundError(
            f"No non-empty *_slots.csv files were found under:\n"
            f"{OUTPUTS_ROOT}"
        )

    return max(files, key=lambda path: path.stat().st_mtime)


def physical_slot_id(key: tuple[str, ...]) -> str:
    """
    Create a stable identifier from the physical appointment key.
    """
    key_text = "\x1f".join(key)

    return hashlib.sha256(
        key_text.encode("utf-8")
    ).hexdigest()[:24]


def main() -> None:
    source = latest_slots_csv()

    print(f"Source: {source}")

    records: dict[tuple[str, ...], dict] = {}
    raw_rows_read = 0
    skipped_rows_missing_keys = 0
    source_columns: list[str] | None = None

    chunks = pd.read_csv(
        source,
        dtype=str,
        chunksize=CHUNK_SIZE,
        keep_default_na=False,
        encoding="utf-8-sig",
    )

    for chunk_number, chunk in enumerate(chunks, start=1):
        if source_columns is None:
            source_columns = list(chunk.columns)

            missing_columns = [
                column
                for column in KEY_COLUMNS
                if column not in chunk.columns
            ]

            if missing_columns:
                raise KeyError(
                    "Source CSV is missing required columns: "
                    f"{missing_columns}"
                )

        raw_rows_read += len(chunk)

        for row in chunk.to_dict(orient="records"):
            key = tuple(
                clean(row.get(column))
                for column in KEY_COLUMNS
            )

            if not all(key):
                skipped_rows_missing_keys += 1
                continue

            appointment_type = clean(
                row.get("appointment_type")
            )

            reason_for_visit = clean(
                row.get("reason_for_visit")
            )

            decision_tree_path = clean(
                row.get("decision_tree_path")
            )

            item = records.get(key)

            if item is None:
                item = {
                    column: clean(row.get(column))
                    for column in DESCRIPTIVE_COLUMNS
                    if column in row
                }

                item["physical_slot_id"] = physical_slot_id(key)

                item["matching_appointment_types"] = set()
                item["matching_reasons"] = set()
                item["matching_decision_tree_paths"] = set()

                item["matching_row_count"] = 0

                records[key] = item

            item["matching_row_count"] += 1

            if appointment_type:
                item["matching_appointment_types"].add(
                    appointment_type
                )

            if reason_for_visit:
                item["matching_reasons"].add(
                    reason_for_visit
                )

            if decision_tree_path:
                item["matching_decision_tree_paths"].add(
                    decision_tree_path
                )

        print(
            f"Processed chunk {chunk_number}; "
            f"raw rows read: {raw_rows_read:,}; "
            f"unique physical slots: {len(records):,}"
        )

    output_rows: list[dict] = []

    for item in records.values():
        appointment_types = sorted(
            item.pop("matching_appointment_types")
        )

        reasons = sorted(
            item.pop("matching_reasons")
        )

        decision_tree_paths = sorted(
            item.pop("matching_decision_tree_paths")
        )

        item["matching_appointment_types"] = " | ".join(
            appointment_types
        )

        item["matching_reasons"] = " | ".join(
            reasons
        )

        item["matching_appointment_type_count"] = len(
            appointment_types
        )

        item["matching_reason_count"] = len(
            reasons
        )

        item["matching_decision_tree_path_count"] = len(
            decision_tree_paths
        )

        output_rows.append(item)

    output_rows.sort(
        key=lambda row: (
            row.get("display_datetime_utc", ""),
            row.get("provider_name", ""),
            row.get("department_id", ""),
            row.get("length_minutes", ""),
        )
    )

    generated_at = datetime.now().astimezone()

    run_timestamp = generated_at.strftime(
        "%Y-%m-%dT%H%M%S%z"
    )

    run_directory = (
        DASHBOARD_ROOT
        / "runs"
        / run_timestamp
        / "ah"
    )

    current_directory = (
        DASHBOARD_ROOT
        / "current"
    )

    run_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    current_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_file_name = (
        "source-ah-unique-physical-slots.csv"
    )

    run_output = (
        run_directory
        / output_file_name
    )

    current_output = (
        current_directory
        / output_file_name
    )

    frame = pd.DataFrame(output_rows)

    output_columns = [
        "physical_slot_id",
        *[
            column
            for column in DESCRIPTIVE_COLUMNS
            if column in frame.columns
        ],
        "matching_appointment_types",
        "matching_reasons",
        "matching_row_count",
        "matching_appointment_type_count",
        "matching_reason_count",
        "matching_decision_tree_path_count",
    ]

    output_columns = [
        column
        for column in output_columns
        if column in frame.columns
    ]

    frame = frame[output_columns]

    leaked_columns = (
        RAW_COLUMNS_EXCLUDED_FROM_OUTPUT
        .intersection(frame.columns)
    )

    if leaked_columns:
        raise RuntimeError(
            "Raw extraction columns leaked into "
            f"the final output: {sorted(leaked_columns)}"
        )

    duplicate_key_count = int(
        frame.duplicated(
            subset=KEY_COLUMNS
        ).sum()
    )

    if duplicate_key_count:
        raise RuntimeError(
            "Validation failed: "
            f"{duplicate_key_count:,} duplicate "
            "physical appointment keys remain."
        )

    frame.to_csv(
        run_output,
        index=False,
        encoding="utf-8-sig",
    )

    frame.to_csv(
        current_output,
        index=False,
        encoding="utf-8-sig",
    )

    manifest = {
        "status": "completed",
        "health_system": "AdventHealth",
        "specialty": "Gastroenterology",
        "source": str(source),
        "raw_rows_read": raw_rows_read,
        "rows_skipped_missing_key_values": (
            skipped_rows_missing_keys
        ),
        "unique_physical_slots": len(frame),
        "deduplication_key": KEY_COLUMNS,
        "duplicate_keys_remaining": duplicate_key_count,
        "excluded_final_columns": sorted(
            RAW_COLUMNS_EXCLUDED_FROM_OUTPUT
        ),
        "generated_at": generated_at.isoformat(),
        "run_output": str(run_output),
        "current_output": str(current_output),
    }

    manifest_text = json.dumps(
        manifest,
        indent=2,
        ensure_ascii=False,
    )

    run_manifest = (
        run_directory
        / "deduplication-manifest.json"
    )

    current_manifest = (
        current_directory
        / "deduplication-manifest.json"
    )

    run_manifest.write_text(
        manifest_text,
        encoding="utf-8",
    )

    current_manifest.write_text(
        manifest_text,
        encoding="utf-8",
    )

    print()
    print("DONE")
    print(f"Raw rows read: {raw_rows_read:,}")
    print(
        "Rows skipped due to missing key values: "
        f"{skipped_rows_missing_keys:,}"
    )
    print(
        f"Unique physical slots: {len(frame):,}"
    )
    print(
        "Duplicate physical keys remaining: "
        f"{duplicate_key_count:,}"
    )
    print(f"Run output: {run_output}")
    print(f"Current output: {current_output}")
    print(f"Manifest: {current_manifest}")


if __name__ == "__main__":
    main()