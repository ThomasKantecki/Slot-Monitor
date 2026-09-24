"""Build a dashboard-ready, deduplicated Orlando Health Gastroenterology slot CSV.

Run from any folder:
    python build_oh_gastro_dashboard_slots.py

The script:
1. Finds the newest OH Gastroenterology *_slots.csv output automatically.
2. Reads the large file in chunks.
3. Deduplicates physical appointments by provider_id + department_id + display_datetime_utc.
4. Aggregates all matching GI diagnoses/questionnaire paths for each appointment.
5. Writes a CSV shaped like v5's source-oh-unique-physical-slots.csv.
"""
from __future__ import annotations

import ast
import csv
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ModuleNotFoundError as exc:
    raise SystemExit(
        "pandas is required. Run with:\n"
        "C:\\Users\\PBA96B\\.local\\bin\\uv.exe run --no-project --with pandas "
        "build_oh_gastro_dashboard_slots.py"
    ) from exc

ROOT = Path(r"C:\Users\PBA96B\OneDrive - AdventHealth\Documents\competitor scraper")
OUTPUTS_ROOT = ROOT / "gastroenterology" / "OH_gastroenterology_all_public_flows_outputs"
V5_ROOT = ROOT / "gastroenterology" / "dashboard_slots"
CHUNK_SIZE = 100_000

KEY_COLUMNS = ["provider_id", "department_id", "display_datetime_utc", "length_minutes"]
OUTPUT_COLUMNS = [
    "physical_slot_id",
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
    "matching_reasons",
    "matching_visit_types",
    "matching_row_count",
    "matching_flow_count",
    "matching_questionnaire_path_count",
    "matching_reason_count",
    "matching_visit_type_count",
]


def latest_slots_csv() -> Path:
    files = [path for path in OUTPUTS_ROOT.rglob("*_slots.csv") if path.is_file() and path.stat().st_size > 0]
    if not files:
        raise FileNotFoundError(f"No *_slots.csv files found under {OUTPUTS_ROOT}")
    return max(files, key=lambda path: path.stat().st_mtime)
def clean(value: object) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def parse_questionnaire_path(value: object) -> list[str]:
    text = clean(value)
    if not text:
        return []
    for parser in (json.loads, ast.literal_eval):
        try:
            parsed = parser(text)
            if isinstance(parsed, list):
                return [clean(item) for item in parsed if clean(item)]
        except Exception:
            pass
    if "=>" in text:
        return [part.strip() for part in text.split("|") if part.strip()]
    return [text]


def diagnosis_from_row(row: dict[str, object]) -> str:
    path = parse_questionnaire_path(row.get("questionnaire_path", ""))

    # Prefer the explicit answer to the diagnosis question.
    for item in path:
        text = clean(item)
        if "=>" in text:
            question, answer = (part.strip() for part in text.split("=>", 1))
            if "diagnos" in question.casefold() and answer:
                return answer

    # Support paths stored as answer-only lists.
    ignored_exact = {
        "18 years old and older", "no", "other/none", "none",
        "i acknowledge", "yes", "any location",
    }
    candidates: list[str] = []
    for item in path:
        text = clean(item)
        if not text:
            continue
        answer = text.split("=>", 1)[-1].strip() if "=>" in text else text
        folded = answer.casefold()
        whole = text.casefold()
        if folded in ignored_exact:
            continue
        if "disclaimer" in whole or "acknowledge" in whole:
            continue
        candidates.append(answer)
    if candidates:
        return candidates[-1]

    reason = clean(row.get("reason_for_visit", ""))
    if reason and reason.casefold() != "gi new patient":
        return reason
    return ""
def stable_slot_id(provider_id: str, department_id: str, utc_time: str, length_minutes: str) -> str:
    raw = "|".join((provider_id, department_id, utc_time, length_minutes)).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:24]


def append_unique(values: list[str], value: str) -> None:
    if value and value not in values:
        values.append(value)


def build() -> tuple[Path, Path, int, int]:
    source = latest_slots_csv()
    print(f"Source: {source}")

    required = set(KEY_COLUMNS)
    appointments: dict[tuple[str, ...], dict[str, object]] = {}
    raw_rows = 0

    for chunk_number, chunk in enumerate(
        pd.read_csv(source, dtype=str, keep_default_na=False, chunksize=CHUNK_SIZE), start=1
    ):
        missing = required - set(chunk.columns)
        if missing:
            raise ValueError(f"Source is missing required columns: {sorted(missing)}")

        for row in chunk.to_dict(orient="records"):
            raw_rows += 1
            key = tuple(clean(row.get(column, "")) for column in KEY_COLUMNS)
            if not all(key):
                continue

            provider_id, department_id, utc_time, length_minutes = key
            path_text = clean(row.get("questionnaire_path", ""))
            diagnosis = diagnosis_from_row(row)
            visit_type = clean(row.get("visit_type", "")) or clean(row.get("reason_for_visit", ""))
            flow_id = clean(row.get("flow_id", ""))

            if key not in appointments:
                appointments[key] = {
                    "physical_slot_id": stable_slot_id(provider_id, department_id, utc_time, length_minutes),
                    "specialty": "Gastroenterology",
                    "provider_name": clean(row.get("provider_name", "")),
                    "provider_id": provider_id,
                    "provider_credentials": clean(row.get("provider_credentials", "")),
                    "location_name": clean(row.get("location_name", "")),
                    "department_id": department_id,
                    "address": clean(row.get("address", "")),
                    "city": clean(row.get("city", "")),
                    "state": clean(row.get("state", "")),
                    "zip": clean(row.get("zip", "")),
                    "appointment_date": clean(row.get("appointment_date", "")),
                    "appointment_time": clean(row.get("appointment_time", "")),
                    "display_datetime_utc": utc_time,
                    "days_ahead": clean(row.get("days_ahead", "")),
                    "length_minutes": length_minutes,
                    "timezone": clean(row.get("timezone", "")),
                    "source_url": clean(row.get("source_url", "")),
                    "_reasons": [],
                    "_visit_types": [],
                    "_flows": [],
                    "_paths": [],
                    "matching_row_count": 0,
                }

            item = appointments[key]
            item["matching_row_count"] = int(item["matching_row_count"]) + 1
            append_unique(item["_reasons"], diagnosis)
            append_unique(item["_visit_types"], visit_type)
            append_unique(item["_flows"], flow_id)
            append_unique(item["_paths"], path_text)

        print(f"Processed chunk {chunk_number:,}; raw rows read: {raw_rows:,}; unique slots: {len(appointments):,}")

    rows: list[dict[str, object]] = []
    for item in appointments.values():
        reasons = item.pop("_reasons")
        visit_types = item.pop("_visit_types")
        flows = item.pop("_flows")
        paths = item.pop("_paths")
        item.update({
            "matching_reasons": " | ".join(reasons),
            "matching_visit_types": " | ".join(visit_types),
            "matching_flow_count": len(flows),
            "matching_questionnaire_path_count": len(paths),
            "matching_reason_count": len(reasons),
            "matching_visit_type_count": len(visit_types),
        })
        rows.append({column: item.get(column, "") for column in OUTPUT_COLUMNS})

    rows.sort(key=lambda row: (
        str(row["display_datetime_utc"]), str(row["provider_name"]), str(row["location_name"])
    ))

    run_id = datetime.now().astimezone().strftime("%Y-%m-%dT%H%M%S%z")
    run_dir = V5_ROOT / "runs" / run_id / "oh"
    current_dir = V5_ROOT / "current"
    run_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    run_file = run_dir / "source-oh-unique-physical-slots.csv"
    current_file = current_dir / "source-oh-unique-physical-slots.csv"

    for destination in (run_file, current_file):
        with destination.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=OUTPUT_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)

    manifest = {
        "status": "completed",
        "specialty": "Gastroenterology",
        "health_system": "Orlando Health",
        "source": str(source),
        "raw_rows_read": raw_rows,
        "unique_physical_slots": len(rows),
        "deduplication_key": KEY_COLUMNS,
        "generated_at": datetime.now().astimezone().isoformat(),
        "run_output": str(run_file),
        "current_output": str(current_file),
    }
    manifest_file = run_dir / "deduplication-manifest.json"
    manifest_file.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (current_dir / "deduplication-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    return run_file, current_file, raw_rows, len(rows)


if __name__ == "__main__":
    run_file, current_file, raw_count, unique_count = build()
    print("\nDONE")
    print(f"Raw rows read: {raw_count:,}")
    print(f"Unique physical slots: {unique_count:,}")
    print(f"Run output: {run_file}")
    print(f"Current output: {current_file}")
