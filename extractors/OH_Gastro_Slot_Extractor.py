
"""Gastroenterology-only public-flow enumerator for Orlando Health MyChart.

This file is designed to live in a subfolder (for example "gastroenterology")
inside the project root that holds epic_scheduling_extractor_OH.py and the
.venv. It resolves the engine import from the parent folder and writes its
results beside itself.

The script enumerates Gastroenterology, every supported Gastroenterology visit
type, every directly schedulable reason, and every finite answer branch exposed
by the anonymous decision tree. It does not book, hold, authenticate, or submit
patient-identifying data. Terminal and ineligible branches are traversed only
far enough for MyChart to return their public stop result, which is written to
the audit.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import time
import traceback
from collections import deque
from itertools import count
from pathlib import Path
from typing import Any

# Engines live one level up in the project root; this file runs from a subfolder.
# This must precede the engine import below.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import epic_scheduling_extractor_OH as epic  # noqa: E402

OUTPUT_ROOT = "OH_gastroenterology_all_public_flows_outputs"
SPECIALTY_NAME = "gastroenterology"

# No accepted Gastroenterology baseline exists yet. Leave empty for the first
# run, then point --baseline-flow-audit at the accepted run's flow audit JSON.
ACCEPTED_BASELINE_AUDIT = ""


def norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def item_id(item: dict[str, Any]) -> Any:
    return item.get("ID", item.get("Id", ""))


def run_name() -> str:
    return time.strftime("%d%b").lower() + "_OH_gastro_all_flows_" + time.strftime("%H%M%S")


def make_flow_id(*parts: Any) -> str:
    text = "\x1f".join(str(part or "") for part in parts)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]


def choices(question: dict[str, Any]) -> list[str]:
    return [
        str(item.get("Text", "")).strip()
        for item in question.get("Choices", [])
        if norm(item.get("Text")) not in {"", "choose", "[choose]"}
    ]


def allowed_answers(question: dict[str, Any], cap: int) -> tuple[list[str], list[dict[str, str]]]:
    """Enumerate every finite choice exposed by MyChart.

    Free-text/date questions do not have a finite permutation space. For those,
    use one non-identifying deterministic value and record that limitation.
    """
    options = choices(question)
    if options:
        unique = list(dict.fromkeys(options))
        prompt = norm(question.get("Prompt"))
        name = norm(question.get("Name"))
        if "following diagnoses" in prompt or "dhi inclusion list" in name:
            terminal = {"none", "other", "not sure"}
            unique = [value for value in unique if norm(value) not in terminal]
        if len(unique) > cap:
            excluded = [
                {"answer": value, "reason": f"answer cap {cap}"}
                for value in unique[cap:]
            ]
            return unique[:cap], excluded
        return unique, []

    prompt = norm(question.get("Prompt"))
    if "date" in prompt or "period" in prompt or "menstruation" in prompt:
        answer = "06/01/2026"
    elif "pcp" in prompt or "ordering provider" in prompt or "provider name" in prompt:
        answer = "none"
    else:
        answer = epic.select_default_decision_answer(question, {})
    audit = [{
        "answer": answer,
        "reason": "non-finite free-text/date input represented by one deterministic non-identifying value",
    }]
    return ([answer] if answer else []), audit


def start_tree(client: epic.OrlandoHealthApiSession, visit: dict[str, Any], workflow: dict[str, Any]) -> dict[str, Any]:
    traversal = {
        "TreeID": visit.get("AnonymousSchedulingDecisionTreeId"),
        "TreeAnswerID": None,
        "IsTraversalComplete": False,
        "SourceWorkflow": 5,
        "TreeWasDirty": False,
        "TreeWasLocked": False,
        "RestartTree": True,
        "UseInProgress": False,
        "AdditionalContext": {
            "VisitTypeID": item_id(visit), "TicketID": "", "AppointmentRequestIds": [],
            "OriginalApptDAT": "", "FavoriteApptDAT": "", "OrdersString": "",
            "IsGuest": False, "SchedulingWorkflowType": workflow.get("Type"),
            "TermIds": [], "SchedGrouperIds": None, "IsAuthenticatedWidget": False,
        },
        "ParentAnswerID": None,
    }
    fields = epic.postify({"traversalInfo": traversal})
    fields.append(("__RequestVerificationToken", client.csrf_token))
    return client.post_json("decision_tree", fields, {"phase": "enumerator_tree_start"})


def captured_question_answer(question: dict[str, Any], answer: str) -> dict[str, Any]:
    """Match the verified OH NextStep form shape for text and choice responses."""
    result = {
        "ID": question.get("ID"), "DAT": question.get("DAT"),
        "QuestionType": question.get("QuestionType"),
        "ResponseType": question.get("ResponseType"),
        "IsRequired": question.get("IsRequired"),
        "IsMultiResponse": question.get("IsMultiResponse"),
        "IsTrigger": question.get("IsTrigger"),
        "IsEnabled": question.get("IsEnabled"),
        "DisplayStyle": question.get("DisplayStyle") or "",
        "DisplayStyleVal": question.get("DisplayStyleVal") or 0,
    }
    if int(question.get("ResponseType") or 0) == 1:
        result["Answer"] = {"Text": str(answer)}
        return result
    selected = next((choice for choice in question.get("Choices", [])
                     if norm(choice.get("Text")) == norm(answer)), None)
    if selected is None:
        raise RuntimeError(f"Answer {answer!r} not found for {question.get('Prompt', '')!r}")
    result["Answer"] = {"Choices": [{"Index": selected.get("Index")}]}
    return result


def submit_answer(client: epic.OrlandoHealthApiSession, response: dict[str, Any], answer: str) -> dict[str, Any]:
    node = response.get("NextInputNode") or {}
    question = node.get("Question") or {}
    traversal = json.loads(json.dumps(response.get("TraversalInfo") or {}))
    traversal["RestartTree"] = False
    traversal["UseInProgress"] = False
    payload = {
        "traversalInfo": traversal,
        "prevInputNode": {
            "CSN": node.get("CSN"), "ID": node.get("ID"), "Type": node.get("Type"),
            "IsFirst": node.get("IsFirst"), "Question": None, "Questionnaire": None,
            "DecisionTree": None,
            "DeclutterNavigationButtons": node.get("DeclutterNavigationButtons"),
        },
        "question": captured_question_answer(question, answer),
    }
    fields = epic.postify(payload)
    fields.append(("__RequestVerificationToken", client.csrf_token))
    return client.post_json("decision_tree", fields, {
        "phase": "enumerator_tree_answer",
        "question_prompt": question.get("Prompt", ""), "answer": answer,
    })

def replay(client: epic.OrlandoHealthApiSession, visit: dict[str, Any], workflow: dict[str, Any], path: list[str]):
    response = start_tree(client, visit, workflow)
    prompts: list[dict[str, str]] = []
    for answer in path:
        if (response.get("TraversalInfo") or {}).get("IsTraversalComplete"):
            raise RuntimeError("Tree completed before saved path ended")
        question = ((response.get("NextInputNode") or {}).get("Question") or {})
        prompts.append({"prompt": question.get("Prompt", ""), "answer": answer})
        response = submit_answer(client, response, answer)
    return response, prompts


def enumerate_paths(client, visit, workflow, max_paths, max_depth, max_answers):
    if not visit.get("AnonymousSchedulingDecisionTreeId"):
        return [{"answers": [], "prompts": [], "tree_answer_id": None}], []
    queue = deque([[]])
    seen: set[tuple[str, ...]] = set()
    completed: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []
    while queue and len(completed) < max_paths:
        path = queue.popleft()
        key = tuple(path)
        if key in seen:
            continue
        seen.add(key)
        response = prompts = None
        replay_error = None
        for replay_attempt in range(1, 5):
            try:
                response, prompts = replay(client, visit, workflow, path)
                replay_error = None
                break
            except Exception as error:
                replay_error = error
                if replay_attempt >= 4:
                    break
                delay = min(2 ** replay_attempt, 12)
                print(
                    f"  Decision-tree connection failed for path depth {len(path)}; "
                    f"retry {replay_attempt}/3 in {delay}s: {error}",
                    flush=True,
                )
                time.sleep(delay)
        if replay_error is not None or response is None or prompts is None:
            audit.append({
                "status": "flow_error",
                "answer_path": json.dumps(path),
                "message": f"Decision-tree replay failed after 4 attempts: {replay_error}",
            })
            continue
        traversal = response.get("TraversalInfo") or {}
        if traversal.get("IsTraversalComplete"):
            completed.append({"answers": path, "prompts": prompts, "tree_answer_id": traversal.get("TreeAnswerID")})
            continue
        if len(path) >= max_depth:
            audit.append({"status": "excluded", "answer_path": json.dumps(path), "message": f"depth cap {max_depth}"})
            continue
        question = ((response.get("NextInputNode") or {}).get("Question") or {})
        allowed, excluded = allowed_answers(question, max_answers)
        for item in excluded:
            audit.append({"status": "excluded", "question": question.get("Prompt", ""),
                          "answer": item["answer"], "answer_path": json.dumps(path), "message": item["reason"]})
        queue.extend(path + [answer] for answer in allowed)
    if queue:
        audit.append({"status": "excluded", "message": f"path cap {max_paths}; {len(queue)} prefixes remained"})
    return completed, audit


def evaluate_path(client, workflow, visit, reason, path):
    tree_id = visit.get("AnonymousSchedulingDecisionTreeId")
    if not tree_id:
        return {"prompts": [], "override": None, "evaluated": {}, "stop": False, "message": ""}
    override = {
        "LqfIds": [tree_id], "HqaIds": [path.get("tree_answer_id")],
        "OriginalPrcId": item_id(visit), "OriginalRfv": reason.get("CategoryValue"),
        "OriginalRfvLine": reason.get("LineInWDF15000") or reason.get("Id", reason.get("ID")),
    }
    fields = epic.postify({"workflow": workflow, "schedulingOverridesString": json.dumps(override, separators=(",", ":")),
                           "termIds": [], "nonce": client.page_nonce})
    fields.append(("__RequestVerificationToken", client.csrf_token))
    evaluated = client.post_json("questionnaire_evaluation", fields, {"phase": "enumerator_questionnaire"})
    message = " ".join(re.sub(r"<[^>]+>", " ", str(evaluated.get("Instructions") or "")).split())
    return {"prompts": path["prompts"], "override": override, "evaluated": evaluated,
            "stop": bool(evaluated.get("StopScheduling")), "message": message}


def supported_visits(detail):
    ids = {info.get("VisitTypeID") for pair in detail.get("ProviderDepartmentPairs", [])
           for info in pair.get("VisitTypeInformation", [])}
    return [visit for visit in detail.get("VisitTypes", []) if not ids or item_id(visit) in ids]


def direct_reasons(detail, visit):
    reasons = [reason for reason in detail.get("ReasonsForVisit", []) if reason.get("CanDirectSchedule") is not False]
    vid = item_id(visit)
    compatible = [reason for reason in reasons if not reason.get("DefaultVisitTypeId")
                  or reason.get("DefaultVisitTypeId") == vid or reason.get("VisitTypeId") == vid]
    return compatible or reasons


def refresh_session(client: epic.OrlandoHealthApiSession, delay: float = 0.0):
    """Return a bootstrapped session while preserving the shared capture log."""
    capture_sink = client.captures
    refreshed = epic.OrlandoHealthApiSession()
    refreshed.bootstrap()
    capture_sink.extend(refreshed.captures)
    refreshed.captures = capture_sink
    if delay:
        time.sleep(delay)
    return refreshed


def reload_public_context(client, specialty_id):
    """Bootstrap a clean anonymous session and reload session-bound workflow data."""
    client = refresh_session(client)
    catalog = client.post_json("workflow", {
        "schedulingParameters.isAnonymous": "true",
        "schedulingParameters.workflow": "NewProvider",
        "nonce": client.page_nonce,
        "__RequestVerificationToken": client.csrf_token,
    }, {"phase": "workflow_refresh"})
    settings = catalog.get("WorkflowSettings", {})
    workflow = epic.raw_workflow(settings)
    specialty = next(
        (item for item in catalog.get("Specialties", []) if item_id(item) == specialty_id),
        None,
    )
    if specialty is None:
        raise RuntimeError(f"Specialty {specialty_id!r} disappeared from the public catalog")
    detail = client.post_json("specialty", {
        "SpecialtyId": item_id(specialty),
        "isFirstLoad": "true",
        "schedulingOverridesString": "{}",
        "__RequestVerificationToken": client.csrf_token,
    }, {"phase": "specialty_refresh", "specialty_name": specialty.get("Name", "")})
    return client, settings, workflow, specialty, detail


def match_reason(detail, old_reason):
    """Find the same reason in freshly loaded, session-valid specialty data."""
    candidates = detail.get("ReasonsForVisit", [])
    old_id = item_id(old_reason)
    if old_id not in (None, ""):
        matched = next((reason for reason in candidates if item_id(reason) == old_id), None)
        if matched is not None:
            return matched
    old_key = (
        old_reason.get("CategoryValue"),
        old_reason.get("LineInWDF15000"),
        norm(old_reason.get("DisplayName") or old_reason.get("Title")),
    )
    matched = next((reason for reason in candidates if (
        reason.get("CategoryValue"),
        reason.get("LineInWDF15000"),
        norm(reason.get("DisplayName") or reason.get("Title")),
    ) == old_key), None)
    if matched is None:
        raise RuntimeError(f"Reason for visit {old_key!r} disappeared from the public catalog")
    return matched


def prepare_flow_context(client, specialty_id, visit_id, old_reason, saved_path, delay=0.0):
    """Rebuild a flow entirely inside one fresh anonymous session.

    Epic's TreeAnswerID belongs to the anonymous session that traversed the
    questionnaire. Reusing a discovered ID after rotating cookies produces an
    HTTP-200 HTML Oops response from EvaluateQuestionnaireAnswers.
    """
    client, settings, workflow, specialty, detail = reload_public_context(client, specialty_id)
    visit = next((item for item in supported_visits(detail) if item_id(item) == visit_id), None)
    if visit is None:
        raise RuntimeError(f"Visit type {visit_id!r} disappeared from the public catalog")
    reason = match_reason(detail, old_reason)
    answers = list(saved_path.get("answers") or [])
    if visit.get("AnonymousSchedulingDecisionTreeId"):
        response, prompts = replay(client, visit, workflow, answers)
        traversal = response.get("TraversalInfo") or {}
        if not traversal.get("IsTraversalComplete"):
            raise RuntimeError("Fresh questionnaire replay did not reach a completed traversal")
        path = {
            "answers": answers,
            "prompts": prompts,
            "tree_answer_id": traversal.get("TreeAnswerID"),
        }
        if not path["tree_answer_id"]:
            raise RuntimeError("Fresh questionnaire replay returned no TreeAnswerID")
    else:
        path = {"answers": answers, "prompts": [], "tree_answer_id": None}
    if delay:
        time.sleep(delay)
    return client, settings, workflow, specialty, detail, visit, reason, path


def collect_slot_pages(client, model, specialty, active_visit, reason, path, providers, departments,
                       flow_id, visit_name, max_slot_loads, api_delay, slot_response_retries,
                       slot_progress_every, max_days_ahead):
    """Collect one flow until Epic stops or repeats a page.

    Some anonymous Epic sessions report ContinueInfo even after returning the
    final page a second time. The repeated-response check is therefore a
    terminal condition, not an error to paginate through indefinitely.
    """
    seen_tokens, seen_pages, flow_rows = set(), set(), []
    status, message, loads = "slots_captured", "", 0
    repaired_continuations: set[tuple[int, int]] = set()
    repair_messages: list[str] = []
    load_numbers = count(1) if max_slot_loads <= 0 else range(1, max_slot_loads + 1)
    for load in load_numbers:
        loads = load
        data = None
        continuation_repaired = False
        for response_attempt in range(slot_response_retries + 1):
            fields = epic.postify(model)
            fields.append(("__RequestVerificationToken", client.csrf_token))
            try:
                data = client.post_json("slots", fields, {
                    "phase": "slots", "flow_id": flow_id, "load_number": load,
                    "response_attempt": response_attempt + 1,
                })
                break
            except RuntimeError as error:
                if "returned non-JSON data" not in str(error) or response_attempt >= slot_response_retries:
                    cont = model.get("continueInfo") or {}
                    try:
                        cont_state = int(cont.get("State") or 0)
                        cont_start = int(cont.get("SearchRangeStartDte") or 0)
                        cont_end = int(cont.get("SearchRangeEndDte") or cont_start)
                    except (TypeError, ValueError):
                        cont_state = cont_start = cont_end = 0
                    repair_key = (cont_start, cont_end)
                    # OH occasionally emits an Oops page while moving off a date
                    # whose provider batches were already exhausted. Advance one
                    # day only for that precise state, and never repair it twice.
                    if (
                        "returned non-JSON data" in str(error)
                        and cont_state == 1
                        and not str(cont.get("NextProviderIndex") or "").strip()
                        and cont_start
                        and repair_key not in repaired_continuations
                    ):
                        repaired_continuations.add(repair_key)
                        repaired = dict(cont)
                        repaired["SearchRangeStartDte"] = cont_start + 1
                        repaired["SearchRangeEndDte"] = max(cont_end + 1, cont_start + 1)
                        model["continueInfo"] = repaired
                        continuation_repaired = True
                        repair_note = f"advanced broken OH continuation {cont_start}-{cont_end} by one day"
                        repair_messages.append(repair_note)
                        print(f"  {visit_name}: {repair_note}; continuing", flush=True)
                        break
                    status, message = "slot_response_error", str(error)
                    if repair_messages:
                        message += "; " + "; ".join(repair_messages)
                    return flow_rows, status, message, loads, client
                print(f"  {visit_name}: load {load} returned non-JSON; refreshing session "
                      f"and retrying ({response_attempt + 1}/{slot_response_retries})", flush=True)
                try:
                    client = refresh_session(client)
                except Exception as refresh_error:
                    status = "slot_response_error"
                    message = f"{error}; session refresh failed: {refresh_error}"
                    return flow_rows, status, message, loads, client
                time.sleep(max(api_delay, 1.0))
        if continuation_repaired:
            continue
        if data is None:
            status, message = "slot_response_error", "Slot response retries ended without JSON data"
            if repair_messages:
                message += "; " + "; ".join(repair_messages)
            return flow_rows, status, message, loads, client
        if data.get("ErrorCode"):
            status, message = "slot_lookup_error", str(data.get("ErrorCode"))
            break
        # Different search dates can legitimately return identical Solutions
        # (especially an empty list). Include ContinueInfo so advancing through
        # consecutive no-availability dates is not mistaken for a stuck page.
        signature_payload = {
            "Solutions": data.get("Solutions", []),
            "ContinueInfo": data.get("ContinueInfo"),
        }
        signature = hashlib.sha256(json.dumps(signature_payload, sort_keys=True, default=str).encode()).hexdigest()
        if signature in seen_pages:
            status, message = "repeated_page_stop", "Repeated Solutions page"
            break
        seen_pages.add(signature)
        for solution in data.get("Solutions", []):
            for slot in solution.get("Slots", []):
                row = epic.normalize_api_slot(slot, specialty, active_visit, reason, path["prompts"], providers, departments, load)
                row.update({"flow_id": flow_id, "visit_type": visit_name,
                            "questionnaire_path": " | ".join(f"{x['prompt']} => {x['answer']}" for x in path["prompts"])})
                flow_rows.append(row)
        cont = data.get("ContinueInfo")
        model["continueInfo"] = cont
        if not cont or cont.get("IsStopSearch"):
            status = "natural_stop"
            break
        # Some Epic flows keep IsStopSearch=false and eventually jump to an
        # absurd sentinel date, after which GetSlots returns an HTML Oops page.
        # Bound completeness explicitly instead of following that bad token.
        try:
            start_dte = int(model.get("startDte") or 0)
            next_dte = int(cont.get("SearchRangeStartDte") or 0)
        except (TypeError, ValueError):
            start_dte = next_dte = 0
        if max_days_ahead and start_dte and next_dte > start_dte + max_days_ahead:
            status = "horizon_stop"
            message = (
                f"Continuation date {next_dte} passed the configured "
                f"{max_days_ahead}-day horizon from {start_dte}"
            )
            break
        token = json.dumps(cont, sort_keys=True, default=str)
        if token in seen_tokens:
            status, message = "repeated_continue_stop", "Repeated ContinueInfo"
            break
        seen_tokens.add(token)
        if slot_progress_every and load % slot_progress_every == 0:
            print(f"  {visit_name}: page {load}; {len(flow_rows)} slots in this flow", flush=True)
        time.sleep(api_delay)
    else:  # Only reachable when the finite page guard is enabled and exhausted.
        status, message = "page_guard_reached", f"Maximum {max_slot_loads} pages reached"
    if repair_messages:
        repair_summary = "; ".join(repair_messages)
        message = f"{message}; {repair_summary}" if message else repair_summary
    return flow_rows, status, message, loads, client


def load_baseline_flow_counts(path_text: str | None) -> dict[str, int]:
    """Load slot counts by flow from an accepted prior audit, if supplied."""
    if not path_text:
        return {}
    path = Path(path_text)
    if not path.exists():
        raise FileNotFoundError(f"Coverage baseline was not found: {path}")
    if path.suffix.lower() == ".json":
        rows = json.loads(path.read_text(encoding="utf-8-sig"))
    else:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
    return {
        str(row.get("flow_id")): int(row.get("slot_count") or 0)
        for row in rows
        if row.get("flow_id") and str(row.get("status", "")) not in {"flow_error", "coverage_failure"}
    }


def save(run_dir: Path, rows, audit, captures, full=False):
    prefix = run_dir.name
    # Preserve raw rows until extraction success is proven; deduplication is deferred.
    rows = list(rows)
    slot_fields = ["flow_id", "specialty", "visit_type", "reason_for_visit", "questionnaire_path",
                   "provider_name", "provider_id", "provider_credentials", "location_name", "department_id",
                   "address", "city", "state", "zip", "appointment_date", "appointment_time",
                   "display_datetime_utc", "days_ahead", "length_minutes", "timezone", "load_number", "source_url"]
    audit_fields = ["flow_id", "specialty", "visit_type", "reason_for_visit", "status", "slot_count",
                    "loads_completed", "question", "answer", "answer_path", "message"]
    for path, data, fields in ((run_dir / f"{prefix}_slots.csv", rows, slot_fields),
                               (run_dir / f"{prefix}_flow_audit.csv", audit, audit_fields)):
        with path.open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(data)
    # Large JSON artifacts are written once at finalization, not at every checkpoint.
    if full:
        compact = {"ensure_ascii": False, "separators": (",", ":")}
        (run_dir / f"{prefix}_slots.json").write_text(json.dumps(rows, **compact), encoding="utf-8")
        (run_dir / f"{prefix}_flow_audit.json").write_text(json.dumps(audit, **compact), encoding="utf-8")
        (run_dir / f"{prefix}_network_capture.json").write_text(json.dumps(captures, **compact), encoding="utf-8")
    print(f"CHECKPOINT: {len(rows)} raw slots; {len(audit)} audit rows", flush=True)


def run(args):
    epic.SITE_CODE = "OH_GASTRO_ALL_FLOWS"
    run_dir = Path(args.artifacts) / run_name()
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"Run folder: {run_dir.resolve()}", flush=True)
    client = epic.OrlandoHealthApiSession()
    rows, audit = [], []
    run_failed = False
    fatal_error = ""
    baseline_flow_counts = load_baseline_flow_counts(args.baseline_flow_audit)
    coverage_failures = []
    try:
        client.bootstrap()
        catalog = client.post_json("workflow", {"schedulingParameters.isAnonymous": "true",
            "schedulingParameters.workflow": "NewProvider", "nonce": client.page_nonce,
            "__RequestVerificationToken": client.csrf_token}, {"phase": "workflow"})
        settings = catalog.get("WorkflowSettings", {})
        workflow = epic.raw_workflow(settings)
        specialties = [
            specialty for specialty in catalog.get("Specialties", [])
            if norm(specialty.get("Name")) == SPECIALTY_NAME
        ]
        if not specialties:
            available = sorted({str(item.get("Name", "")) for item in catalog.get("Specialties", [])})
            raise RuntimeError(
                "Gastroenterology was not found in the anonymous public specialty catalog. "
                f"Available specialties: {available}"
            )
        for si, specialty in enumerate(specialties, 1):
            specialty_name = specialty.get("Name", "")
            detail = client.post_json("specialty", {"SpecialtyId": item_id(specialty), "isFirstLoad": "true",
                "schedulingOverridesString": "{}", "__RequestVerificationToken": client.csrf_token},
                {"phase": "specialty", "specialty_name": specialty_name})
            visits = supported_visits(detail)
            print(f"{si}/{len(specialties)} {specialty_name}: {len(visits)} visit types", flush=True)
            for visit in visits:
                # Path discovery must not inherit a session exhausted by the
                # previous visit's potentially thousands of slot requests.
                client, settings, workflow, specialty, detail = reload_public_context(
                    client, item_id(specialty)
                )
                visit = next(
                    (item for item in supported_visits(detail) if item_id(item) == item_id(visit)),
                    visit,
                )
                visit_name = visit.get("DisplayName") or visit.get("Name", "")
                paths, excluded = enumerate_paths(client, visit, workflow, args.max_paths_per_visit,
                                                   args.max_tree_depth, args.max_answers_per_question)
                audit.extend({"specialty": specialty_name, "visit_type": visit_name, **item} for item in excluded)
                for reason in direct_reasons(detail, visit):
                    reason_name = reason.get("DisplayName") or reason.get("Title", "")
                    for path in paths:
                        fid = make_flow_id(item_id(specialty), item_id(visit), item_id(reason), json.dumps(path["answers"]))
                        if args.only_flow_id and fid != args.only_flow_id:
                            continue
                        try:
                            # Use one clean session for replay, evaluation,
                            # specialty override, and slot collection. This
                            # guarantees TreeAnswerID belongs to that session.
                            client, settings, workflow, specialty, detail, active_source_visit, active_reason, active_path = prepare_flow_context(
                                client, item_id(specialty), item_id(visit), reason, path, args.api_delay
                            )
                            lqf = evaluate_path(client, workflow, active_source_visit, active_reason, active_path)
                            if lqf["stop"]:
                                audit.append({"flow_id": fid, "specialty": specialty_name, "visit_type": visit_name,
                                    "reason_for_visit": reason_name, "status": "public_stop", "slot_count": 0,
                                    "answer_path": json.dumps(path["answers"]), "message": lqf["message"]})
                                continue
                            override = lqf.get("override") or {}
                            active = detail
                            if override:
                                active = client.post_json("specialty", {"SpecialtyId": item_id(specialty), "isFirstLoad": "false",
                                    "schedulingOverridesString": json.dumps(override, separators=(",", ":")),
                                    "__RequestVerificationToken": client.csrf_token}, {"phase": "specialty_override", "flow_id": fid})
                            evaluated = lqf.get("evaluated") or {}
                            active_visit_id = evaluated.get("VisitTypeId") or item_id(active_source_visit)
                            active_visit = next((v for v in active.get("VisitTypes", []) if item_id(v) == active_visit_id), active_source_visit)
                            pairs = [pair for pair in active.get("ProviderDepartmentPairs", []) if any(
                                info.get("VisitTypeID") == item_id(active_visit) for info in pair.get("VisitTypeInformation", []))]
                            if not pairs:
                                pairs = active.get("ProviderDepartmentPairs", []) or detail.get("ProviderDepartmentPairs", [])
                            selected = set(evaluated.get("ProvidersToSelect") or []) if evaluated.get("ReplacedAllOriginalProviders") else set()
                            if selected:
                                pairs = [pair for pair in pairs if pair.get("ProviderId") in selected]
                            model = epic.build_slot_request(settings, workflow, specialty, active_reason, active_visit, pairs, lqf)
                            providers = {x.get("ID"): x for x in (active.get("Providers", []) or detail.get("Providers", []))}
                            departments = {x.get("ID"): x for x in (active.get("Departments", []) or detail.get("Departments", []))}
                            initial_model = json.loads(json.dumps(model))
                            flow_rows, status, message, loads, client = collect_slot_pages(
                                client, model, specialty, active_visit, active_reason, active_path, providers, departments,
                                fid, visit_name, args.max_slot_loads, args.api_delay,
                                args.slot_response_retries, args.slot_progress_every, args.max_days_ahead,
                            )
                            # A repeat after only a few pages can be a stale anonymous-session response.
                            # Retry that one flow from a new cookie/CSRF session; never remove the loop guard.
                            if status == "repeated_page_stop" and loads <= args.early_repeat_loads:
                                first_attempt = (flow_rows, status, message, loads)
                                for retry_number in range(1, args.early_repeat_retries + 1):
                                    retry_client = epic.OrlandoHealthApiSession()
                                    retry_client.bootstrap()
                                    retry_rows, retry_status, retry_message, retry_loads, retry_client = collect_slot_pages(
                                        retry_client, json.loads(json.dumps(initial_model)), specialty, active_visit,
                                        active_reason, active_path, providers, departments, fid, visit_name,
                                        args.max_slot_loads, args.api_delay,
                                        args.slot_response_retries, args.slot_progress_every, args.max_days_ahead,
                                    )
                                    client.captures.extend(retry_client.captures)
                                    retry_client.captures = client.captures
                                    client = retry_client
                                    if len(retry_rows) > len(flow_rows):
                                        flow_rows, status, message, loads = retry_rows, retry_status, retry_message, retry_loads
                                    if retry_status != "repeated_page_stop" or retry_loads > args.early_repeat_loads:
                                        break
                                if len(flow_rows) == len(first_attempt[0]):
                                    message += f"; fresh-session retry did not improve coverage ({args.early_repeat_retries} attempt(s))"
                            baseline_count = baseline_flow_counts.get(fid)
                            if baseline_count and len(flow_rows) < baseline_count * args.min_flow_retention:
                                shortfall = {
                                    "flow_id": fid, "specialty": specialty_name, "visit_type": visit_name,
                                    "reason_for_visit": reason_name, "status": "coverage_failure",
                                    "slot_count": len(flow_rows), "loads_completed": loads,
                                    "answer_path": json.dumps(path["answers"]),
                                    "message": f"{len(flow_rows)} slots vs accepted baseline {baseline_count} (minimum {args.min_flow_retention:.0%})",
                                }
                                audit.append(shortfall)
                                coverage_failures.append(shortfall)
                            rows.extend(flow_rows)
                            audit.append({"flow_id": fid, "specialty": specialty_name, "visit_type": visit_name,
                                "reason_for_visit": reason_name, "status": status, "slot_count": len(flow_rows),
                                "loads_completed": loads, "answer_path": json.dumps(path["answers"]), "message": message})
                        except Exception as error:
                            audit.append({"flow_id": fid, "specialty": specialty_name, "visit_type": visit_name,
                                "reason_for_visit": reason_name, "status": "flow_error", "slot_count": 0,
                                "answer_path": json.dumps(path["answers"]), "message": str(error)})
                            # A failed questionnaire/API call can leave the anonymous
                            # session unusable. Do not let it poison every later flow.
                            try:
                                client = refresh_session(client, max(args.api_delay, 1.0))
                            except Exception as refresh_error:
                                audit[-1]["message"] += f"; session refresh failed: {refresh_error}"
                        completed_flow_count = sum(1 for item in audit if item.get("flow_id"))
                        if completed_flow_count and completed_flow_count % 25 == 0:
                            save(run_dir, rows, audit, client.captures)
    except Exception as error:
        run_failed = True
        fatal_error = str(error)
        (run_dir / f"{run_dir.name}_error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        raise
    finally:
        save(run_dir, rows, audit, client.captures, full=True)
        failure_statuses = {
            "coverage_failure", "flow_error", "slot_response_error", "slot_lookup_error",
            "page_guard_reached", "repeated_page_stop", "repeated_continue_stop",
        }
        incomplete_flows = [item for item in audit if item.get("status") in failure_statuses]
        no_completed_flows = not any(item.get("flow_id") for item in audit)
        no_extracted_slots = len(rows) == 0
        incomplete_run = run_failed or bool(incomplete_flows) or no_completed_flows or no_extracted_slots
        if args.only_flow_id:
            health_status = "diagnostic_incomplete" if incomplete_run else "diagnostic_complete"
        else:
            health_status = "incomplete" if incomplete_run else "accepted"
        health = {
            "status": health_status,
            "specialty": "Gastroenterology",
            "run_failed": run_failed,
            "fatal_error": fatal_error,
            "raw_slot_count": len(rows),
            "diagnostic_flow_id": args.only_flow_id or "",
            "baseline_flow_audit": args.baseline_flow_audit or "",
            "min_flow_retention": args.min_flow_retention,
            "coverage_failure_count": len(coverage_failures),
            "coverage_failures": coverage_failures,
            "incomplete_flow_count": len(incomplete_flows),
            "incomplete_flows": incomplete_flows,
        }
        (run_dir / f"{run_dir.name}_run_health.json").write_text(json.dumps(health, indent=2), encoding="utf-8")
        print(f"Results written to: {run_dir.resolve()}", flush=True)
        if incomplete_flows:
            print(f"WARNING: {len(incomplete_flows)} flow(s) are incomplete; do not publish this run.", flush=True)


def main():
    # Anchor relative output paths to this script's folder, not the terminal's
    # working directory, so results always land beside the script.
    os.chdir(Path(__file__).resolve().parent)
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", default=OUTPUT_ROOT)
    parser.add_argument("--max-slot-loads", type=int, default=0,
                        help="Maximum slot pages per flow; 0 disables the page cap")
    parser.add_argument("--max-paths-per-visit", type=int, default=10000)
    parser.add_argument("--max-tree-depth", type=int, default=50)
    parser.add_argument("--max-answers-per-question", type=int, default=1000)
    parser.add_argument("--api-delay", type=float, default=0.10)
    parser.add_argument("--slot-response-retries", type=int, default=2,
                        help="Fresh-session retries when GetSlots returns HTML/non-JSON")
    parser.add_argument("--slot-progress-every", type=int, default=25,
                        help="Print progress after this many pages within a long slot flow")
    parser.add_argument("--max-days-ahead", type=int, default=730,
                        help="Treat coverage through this explicit horizon as complete")
    parser.add_argument("--only-flow-id", default="",
                        help="Diagnostic mode: extract only one stable flow ID")
    parser.add_argument("--early-repeat-loads", type=int, default=12,
                        help="Retry a repeated Solutions page only when it occurs this early in a flow")
    parser.add_argument("--early-repeat-retries", type=int, default=1,
                        help="Fresh anonymous-session retries for an early repeated Solutions page")
    parser.add_argument("--baseline-flow-audit", default=ACCEPTED_BASELINE_AUDIT,
                        help="Accepted prior flow audit (.json or .csv) used to flag implausibly low coverage")
    parser.add_argument("--min-flow-retention", type=float, default=0.70,
                        help="Minimum share of an accepted flow's slots required before it is flagged")
    run(parser.parse_args())


if __name__ == "__main__":
    main()

# "..\.venv\Scripts\python.exe" "OH_gastroenterology_all_public_flows.py"
