"""AdventHealth Epic/MyChart public open-scheduling extractor.

This site-specific entry point reuses the validated Epic extraction engine in
``epic_scheduling_extractor_OH.py`` while keeping AdventHealth outputs isolated.
Running this file with no arguments performs direct anonymous API extraction;
it does not book, hold, or submit an appointment.
"""

from __future__ import annotations

import sys
import time

import epic_scheduling_extractor_OH as epic


SITE_ROOT = "https://mychart.adventhealth.com"
APP_ROOT = "/mychartprd"
OPEN_SCHEDULING_URL = SITE_ROOT + APP_ROOT + "/openscheduling/"

# Exact AdventHealth counterparts for Orlando Health's nine public categories.
# Combined OH categories require multiple AH specialties, producing 13 source
# specialties while preserving each source label in the output.
COMPARABLE_SPECIALTIES = {
    "Cardiology",
    "Family Medicine",
    "Internal Medicine",
    "Primary Care",
    "Gastroenterology",
    "General Surgery",
    "Gynecology",
    "Obstetrics and Gynecology",
    "Orthopaedic Surgery",
    "Sports Medicine",
    "Pediatrics",
    "Podiatry",
    "Lab",
}


class AdventHealthApiSession(epic.OrlandoHealthApiSession):
    """Cookie-backed client for AdventHealth's anonymous Epic endpoints."""

    def __init__(self):
        super().__init__()
        self.base_url = SITE_ROOT


def extraction_folder_name() -> str:
    """Readable run folder, for example ``26aug_AH_extr_153045``."""
    return time.strftime("%d%b").lower() + "_AH_extr_" + time.strftime("%H%M%S")


def supported_visit_types(detail: dict) -> list[dict]:
    """Return every public AdventHealth visit card supported by a provider pair.

    Orlando Health was originally scoped to new-patient paths. AdventHealth
    visibly exposes additional valid cards such as Specialists Office Visit
    and Patient Telemedicine Visit, so AH must not discard them merely because
    at least one new-patient card also exists.
    """
    supported_ids = {
        info.get("VisitTypeID")
        for pair in detail.get("ProviderDepartmentPairs", [])
        for info in pair.get("VisitTypeInformation", [])
    }
    all_visits = detail.get("VisitTypes", [])
    supported_visits = [
        visit for visit in all_visits if epic.epic_id(visit) in supported_ids
    ]
    return supported_visits or all_visits


def configure_adventhealth() -> None:
    """Point the shared Epic engine at AdventHealth without modifying OH."""
    epic.URL = OPEN_SCHEDULING_URL
    epic.SITE_CODE = "AH"
    epic.SPECIALTY_ALLOWLIST = COMPARABLE_SPECIALTIES
    epic.API_ENDPOINTS = {
        "bootstrap": APP_ROOT + "/openscheduling/",
        "workflow": APP_ROOT + "/Scheduling/Anonymous/GetSchedulingWorkflowData",
        "specialty": APP_ROOT + "/Scheduling/Anonymous/GetSpecialtyData",
        "decision_tree": APP_ROOT + "/DecisionTrees/AnonymousDecisionTree/NextStep",
        "questionnaire_evaluation": APP_ROOT + "/Scheduling/Anonymous/EvaluateQuestionnaireAnswers",
        "slots": APP_ROOT + "/Scheduling/Anonymous/GetSlots",
    }
    epic.OrlandoHealthApiSession = AdventHealthApiSession
    epic.extraction_folder_name = extraction_folder_name
    epic.supported_visit_types = supported_visit_types


def add_default_output_folder() -> None:
    """Keep AH run folders and latest convenience copies separate from OH."""
    if "--artifacts" not in sys.argv:
        sys.argv.extend(["--artifacts", "AH_outputs"])


if __name__ == "__main__":
    # Preserve the OH project's Run-button behavior: if VS Code launches this
    # with the bare Python installation, transparently switch to the shared
    # project venv that contains Selenium/openpyxl and the other dependencies.
    epic.use_shared_venv_if_needed()
    configure_adventhealth()
    add_default_output_folder()
    print("AdventHealth direct scheduling extraction starting.", flush=True)
    epic.main()
