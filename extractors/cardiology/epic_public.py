"""Shared anonymous Epic Open Scheduling extractor for Cardiology.

This module uses only Python's standard library. It reads public scheduling
catalogs and appointment inventory; it never logs in, books, holds, or submits
patient-identifying information.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import time
import traceback
from collections import deque
from dataclasses import dataclass
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener


@dataclass(frozen=True)
class Site:
    code: str
    name: str
    base_url: str
    app_root: str

    @property
    def endpoints(self) -> dict[str, str]:
        root = self.app_root.rstrip("/")
        return {
            "bootstrap": f"{root}/openscheduling/",
            "workflow": f"{root}/Scheduling/Anonymous/GetSchedulingWorkflowData",
            "specialty": f"{root}/Scheduling/Anonymous/GetSpecialtyData",
            "decision_tree": f"{root}/DecisionTrees/AnonymousDecisionTree/NextStep",
            "questionnaire_evaluation": f"{root}/Scheduling/Anonymous/EvaluateQuestionnaireAnswers",
            "slots": f"{root}/Scheduling/Anonymous/GetSlots",
        }


SITES = {
    "ah": Site("AH", "AdventHealth", "https://mychart.adventhealth.com", "/mychartprd"),
    "oh": Site("OH", "Orlando Health", "https://mychart.orlandohealth.com", "/MyChart"),
}
SPECIALTY = "Cardiology"
SLOT_FIELDS = [
    "flow_id", "specialty", "appointment_type", "visit_type", "reason_for_visit",
    "questionnaire_path", "decision_tree_path", "provider_name", "provider_id", "provider_credentials",
    "location_name", "department_id", "address", "city", "state", "zip",
    "appointment_date", "appointment_time", "display_datetime_utc", "days_ahead",
    "length_minutes", "timezone", "load_number", "source_url",
]
AUDIT_FIELDS = [
    "flow_id", "specialty", "appointment_type", "reason_for_visit", "status",
    "slot_count", "loads_completed", "answer_path", "message",
]


def norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def item_id(item: dict[str, Any]) -> Any:
    return item.get("ID", item.get("Id", ""))


def postify(value: Any, prefix: str = "", output: list[tuple[str, str]] | None = None):
    output = [] if output is None else output
    if isinstance(value, dict):
        for key, child in value.items():
            postify(child, f"{prefix}.{key}" if prefix else str(key), output)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            postify(child, f"{prefix}[{index}]", output)
    elif value is not None and prefix:
        output.append((prefix, "true" if value is True else "false" if value is False else str(value)))
    return output


def workflow_model(settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "Type": settings.get("WorkflowType"), "FinderType": settings.get("FinderType"),
        "IsGuest": False, "IsAnonymous": True, "IsFromPrelogin": settings.get("IsFromPrelogin"),
        "RescheduleDat": None, "RootDecisionTreeId": settings.get("RootDecisionTreeId"),
        "DecisionTreeAnswerId": settings.get("DecisionTreeAnswerId"),
        "DecisionTreeNodeId": settings.get("DecisionTreeNodeId"),
        "DecisionTreeNodeCsn": settings.get("DecisionTreeNodeCsn"),
        "SchedulingControllerParams": {}, "SecureSessionToken": None, "BrowserId": None,
        "MultiApptSlotStepStartingView": None, "MultiApptSlotStepSelectionView": None,
        "IsAuthenticatedWidget": False,
    }


class PublicEpicClient:
    def __init__(self, site: Site, retries: int = 4, request_delay: float = 0.25):
        self.site, self.retries, self.request_delay = site, retries, request_delay
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        self.csrf_token = ""
        self.page_nonce = ""
        self.audit: list[dict[str, Any]] = []

    def bootstrap(self) -> None:
        url = self.site.base_url + self.site.endpoints["bootstrap"]
        response = self._open(Request(url, headers={"Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0"}))
        body = response.decode("utf-8", errors="replace")
        token = (re.search(r'name=["\']__RequestVerificationToken["\'][^>]*value=["\']([^"\']+)', body, re.I)
                 or re.search(r'value=["\']([^"\']+)["\'][^>]*name=["\']__RequestVerificationToken', body, re.I))
        nonce = re.search(r'<script[^>]+id=["\']cspScripts["\'][^>]*nonce=["\']([^"\']*)', body, re.I)
        self.csrf_token = token.group(1) if token else ""
        self.page_nonce = nonce.group(1) if nonce else ""
        if not self.csrf_token:
            raise RuntimeError("Anonymous scheduling bootstrap did not return a CSRF token")

    def _open(self, request: Request) -> bytes:
        error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                with self.opener.open(request, timeout=60) as response:
                    return response.read()
            except Exception as caught:  # public endpoint/network failures are retried and audited
                error = caught
                if attempt < self.retries:
                    time.sleep(min(8, self.request_delay * (2 ** attempt)))
        raise RuntimeError(f"Request failed after {self.retries} attempts: {error}") from error

    def post_json(self, endpoint: str, fields: Any) -> dict[str, Any]:
        pairs = postify(fields) if isinstance(fields, (dict, list)) else list(fields)
        if not any(key == "__RequestVerificationToken" for key, _ in pairs):
            pairs.append(("__RequestVerificationToken", self.csrf_token))
        url = self.site.base_url + self.site.endpoints[endpoint] + "?noCache=" + str(time.time_ns())
        request = Request(url, data=urlencode(pairs).encode("utf-8"), method="POST", headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest", "Origin": self.site.base_url,
            "Referer": self.site.base_url + self.site.endpoints["bootstrap"], "User-Agent": "Mozilla/5.0",
        })
        body = self._open(request).decode("utf-8", errors="replace")
        try:
            data = json.loads(body)
        except ValueError as error:
            raise RuntimeError(f"{endpoint} returned non-JSON data") from error
        if not isinstance(data, dict):
            raise RuntimeError(f"{endpoint} returned an unexpected JSON shape")
        time.sleep(self.request_delay)
        return data


def choices(question: dict[str, Any]) -> list[str]:
    return list(dict.fromkeys(str(item.get("Text", "")).strip() for item in question.get("Choices", [])
                              if norm(item.get("Text")) not in {"", "choose", "[choose]"}))


def fallback_answer(question: dict[str, Any]) -> str:
    prompt, options = norm(question.get("Prompt")), choices(question)
    if options:
        for preferred in ("No", "Not Medicaid", "Other/None", "Other", "Yes"):
            match = next((option for option in options if norm(option) == norm(preferred)), None)
            if match and (preferred != "No" or any(term in prompt for term in ("emergency", "medicaid", "seen", "established", "surgery", "accident"))):
                return match
        return options[0]
    if any(term in prompt for term in ("date", "period", "menstruation")):
        return time.strftime("%m/%d/%Y", time.localtime(time.time() - 28 * 86400))
    if any(term in prompt for term in ("pcp", "ordering provider", "provider name")):
        return "None"
    return ""


def question_answer(question: dict[str, Any], answer: str) -> dict[str, Any]:
    option = next((item for item in question.get("Choices", []) if norm(item.get("Text")) == norm(answer)), None)
    return {
        "ID": question.get("ID"), "DAT": question.get("DAT"),
        "QuestionType": question.get("QuestionType"), "ResponseType": question.get("ResponseType"),
        "IsRequired": question.get("IsRequired"), "IsMultiResponse": question.get("IsMultiResponse"),
        "IsTrigger": question.get("IsTrigger"), "IsEnabled": question.get("IsEnabled"),
        "DisplayStyle": question.get("DisplayStyle"), "DisplayStyleVal": question.get("DisplayStyleVal"),
        "Answer": {"Choices": [{"Index": option.get("Index")}]} if option else answer,
    }


def start_tree(client: PublicEpicClient, visit: dict[str, Any], workflow: dict[str, Any]) -> dict[str, Any]:
    traversal = {
        "TreeID": visit.get("AnonymousSchedulingDecisionTreeId"), "TreeAnswerID": None,
        "IsTraversalComplete": False, "SourceWorkflow": 5, "TreeWasDirty": False,
        "TreeWasLocked": False, "RestartTree": True, "UseInProgress": False,
        "AdditionalContext": {"VisitTypeID": item_id(visit), "TicketID": "", "AppointmentRequestIds": [],
            "OriginalApptDAT": "", "FavoriteApptDAT": "", "OrdersString": "", "IsGuest": False,
            "SchedulingWorkflowType": workflow.get("Type"), "TermIds": [], "SchedGrouperIds": None,
            "IsAuthenticatedWidget": False}, "ParentAnswerID": None,
    }
    return client.post_json("decision_tree", {"traversalInfo": traversal})


def submit_answer(client: PublicEpicClient, response: dict[str, Any], answer: str) -> dict[str, Any]:
    node, traversal = response.get("NextInputNode") or {}, json.loads(json.dumps(response.get("TraversalInfo") or {}))
    question = node.get("Question") or {}; traversal["RestartTree"] = False
    return client.post_json("decision_tree", {"traversalInfo": traversal, "prevInputNode": {
        "CSN": node.get("CSN"), "ID": node.get("ID"), "Type": node.get("Type"), "IsFirst": node.get("IsFirst"),
        "Question": None, "Questionnaire": None, "DecisionTree": None,
        "DeclutterNavigationButtons": node.get("DeclutterNavigationButtons")},
        "question": question_answer(question, answer)})


def replay(client: PublicEpicClient, visit: dict[str, Any], workflow: dict[str, Any], path: list[str]):
    response, prompts = start_tree(client, visit, workflow), []
    for answer in path:
        question = ((response.get("NextInputNode") or {}).get("Question") or {})
        prompts.append({"prompt": question.get("Prompt", ""), "answer": answer})
        response = submit_answer(client, response, answer)
    return response, prompts


def enumerate_paths(client: PublicEpicClient, visit: dict[str, Any], workflow: dict[str, Any], max_paths: int, max_depth: int, max_answers: int):
    if not visit.get("AnonymousSchedulingDecisionTreeId"):
        return [{"answers": [], "prompts": [], "tree_answer_id": None}], []
    queue, seen, complete, audit = deque([[]]), set(), [], []
    while queue and len(complete) < max_paths:
        path = queue.popleft(); key = tuple(path)
        if key in seen: continue
        seen.add(key); response, prompts = replay(client, visit, workflow, path)
        traversal = response.get("TraversalInfo") or {}
        if traversal.get("IsTraversalComplete"):
            complete.append({"answers": path, "prompts": prompts, "tree_answer_id": traversal.get("TreeAnswerID")}); continue
        question = ((response.get("NextInputNode") or {}).get("Question") or {})
        if len(path) >= max_depth:
            audit.append({"status": "excluded", "answer_path": json.dumps(path), "message": f"depth cap {max_depth}"}); continue
        options = choices(question)
        if not options:
            answer = fallback_answer(question); options = [answer] if answer else []
        if len(options) > max_answers:
            audit.append({"status": "excluded", "answer_path": json.dumps(path), "message": f"answer cap {max_answers}"})
        queue.extend(path + [answer] for answer in options[:max_answers])
    if queue: audit.append({"status": "excluded", "message": f"path cap {max_paths}; {len(queue)} prefixes remained"})
    return complete, audit


def evaluate_path(client: PublicEpicClient, workflow: dict[str, Any], visit: dict[str, Any], reason: dict[str, Any], path: dict[str, Any]):
    tree_id = visit.get("AnonymousSchedulingDecisionTreeId")
    if not tree_id: return {"override": None, "evaluated": {}, "stop": False, "message": ""}
    override = {"LqfIds": [tree_id], "HqaIds": [path.get("tree_answer_id")], "OriginalPrcId": item_id(visit),
                "OriginalRfv": reason.get("CategoryValue"), "OriginalRfvLine": reason.get("LineInWDF15000") or reason.get("Id", reason.get("ID"))}
    evaluated = client.post_json("questionnaire_evaluation", {"workflow": workflow,
        "schedulingOverridesString": json.dumps(override, separators=(",", ":")), "termIds": [], "nonce": client.page_nonce})
    message = " ".join(re.sub(r"<[^>]+>", " ", str(evaluated.get("Instructions") or "")).split())
    return {"override": override, "evaluated": evaluated, "stop": bool(evaluated.get("StopScheduling")), "message": message}


def build_slot_request(settings, workflow, specialty, reason, visit, pairs, result):
    override = result.get("override") or {}
    return {"workflow": workflow, "appointmentBuilder": {"Appointments": [{
        "VisitTypeId": item_id(visit), "PanelId": None, "BundleId": None, "RescheduleDat": None,
        "TicketId": None, "AppointmentRequestIds": [], "ProviderDepartmentPairs": [{
            "ProviderId": pair.get("ProviderId"), "DepartmentId": pair.get("DepartmentId"),
            "ChildProviderIds": pair.get("ChildProviderIds", []), "IsTeamMember": pair.get("IsTeamMember"),
            "PoolLine": pair.get("PoolLine"), "PoolTier": pair.get("PoolTier")} for pair in pairs],
        "Slot": "", "OrderIds": [], "LqfIds": override.get("LqfIds", []),
        "PatientAnswerIds": override.get("HqaIds", []), "OriginalVisitTypeId": override.get("OriginalPrcId"),
        "AddToWaitList": None, "SearchStartDte": None, "SelectedTelehealthMode": visit.get("DefaultTelehealthMode"),
        "HasTelehealthToggles": None, "HasUsedTelehealthToggles": None, "AccessCode": None,
        "CanSkipLicensureCheck": None, "InitialPoolLine": visit.get("PoolLine"),
        "MaxPoolLine": visit.get("MaxPoolLine"), "MaxPoolTier": visit.get("MaxPoolTier")}],
        "ReasonForVisitLine": reason.get("LineInWDF15000") or reason.get("Id", reason.get("ID")),
        "ReasonForVisitValue": reason.get("CategoryValue"), "ReasonForVisitAllowProviderSelection": reason.get("AllowProviderSelect"),
        "UseInsuranceForVisit": "", "SpecialtyId": item_id(specialty), "ClientIANATimeZone": "America/New_York", "SearchPriority": 0},
        "startDte": settings.get("CurrentDTE"), "useSchedulingPreferences": False, "continueInfo": None}


def parse_address(department: dict[str, Any]):
    address = department.get("Address", "")
    if isinstance(address, list): address = ", ".join(str(part) for part in address if part)
    address = str(address or ""); match = re.search(r",\s*([^,]+?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$", address)
    return address, (match.group(1) if match else ""), (match.group(2) if match else ""), (match.group(3) if match else "")


def normalize_slot(slot, site, specialty, visit, reason, path, providers, departments, load, flow_id):
    provider, department = providers.get(slot.get("ProviderId"), {}), departments.get(slot.get("DepartmentId"), {})
    address, city, state, zip_code = parse_address(department); appointment_type = visit.get("DisplayName") or visit.get("Name", "")
    path_text = " | ".join(f"{item['prompt']} => {item['answer']}" for item in path)
    return {"flow_id": flow_id, "specialty": specialty.get("Name", ""), "appointment_type": appointment_type,
        "visit_type": appointment_type, "reason_for_visit": reason.get("DisplayName") or reason.get("Title", ""),
        "questionnaire_path": path_text, "decision_tree_path": path_text,
        "provider_name": provider.get("Name", ""), "provider_id": item_id(provider) or slot.get("ProviderId", ""),
        "provider_credentials": provider.get("Credentials", ""), "location_name": department.get("Name", ""),
        "department_id": item_id(department) or slot.get("DepartmentId", ""), "address": address, "city": city,
        "state": state, "zip": zip_code, "appointment_date": slot.get("DateString", ""),
        "appointment_time": slot.get("TimeString", ""), "display_datetime_utc": slot.get("DisplayDateTimeUtc", ""),
        "days_ahead": slot.get("DaysAhead", ""), "length_minutes": slot.get("LengthInMinutes", ""),
        "timezone": slot.get("TimeZoneMarker", ""), "load_number": load,
        "source_url": site.base_url + site.endpoints["bootstrap"]}


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore"); writer.writeheader(); writer.writerows(rows)


def save(output: Path, rows: list[dict[str, Any]], audit: list[dict[str, Any]], system: str) -> None:
    unique = list({(row["flow_id"], row["provider_id"], row["department_id"], row["display_datetime_utc"]): row for row in rows}.values())
    write_csv(output / f"{system}-cardiology-slots.csv", unique, SLOT_FIELDS)
    write_csv(output / f"{system}-cardiology-flow-audit.csv", audit, AUDIT_FIELDS)
    (output / f"{system}-cardiology-slots.json").write_text(json.dumps(unique, ensure_ascii=False), encoding="utf-8")
    (output / f"{system}-cardiology-flow-audit.json").write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")


def extract(site: Site, output: Path, args: Any) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=False); client = PublicEpicClient(site, args.retries, args.request_delay)
    rows, audit = [], []
    try:
        client.bootstrap()
        catalog = client.post_json("workflow", {"schedulingParameters.isAnonymous": "true", "schedulingParameters.workflow": "NewProvider", "nonce": client.page_nonce})
        settings, workflow = catalog.get("WorkflowSettings", {}), workflow_model(catalog.get("WorkflowSettings", {}))
        specialties = [item for item in catalog.get("Specialties", []) if norm(item.get("Name")) == norm(SPECIALTY)]
        if not specialties: raise RuntimeError("Cardiology was not found in the anonymous specialty catalog")
        for specialty in specialties:
            detail = client.post_json("specialty", {"SpecialtyId": item_id(specialty), "isFirstLoad": "true", "schedulingOverridesString": "{}"})
            supported = {info.get("VisitTypeID") for pair in detail.get("ProviderDepartmentPairs", []) for info in pair.get("VisitTypeInformation", [])}
            visits = [visit for visit in detail.get("VisitTypes", []) if not supported or item_id(visit) in supported]
            for visit in visits:
                visit_name = visit.get("DisplayName") or visit.get("Name", "")
                paths, excluded = enumerate_paths(client, visit, workflow, args.max_paths, args.max_depth, args.max_answers)
                audit.extend({"specialty": SPECIALTY, "appointment_type": visit_name, **item} for item in excluded)
                reasons = [reason for reason in detail.get("ReasonsForVisit", []) if reason.get("CanDirectSchedule") is not False]
                visit_id = item_id(visit); compatible = [reason for reason in reasons if not reason.get("DefaultVisitTypeId") or reason.get("DefaultVisitTypeId") == visit_id or reason.get("VisitTypeId") == visit_id]
                for reason in compatible or reasons or [{}]:
                    for path in paths:
                        flow_id = hashlib.sha256("\x1f".join(map(str, [site.code, item_id(visit), item_id(reason), json.dumps(path["answers"])])).encode()).hexdigest()[:20]
                        try:
                            result = evaluate_path(client, workflow, visit, reason, path)
                            if result["stop"]:
                                audit.append({"flow_id": flow_id, "specialty": SPECIALTY, "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": "public_stop", "slot_count": 0, "answer_path": json.dumps(path["answers"]), "message": result["message"]}); continue
                            evaluated = result.get("evaluated") or {}; active = detail
                            if result.get("override"):
                                active = client.post_json("specialty", {"SpecialtyId": item_id(specialty), "isFirstLoad": "false",
                                    "schedulingOverridesString": json.dumps(result["override"], separators=(",", ":"))})
                            active_visit_id = evaluated.get("VisitTypeId") or item_id(visit)
                            active_visit = next((item for item in active.get("VisitTypes", []) if item_id(item) == active_visit_id), visit)
                            pairs = [pair for pair in active.get("ProviderDepartmentPairs", []) if any(info.get("VisitTypeID") == item_id(active_visit) for info in pair.get("VisitTypeInformation", []))]
                            if not pairs: pairs = active.get("ProviderDepartmentPairs", []) or detail.get("ProviderDepartmentPairs", [])
                            selected = set(evaluated.get("ProvidersToSelect") or []) if evaluated.get("ReplacedAllOriginalProviders") else set()
                            if selected: pairs = [pair for pair in pairs if pair.get("ProviderId") in selected]
                            model = build_slot_request(settings, workflow, specialty, reason, active_visit, pairs, result)
                            providers = {item_id(item): item for item in active.get("Providers", [])}; departments = {item_id(item): item for item in active.get("Departments", [])}
                            flow_rows, seen_pages, seen_tokens, status, message, loads = [], set(), set(), "natural_stop", "", 0
                            for load in range(1, args.max_slot_loads + 1):
                                data = client.post_json("slots", model); loads = load
                                signature = hashlib.sha256(json.dumps(data.get("Solutions", []), sort_keys=True).encode()).hexdigest()
                                if signature in seen_pages: status, message = "repeated_page_stop", "Repeated Solutions page"; break
                                seen_pages.add(signature)
                                for solution in data.get("Solutions", []):
                                    for slot in solution.get("Slots", []): flow_rows.append(normalize_slot(slot, site, specialty, active_visit, reason, path["prompts"], providers, departments, load, flow_id))
                                continuation = data.get("ContinueInfo"); model["continueInfo"] = continuation
                                if data.get("ErrorCode"): status, message = "slot_lookup_error", str(data.get("ErrorCode")); break
                                if not continuation or continuation.get("IsStopSearch"): break
                                token = json.dumps(continuation, sort_keys=True, default=str)
                                if token in seen_tokens: status, message = "repeated_continue_stop", "Repeated ContinueInfo"; break
                                seen_tokens.add(token)
                            else: status, message = "page_guard_reached", f"Maximum {args.max_slot_loads} pages reached"
                            rows.extend(flow_rows); audit.append({"flow_id": flow_id, "specialty": SPECIALTY, "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": status, "slot_count": len(flow_rows), "loads_completed": loads, "answer_path": json.dumps(path["answers"]), "message": message})
                        except Exception as error:
                            audit.append({"flow_id": flow_id, "specialty": SPECIALTY, "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": "flow_error", "slot_count": 0, "answer_path": json.dumps(path["answers"]), "message": str(error)})
                        save(output, rows, audit, site.code.lower())
    except Exception:
        (output / f"{site.code.lower()}-cardiology-error.txt").write_text(traceback.format_exc(), encoding="utf-8"); raise
    finally:
        save(output, rows, audit, site.code.lower())
    return {"system": site.code, "rows": len(rows), "auditRows": len(audit), "output": str(output)}
