"""AdventHealth Cardiology-only exhaustive public-scheduling runner.

This is a safe wrapper around the existing validated extraction engines:
    epic_scheduling_extractor_AH.py
    epic_scheduling_extractor_OH.py

Place all three files in the same project folder. This runner does not book,
hold, authenticate, or submit patient information. It limits the catalog to
exactly Cardiology, preserves every appointment type returned by the shared
engine, raises pagination safeguards, enables checkpoint-friendly outputs when
supported, and audits the runtime configuration before extraction.

Important: exhaustive means every Cardiology flow exposed to the anonymous
public workflow and handled by the shared engine. Server-hidden, authenticated,
or unavailable branches cannot be enumerated by a public anonymous client.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys
import time
from pathlib import Path
from typing import Any

AH_ENGINE = "epic_scheduling_extractor_AH"
SHARED_ENGINE = "epic_scheduling_extractor_OH"
SPECIALTY = "Cardiology"
OUTPUT_ROOT = "AH_cardiology_exhaustive_outputs"
# DEFAULT_MAX_SLOT_LOADS = 1000  # Original safety ceiling; restore to roll back.
# Temporary AH-only deep run: retain a finite brake, but allow pagination beyond
# the prior cutoff so later availability can be measured.
DEFAULT_MAX_SLOT_LOADS = 10_000
DEFAULT_PROGRESS_EVERY = 10


def run_folder_name() -> str:
    """Return a deterministic, readable folder name for this run."""
    return time.strftime("%d%b").lower() + "_AH_cardio_exhaustive_" + time.strftime("%H%M%S")


def project_python(script: Path) -> Path | None:
    """Return the local project virtual-environment interpreter when present."""
    candidate = script.parent / ".venv" / "Scripts" / "python.exe"
    return candidate if candidate.is_file() else None


def relaunch_in_project_venv() -> None:
    """Use the project .venv so imports and dependencies are deterministic."""
    script = Path(__file__).resolve()
    interpreter = project_python(script)
    if interpreter is None:
        return
    current = Path(sys.executable).resolve()
    if interpreter.resolve() != current:
        os.execv(str(interpreter), [str(interpreter), str(script), *sys.argv[1:]])


def import_engine(name: str) -> Any:
    """Import an engine with a clear error when the required file is absent."""
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError as error:
        if error.name == name:
            raise SystemExit(
                f"Missing required file: {name}.py\n"
                f"Place AH_cardiology_exhaustive.py beside {AH_ENGINE}.py and {SHARED_ENGINE}.py."
            ) from error
        raise


def set_when_present(module: Any, name: str, value: Any) -> bool:
    """Set a supported engine option without inventing a required interface."""
    if hasattr(module, name):
        setattr(module, name, value)
        return True
    return False


def configure_engines(ah: Any, epic: Any, args: argparse.Namespace) -> list[str]:
    """Configure exact Cardiology scope and robust extraction safeguards."""
    if not hasattr(ah, "configure_adventhealth"):
        raise SystemExit(f"{AH_ENGINE}.py is missing configure_adventhealth().")
    if not hasattr(epic, "main"):
        raise SystemExit(f"{SHARED_ENGINE}.py is missing main().")

    ah.configure_adventhealth()

    changes: list[str] = []
    required = {
        "SITE_CODE": "AH_CARD_EXHAUSTIVE",
        "SPECIALTY_ALLOWLIST": {SPECIALTY},
        "extraction_folder_name": run_folder_name,
    }
    for name, value in required.items():
        setattr(epic, name, value)
        changes.append(name)

    # Enable exhaustive behavior only for options the installed engine supports.
    optional_settings = {
        "EXACT_SPECIALTY_MATCH": True,
        "INCLUDE_ALL_VISIT_TYPES": True,
        "VISIT_TYPE_ALLOWLIST": None,
        "INCLUDE_ALL_REASONS_FOR_VISIT": True,
        "ENUMERATE_DECISION_TREE_BRANCHES": True,
        "INCLUDE_TERMINAL_BRANCHES_IN_AUDIT": True,
        "DEDUPLICATE_PHYSICAL_SLOTS": True,
        "CHECKPOINT_AFTER_EACH_FLOW": True,
        "RESUME_FROM_CHECKPOINT": args.resume,
        "MAX_PAGINATED_SLOT_LOADS": args.max_slot_loads,
        "SLOT_PROGRESS_EVERY": args.progress_every,
        "REQUEST_DELAY_SECONDS": args.request_delay,
        "MAX_REQUEST_RETRIES": args.max_retries,
    }
    for name, value in optional_settings.items():
        if set_when_present(epic, name, value):
            changes.append(name)

    return changes


def append_cli_defaults(args: argparse.Namespace) -> None:
    """Pass supported command-line controls to the shared engine."""
    additions: list[str] = []
    if "--artifacts" not in sys.argv:
        additions += ["--artifacts", str(args.artifacts)]
    if "--max-slot-loads" not in sys.argv:
        additions += ["--max-slot-loads", str(args.max_slot_loads)]
    if "--slot-progress-every" not in sys.argv:
        additions += ["--slot-progress-every", str(args.progress_every)]
    sys.argv.extend(additions)


def audit_configuration(epic: Any, changes: list[str], args: argparse.Namespace) -> None:
    """Print exactly what is guaranteed and what depends on engine support."""
    print("AdventHealth exhaustive Cardiology public-scheduling run", flush=True)
    print(f"PASS specialty scope: exact {SPECIALTY}", flush=True)
    print(f"PASS output root: {args.artifacts}", flush=True)
    print(f"PASS maximum slot-page guard: {args.max_slot_loads}", flush=True)
    print(f"PASS shared engine: {Path(epic.__file__).name}", flush=True)
    print("PASS configured options: " + ", ".join(sorted(changes)), flush=True)

    capabilities = {
        "all visit types": "INCLUDE_ALL_VISIT_TYPES",
        "all reasons for visit": "INCLUDE_ALL_REASONS_FOR_VISIT",
        "decision-tree branch enumeration": "ENUMERATE_DECISION_TREE_BRANCHES",
        "checkpoint after each flow": "CHECKPOINT_AFTER_EACH_FLOW",
        "physical-slot deduplication": "DEDUPLICATE_PHYSICAL_SLOTS",
    }
    unsupported = [label for label, attribute in capabilities.items() if not hasattr(epic, attribute)]
    if unsupported:
        print(
            "NOTICE engine has no explicit switches for: " + ", ".join(unsupported) + ".",
            flush=True,
        )
        print(
            "NOTICE those behaviors depend on the installed shared engine implementation and its flow audit.",
            flush=True,
        )


def parse_runner_args() -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--artifacts", default=OUTPUT_ROOT)
    parser.add_argument("--max-slot-loads", type=int, default=DEFAULT_MAX_SLOT_LOADS)
    parser.add_argument("--progress-every", type=int, default=DEFAULT_PROGRESS_EVERY)
    parser.add_argument("--request-delay", type=float, default=0.5)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--resume", action="store_true")
    return parser.parse_known_args()


def main() -> None:
    # Make the file runnable directly from an IDE, regardless of its current
    # working directory. The shared extractor modules live beside this file.
    os.chdir(Path(__file__).resolve().parent)
    relaunch_in_project_venv()
    args, engine_args = parse_runner_args()

    # Rebuild argv so the shared engine sees only its own supported arguments.
    sys.argv = [sys.argv[0], *engine_args]

    ah = import_engine(AH_ENGINE)
    epic = import_engine(SHARED_ENGINE)
    changes = configure_engines(ah, epic, args)
    append_cli_defaults(args)
    audit_configuration(epic, changes, args)
    epic.main()


if __name__ == "__main__":
    main()

#".venv\Scripts\python.exe" "AH_cardiology_exhaustive.py"
