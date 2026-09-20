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
from datetime import date
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
# The anonymous catalog names each extraction pulls come from src/shared/specialties.json (one list shared
# with the Node scripts): a specialty maps to one or more catalog entry names per system.
REGISTRY = Path(__file__).resolve().parents[2] / "src" / "shared" / "specialties.json"


def load_specialty(spec_id: str) -> dict[str, Any]:
    entries = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for entry in entries:
        if entry.get("id") == spec_id: return entry
    raise RuntimeError(f"Unknown specialty {spec_id!r}; src/shared/specialties.json lists: {', '.join(e.get('id', '?') for e in entries)}")


def select_catalog_entries(catalog: dict[str, Any], names: list[str]) -> list[dict[str, Any]]:
    """The catalog specialties whose display name is one of `names` (case and whitespace do not matter)."""
    wanted = {norm(name) for name in names}
    return [item for item in catalog.get("Specialties", []) if norm(item.get("Name")) in wanted]
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
        # A maintenance or error page (HTML with status 200) is transient; retry it like a network failure.
        for attempt in range(1, self.retries + 1):
            body = self._open(request).decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
            except ValueError:
                data = None
            if isinstance(data, dict):
                time.sleep(self.request_delay)
                return data
            if attempt < self.retries:
                time.sleep(min(30, 2 * self.request_delay * (2 ** attempt)))
        raise RuntimeError(f"{endpoint} returned non-JSON data after {self.retries} attempts")


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


LATERALITY = {"left", "right", "both", "bilateral", "na", "n/a", "not applicable", "unsure", "not sure"}


def representative_choices(options: list[str]) -> list[str]:
    """Answers that do not change where the questionnaire routes are sampled instead of walked: a long list of
    numbers (an age picker, 0..100) becomes its middle and last value (an adult and an elder; the site's pediatric
    routing is out of scope), and a laterality question (Left / Right / Both / NA) keeps its first answer. Every
    other list is walked whole, so body parts and yes/no branches all get their own flows."""
    if len(options) >= 20 and all(re.fullmatch(r"\d+", option.strip()) for option in options):
        return [options[len(options) // 2], options[-1]]
    if len(options) > 1 and all(norm(option) in LATERALITY for option in options):
        return options[:1]
    return options


VERIFY_AT = (12, 60, 250)  # meetings of a question that are walked in full again to re-check its learned rule


def enumerate_paths(client: PublicEpicClient, visit: dict[str, Any], workflow: dict[str, Any], max_paths: int, max_depth: int, max_answers: int, resolve=None, note=None):
    """Walk a visit type's scheduling questionnaire and return every answer path worth searching, plus audit rows
    about what was sampled instead of walked.

    Epic keeps one in-progress answer record per traversal, so a stored response cannot be branched twice (checked
    against Orlando Health on 2026-09-20): the first answer to a question continues the traversal in one request,
    every other answer replays the path from the root. A questionnaire that multiplies a long body-part list by
    yes/no and insurance questions has thousands of paths, so the walker learns as it goes. `resolve(path)` says
    where a complete path leads (the openings search it would run, or a scheduling stop). The first time a question
    is met every answer is walked; answers whose paths lead to the same searches are then asked once from that
    point on, and answers that only stop scheduling are skipped. At later meetings (VERIFY_AT) the question is
    walked in full again; a rule that no longer holds is withdrawn and the answers it skipped are walked after all.
    Without `resolve` nothing is learned and every path is walked. `note(record)` receives progress records."""
    if not visit.get("AnonymousSchedulingDecisionTreeId"):
        return [{"answers": [], "prompts": [], "tree_answer_id": None}], []
    complete: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []
    rules: dict[str, dict[str, Any]] = {}  # prompt -> {"classes": {answer: "STOP" or the answer it routes like}, "withdrawn": bool}
    meetings: dict[str, int] = {}
    skipped: dict[str, list[tuple[list[str], list[dict[str, Any]], str]]] = {}  # prompt -> answers a rule skipped, in case it is withdrawn
    capped = [False]
    noted: set[str] = set()  # prompts whose list sampling was already written to the audit
    tell = note or (lambda record: None)

    def outcome_of(info: dict[str, Any]) -> str:
        if resolve is None: return "walked"
        resolved = resolve(info); info["resolved"] = resolved
        if len(complete) % 25 == 0: tell({"walk": "progress", "paths": len(complete), "rules": len(rules)})
        return "STOP" if resolved["stop"] else str(resolved["search_key"])

    def classify(by_answer: dict[str, set[str]]) -> dict[str, str]:
        """An answer's class is STOP when every path under it stops, else the set of searches under it (a stop that
        sits next to searches does not matter: it yields no openings). Answers with the same class route alike."""
        classes: dict[str, str] = {}; representative: dict[str, str] = {}
        for answer, outcomes in by_answer.items():
            searches = sorted(outcome for outcome in outcomes if outcome != "STOP")
            classes[answer] = "STOP" if not searches else representative.setdefault("|".join(searches), answer)
        return classes

    def same_partition(learned: dict[str, str], found: dict[str, str]) -> bool:
        answers = [answer for answer in found if answer in learned]
        return all((learned[a] == "STOP") == (found[a] == "STOP") and (learned[a] == learned[b]) == (found[a] == found[b])
                   for a in answers for b in answers)

    def describe(prompt: str, classes: dict[str, str], path: list[str]) -> None:
        stops = [answer for answer, cls in classes.items() if cls == "STOP"]
        groups: dict[str, list[str]] = {}
        for answer, cls in classes.items():
            if cls != "STOP": groups.setdefault(cls, []).append(answer)
        notes = [f"{stops} only stop scheduling and are skipped from here on"] if stops else []
        notes += [f"{members} route alike; only {rep!r} is walked from here on" for rep, members in groups.items() if len(members) > 1]
        if notes: audit.append({"status": "sampled", "answer_path": json.dumps(path), "message": f"{prompt[:70]!r}: " + "; ".join(notes)})

    def walk(path: list[str], prompts: list[dict[str, Any]], response: dict[str, Any]):
        """Walks everything under one questionnaire node; returns the outcomes found, or None when a cap cut it short."""
        traversal = response.get("TraversalInfo") or {}
        if traversal.get("IsTraversalComplete"):
            info = {"answers": list(path), "prompts": list(prompts), "tree_answer_id": traversal.get("TreeAnswerID")}
            complete.append(info); return {outcome_of(info)}
        question = ((response.get("NextInputNode") or {}).get("Question") or {}); prompt = question.get("Prompt", "")
        if len(path) >= max_depth:
            audit.append({"status": "excluded", "answer_path": json.dumps(path), "message": f"depth cap {max_depth}"}); return None
        options = choices(question)
        if not options:
            answer = fallback_answer(question); options = [answer] if answer else []
        sampled = representative_choices(options)
        if sampled is not options:
            if prompt not in noted:
                noted.add(prompt); audit.append({"status": "sampled", "answer_path": json.dumps(path), "message": f"{prompt[:70]!r}: list of {len(options)} answers sampled to {sampled}"})
            options = sampled
        if len(options) > max_answers:
            audit.append({"status": "excluded", "answer_path": json.dumps(path), "message": f"answer cap {max_answers}"}); options = options[:max_answers]
        meetings[prompt] = meetings.get(prompt, 0) + 1
        rule = rules.get(prompt)
        full = rule is None or rule["withdrawn"] or meetings[prompt] in VERIFY_AT or len(options) < 2
        chosen = list(options)
        if not full:
            chosen, kept = [], set()
            for answer in options:
                cls = rule["classes"].get(answer, answer)  # an answer never met before is walked
                if cls == "STOP" or cls in kept: skipped.setdefault(prompt, []).append((list(path), list(prompts), answer)); continue
                kept.add(cls); chosen.append(answer)
        by_answer: dict[str, set[str]] = {}; cut = False
        for index, answer in enumerate(chosen):
            if len(complete) >= max_paths: capped[0] = True; cut = True; break
            step = submit_answer(client, response, answer) if index == 0 else replay(client, visit, workflow, path + [answer])[0]
            outcomes = walk(path + [answer], prompts + [{"prompt": prompt, "answer": answer}], step)
            if outcomes is None: cut = True
            else: by_answer[answer] = outcomes
        found = set().union(*by_answer.values()) if by_answer else set()
        if cut or not full or len(by_answer) < 2 or resolve is None: return None if cut else found
        classes = classify(by_answer)
        if rule is None:
            rules[prompt] = {"classes": classes, "withdrawn": False}; describe(prompt, classes, path)
            tell({"walk": "rule", "prompt": prompt[:70], "classes": classes, "paths": len(complete)})
        elif not rule["withdrawn"]:
            if same_partition(rule["classes"], classes):
                audit.append({"status": "sampled", "answer_path": json.dumps(path), "message": f"{prompt[:70]!r}: rule re-checked at meeting {meetings[prompt]}, still holds"})
            else:
                rule["withdrawn"] = True; tell({"walk": "conflict", "prompt": prompt[:70], "paths": len(complete)})
                audit.append({"status": "rule_conflict", "answer_path": json.dumps(path), "message": f"{prompt[:70]!r} routes differently here than where its rule was learned; the rule is withdrawn and every answer it skipped is walked"})
                for skipped_path, skipped_prompts, answer in skipped.pop(prompt, []):
                    if len(complete) >= max_paths: capped[0] = True; break
                    outcomes = walk(skipped_path + [answer], skipped_prompts + [{"prompt": prompt, "answer": answer}], replay(client, visit, workflow, skipped_path + [answer])[0])
                    if outcomes: found |= outcomes
        return found

    walk([], [], start_tree(client, visit, workflow))
    if capped[0]: audit.append({"status": "excluded", "message": f"path cap {max_paths}; parts of the questionnaire were not walked"})
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


def resolve_path(client: PublicEpicClient, settings, workflow, specialty, detail, visit, reason, path):
    """Where a complete questionnaire path leads: a scheduling stop, or the visit type, provider pairs and openings
    search (with its signature) that the path's answers select."""
    result = evaluate_path(client, workflow, visit, reason, path)
    resolved: dict[str, Any] = {"stop": bool(result["stop"]), "message": result["message"], "reason_id": item_id(reason), "result": result}
    if result["stop"]: return resolved
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
    resolved.update({"active_visit": active_visit, "pairs": pairs, "model": model, "search_key": search_signature(model),
                     "providers": {item_id(item): item for item in active.get("Providers", [])},
                     "departments": {item_id(item): item for item in active.get("Departments", [])}})
    return resolved

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


MAX_DAYS_AHEAD = 560  # Orlando Health publishes about 18 months of openings; nothing lies past this
REPEAT_STRIKES = 3    # consecutive re-served pages tolerated before the search restarts after the last window
EMPTY_WINDOWS = 40    # searched windows in a row (about four months of weekdays) with no opening = end of the schedule
CHECKPOINT_PAGES = 250  # a big flow runs for hours; its rows are written to disk this often, not only at its end
OUTAGE_RETRIES, OUTAGE_PAUSE = 6, 90  # pauses (seconds) before a page request is asked again during an outage


def search_signature(model: dict[str, Any]) -> str:
    """Identity of a slot search: everything in the request except the questionnaire ids and the paging state."""
    builder = model.get("appointmentBuilder") or {}
    appointments = [{key: value for key, value in appointment.items() if key not in ("LqfIds", "PatientAnswerIds", "OriginalVisitTypeId")}
                    for appointment in builder.get("Appointments", [])]
    return json.dumps({**model, "startDte": None, "continueInfo": None, "appointmentBuilder": {**builder, "Appointments": appointments}}, sort_keys=True, default=str)


def trace(output: Path, record: dict[str, Any]) -> None:
    with (output / "paging-trace.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, default=str) + "\n")


def write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore"); writer.writeheader(); writer.writerows(rows)


PARTS = "parts"          # one JSON-lines file per flow, so a run never has to hold every slot in memory
CACHE_MAX_ROWS = 30000   # searches bigger than this are not kept for reuse (memory); a twin flow just runs again
EPIC_EPOCH = date(1840, 12, 31)  # Epic's DTE day numbers count from here


def part_path(output: Path, flow_id: str, kind: str = "") -> Path:
    return output / PARTS / f"{flow_id}{kind}.jsonl"


def row_key(row: dict[str, Any]) -> bytes:
    text = "\x1f".join(str(row.get(field, "")) for field in ("flow_id", "provider_id", "department_id", "display_datetime_utc"))
    return hashlib.blake2b(text.encode("utf-8"), digest_size=12).digest()


def iter_rows(path: Path):
    if not path.exists(): return
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line: yield json.loads(line)


def write_part(path: Path, rows, append: bool = False) -> int:
    path.parent.mkdir(parents=True, exist_ok=True); count = 0
    with path.open("a" if append else "w", encoding="utf-8") as handle:
        for row in rows: handle.write(json.dumps(row, ensure_ascii=False) + "\n"); count += 1
    return count


def finish_part(output: Path, flow_id: str) -> int:
    """Seed and partial rows of a flow become its finished part file, deduplicated; returns the row count."""
    seen, count, final = set(), 0, part_path(output, flow_id); temp = final.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for kind in (".seed", ".partial"):
            for row in iter_rows(part_path(output, flow_id, kind)):
                key = row_key(row)
                if key in seen: continue
                seen.add(key); handle.write(json.dumps(row, ensure_ascii=False) + "\n"); count += 1
    temp.replace(final)
    for kind in (".seed", ".partial"): part_path(output, flow_id, kind).unlink(missing_ok=True)
    return count


def save(output: Path, audit: list[dict[str, Any]], system: str, memory_rows, spec_id: str = "cardiology") -> int:
    """Rebuild the CSV and JSON outputs by streaming every part file plus the rows still in memory."""
    seen, count = set(), 0
    csv_path, json_path = output / f"{system}-{spec_id}-slots.csv", output / f"{system}-{spec_id}-slots.json"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as csv_handle, json_path.open("w", encoding="utf-8") as json_handle:
        writer = csv.DictWriter(csv_handle, fieldnames=SLOT_FIELDS, extrasaction="ignore"); writer.writeheader(); json_handle.write("[")
        sources = [iter_rows(path) for path in sorted((output / PARTS).glob("*.jsonl"))] + [iter(memory_rows)]
        for source in sources:
            for row in source:
                key = row_key(row)
                if key in seen: continue
                seen.add(key)
                if count: json_handle.write(",")
                json_handle.write(json.dumps(row, ensure_ascii=False)); writer.writerow(row); count += 1
        json_handle.write("]")
    write_csv(output / f"{system}-{spec_id}-flow-audit.csv", audit, AUDIT_FIELDS)
    (output / f"{system}-{spec_id}-flow-audit.json").write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    return count


def stream_json_array(path: Path):
    """Yield the objects of a large JSON array file a few megabytes at a time."""
    decoder, position = json.JSONDecoder(), 0
    with path.open("r", encoding="utf-8") as handle:
        buffer = handle.read(1 << 22).lstrip()
        if buffer.startswith("["): buffer = buffer[1:]
        while True:
            while True:
                while position < len(buffer) and buffer[position] in " \r\n\t,": position += 1
                if position < len(buffer) and buffer[position] == "]": return
                try: obj, end = decoder.raw_decode(buffer, position)
                except ValueError: break  # the object continues in the next chunk
                position = end; yield obj
            chunk = handle.read(1 << 22)
            if not chunk: return
            buffer, position = buffer[position:] + chunk, 0


def load_checkpoint(output: Path, system: str, spec_id: str = "cardiology"):
    """A run folder left by an interrupted extraction: finished flows keep their part files and audit rows,
    failed flows run again (continuing from their partial rows when they have some), and a flow that was
    mid-search resumes at the window of its last checkpointed page, re-walking that window (the physical
    dedup absorbs the overlap). A folder written before part files existed is split from its slots.json."""
    audit_path, slots_path, trace_path, parts = output / f"{system}-{spec_id}-flow-audit.json", output / f"{system}-{spec_id}-slots.json", output / "paging-trace.jsonl", output / PARTS
    audit = json.loads(audit_path.read_text(encoding="utf-8")) if audit_path.exists() else []
    failed = {item.get("flow_id") for item in audit if item.get("status") in ("flow_error", "request_failed")}
    audit = [item for item in audit if item.get("flow_id") not in failed]
    done = {item.get("flow_id") for item in audit if item.get("flow_id")}
    parts.mkdir(exist_ok=True)
    if not any(parts.glob("*.jsonl")) and slots_path.exists():
        handles = {}
        try:
            for row in stream_json_array(slots_path):
                flow_id = row["flow_id"]; kind = "" if flow_id in done else ".seed"
                if (flow_id, kind) not in handles: handles[(flow_id, kind)] = part_path(output, flow_id, kind).open("w", encoding="utf-8")
                handles[(flow_id, kind)].write(json.dumps(row, ensure_ascii=False) + "\n")
        finally:
            for handle in handles.values(): handle.close()
    pages: dict[tuple[str, int], Any] = {}
    if trace_path.exists():
        for line in trace_path.read_text(encoding="utf-8").splitlines():
            try: record = json.loads(line)
            except ValueError: continue
            if "load" in record and "outage" not in record: pages[(record["flow_id"], record["load"])] = record.get("start")
    resumed = {}
    for path in sorted(parts.glob("*.partial.jsonl")) + sorted(parts.glob("*.seed.jsonl")):
        flow_id = path.name.split(".")[0]
        if flow_id in done: path.unlink(); continue  # a leftover of a flow that did finish
        if flow_id in resumed: continue
        seed, partial = part_path(output, flow_id, ".seed"), part_path(output, flow_id, ".partial")
        if partial.exists(): write_part(seed, iter_rows(partial), append=True); partial.unlink()
        kept, last_load, last_day = 0, 0, ""
        for row in iter_rows(seed):
            kept += 1; last_load = max(last_load, int(row.get("load_number") or 0)); last_day = max(last_day, str(row.get("display_datetime_utc", ""))[:10])
        # the earliest of: the window of the last checkpointed page, and the day before the last slot seen
        # (the checkpoint may have cut a window in half; that window is walked again and deduplicated)
        candidates = [value for value in (pages.get((flow_id, last_load)),) if isinstance(value, int)]
        if last_day: candidates.append((date.fromisoformat(last_day) - EPIC_EPOCH).days - 1)
        resumed[flow_id] = {"resume_from": min(candidates) if candidates else None, "kept_rows": kept}
    return audit, resumed, done


def extract(site: Site, output: Path, args: Any) -> dict[str, Any]:
    resume = bool(getattr(args, "resume", False))
    spec_id = str(getattr(args, "specialty", "") or "cardiology")
    names = list(load_specialty(spec_id).get("catalog", {}).get(site.code.lower(), []))
    if not names: raise RuntimeError(f"src/shared/specialties.json lists no {site.name} catalog names for {spec_id}; run catalog_probe.py and fill them in")
    output.mkdir(parents=True, exist_ok=resume); (output / PARTS).mkdir(exist_ok=True); client = PublicEpicClient(site, args.retries, args.request_delay)
    audit, search_cache, total_rows, system = [], {}, 0, site.code.lower()
    resumed_flows, done_flows = {}, set()
    current: dict[str, Any] = {"flow_id": None, "rows": []}  # the flow in progress: rows not yet flushed to its partial file
    if resume:
        audit, resumed_flows, done_flows = load_checkpoint(output, system, spec_id)
        trace(output, {"resume": True, "finished_flows": len(done_flows), "partial_flows": {k: v["kept_rows"] for k, v in resumed_flows.items()}})
    try:
        client.bootstrap()
        catalog = client.post_json("workflow", {"schedulingParameters.isAnonymous": "true", "schedulingParameters.workflow": "NewProvider", "nonce": client.page_nonce})
        settings, workflow = catalog.get("WorkflowSettings", {}), workflow_model(catalog.get("WorkflowSettings", {}))
        specialties = select_catalog_entries(catalog, names)
        if not specialties:
            available = ", ".join(sorted(str(item.get("Name", "")) for item in catalog.get("Specialties", [])))
            raise RuntimeError(f"none of {names} was found in the anonymous specialty catalog; it offers: {available}")
        for specialty in specialties:
            detail = client.post_json("specialty", {"SpecialtyId": item_id(specialty), "isFirstLoad": "true", "schedulingOverridesString": "{}"})
            supported = {info.get("VisitTypeID") for pair in detail.get("ProviderDepartmentPairs", []) for info in pair.get("VisitTypeInformation", [])}
            visits = [visit for visit in detail.get("VisitTypes", []) if not supported or item_id(visit) in supported]
            only_visits = {norm(name) for name in (getattr(args, "only_visits", None) or [])}
            for visit in visits:
                visit_name = visit.get("DisplayName") or visit.get("Name", "")
                if only_visits and norm(visit_name) not in only_visits: continue  # a split run: one visit type per process
                reasons = [reason for reason in detail.get("ReasonsForVisit", []) if reason.get("CanDirectSchedule") is not False]
                visit_id = item_id(visit); compatible = [reason for reason in reasons if not reason.get("DefaultVisitTypeId") or reason.get("DefaultVisitTypeId") == visit_id or reason.get("VisitTypeId") == visit_id]
                first_reason = (compatible or reasons or [{}])[0]
                paths, excluded = enumerate_paths(client, visit, workflow, args.max_paths, args.max_depth, args.max_answers,
                    resolve=lambda path: resolve_path(client, settings, workflow, specialty, detail, visit, first_reason, path),
                    note=lambda record: trace(output, {"visit": visit_name, **record}))
                trace(output, {"visit": visit_name, "walk": "done", "paths": len(paths), "searches": len({p["resolved"]["search_key"] for p in paths if p.get("resolved") and not p["resolved"]["stop"]}), "stops": sum(1 for p in paths if (p.get("resolved") or {}).get("stop"))})
                audit.extend({"specialty": specialty.get("Name", ""), "appointment_type": visit_name, **item} for item in excluded)
                only = set(getattr(args, "only_answer_paths", None) or [])
                for reason in compatible or reasons or [{}]:
                    for path in paths:
                        if only and json.dumps(path["answers"]) not in only: continue  # a retry of specific flows
                        flow_id = hashlib.sha256("\x1f".join(map(str, [site.code, item_id(specialty), item_id(visit), item_id(reason), json.dumps(path["answers"])])).encode()).hexdigest()[:20]
                        if flow_id in done_flows: continue  # finished before the interruption; its rows and audit were kept
                        try:
                            resolved = path.get("resolved") if (path.get("resolved") or {}).get("reason_id") == item_id(reason) else None
                            if resolved is None: resolved = resolve_path(client, settings, workflow, specialty, detail, visit, reason, path)
                            result = resolved["result"]
                            if resolved["stop"]:
                                audit.append({"flow_id": flow_id, "specialty": specialty.get("Name", ""), "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": "public_stop", "slot_count": 0, "answer_path": json.dumps(path["answers"]), "message": resolved["message"]}); continue
                            active_visit, pairs, model = resolved["active_visit"], resolved["pairs"], resolved["model"]
                            providers, departments = resolved["providers"], resolved["departments"]
                            # Questionnaire paths that end in the same visit type, providers, reason and telehealth
                            # mode ask Epic the same question; the answer ids in the request do not change the openings.
                            search_key = resolved["search_key"]
                            cached = search_cache.get(search_key)
                            if cached:
                                count = write_part(part_path(output, flow_id), (normalize_slot(slot, site, specialty, active_visit, reason, path["prompts"], providers, departments, load, flow_id) for slot, load in cached["raw"]))
                                audit.append({"flow_id": flow_id, "specialty": specialty.get("Name", ""), "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": cached["status"], "slot_count": count, "loads_completed": cached["loads"], "answer_path": json.dumps(path["answers"]), "message": f"reused the search of flow {cached['flow_id']}; {cached['message']}".rstrip("; "), "search_restarts": cached["restarts"], "last_window_end": cached["last_end"], "search_reused_from": cached["flow_id"]})
                                continue
                            flow_rows, raw_slots, seen_pages, seen_tokens, status, message, loads = [], [], set(), set(), "natural_stop", "", 0
                            start_dte, last_end, restarts, restart_from, strikes = model.get("startDte"), None, 0, None, 0
                            max_days_ahead = getattr(args, "max_days_ahead", MAX_DAYS_AHEAD)
                            window, window_slots, empty_windows = None, 0, 0
                            outages, cacheable = 0, True
                            current["flow_id"], current["rows"] = flow_id, flow_rows
                            seed = resumed_flows.pop(flow_id, None)
                            if seed:  # this flow was mid-search when the run was interrupted; its earlier rows wait in parts/
                                cacheable = False
                                if isinstance(seed["resume_from"], int):
                                    model["startDte"], last_end = seed["resume_from"], seed["resume_from"] - 1
                                trace(output, {"flow_id": flow_id, "resumed_from": seed["resume_from"], "kept_rows": seed["kept_rows"]})
                            for load in range(1, args.max_slot_loads + 1):
                                try: data = client.post_json("slots", model)
                                except Exception as error:
                                    # an outage in the middle of a flow that has run for hours: wait it out and ask for
                                    # the same page again (the continuation is plain data, it does not expire); give up
                                    # only after several pauses, keeping every page gathered so far
                                    outages += 1
                                    if outages <= OUTAGE_RETRIES:
                                        trace(output, {"flow_id": flow_id, "load": load, "outage": outages, "error": str(error)[:200]})
                                        time.sleep(OUTAGE_PAUSE); continue
                                    status, message = "request_failed", f"page {load}: {error}"; break
                                loads = load
                                if load % CHECKPOINT_PAGES == 0:  # flush this flow's new rows to disk and rebuild the outputs
                                    write_part(part_path(output, flow_id, ".partial"), flow_rows, append=True); flow_rows.clear()
                                    save(output, audit, system, [], spec_id)
                                solutions = data.get("Solutions") or []
                                signature = hashlib.sha256(json.dumps(solutions, sort_keys=True).encode()).hexdigest()
                                continuation = data.get("ContinueInfo") or {}
                                token = json.dumps(continuation, sort_keys=True, default=str)
                                # Epic searches a short date window per page and walks the provider pairs inside it
                                # (NextProviderIndex). It sometimes re-serves an earlier page instead of moving on to
                                # the next window; a repeated non-empty page or a repeated continuation is that stall,
                                # not the end of the schedule. Empty pages are normal (a pair chunk with no openings).
                                repeated = token in seen_tokens or (bool(solutions) and signature in seen_pages)
                                trace(output, {"flow_id": flow_id, "load": load, "solutions": len(solutions),
                                    "slots": sum(len(solution.get("Slots", [])) for solution in solutions),
                                    "start": continuation.get("SearchRangeStartDte"), "end": continuation.get("SearchRangeEndDte"),
                                    "next_index": continuation.get("NextProviderIndex"), "stop": continuation.get("IsStopSearch"),
                                    "error": data.get("ErrorCode"), "repeated": repeated, "restarts": restarts, "start_dte": model.get("startDte")})
                                if data.get("ErrorCode"): status, message = "slot_lookup_error", str(data.get("ErrorCode")); break
                                if not repeated:
                                    seen_pages.add(signature); seen_tokens.add(token); strikes = 0
                                    for solution in solutions:
                                        for slot in solution.get("Slots", []):
                                            flow_rows.append(normalize_slot(slot, site, specialty, active_visit, reason, path["prompts"], providers, departments, load, flow_id))
                                            if raw_slots is not None: raw_slots.append((slot, load)); raw_slots = raw_slots if len(raw_slots) <= CACHE_MAX_ROWS else None
                                window_start, window_end =continuation.get("SearchRangeStartDte"), continuation.get("SearchRangeEndDte")
                                if isinstance(window_end, int) and not isinstance(window_end, bool): last_end = window_end if last_end is None else max(last_end, window_end)
                                if not continuation or continuation.get("IsStopSearch"): break
                                # The schedule ends where the search keeps finding nothing: count the searched windows
                                # (SearchRangeStartDte..EndDte, walked in order) that yield no opening at all.
                                if (window_start, window_end) != window:
                                    if window is not None: empty_windows = 0 if window_slots else empty_windows + 1
                                    window, window_slots = (window_start, window_end), 0
                                window_slots += sum(len(solution.get("Slots", [])) for solution in solutions) if not repeated else 0
                                if empty_windows >= EMPTY_WINDOWS: status, message = "schedule_end", f"{EMPTY_WINDOWS} searched windows in a row had no openings"; break
                                if isinstance(window_start, int) and isinstance(start_dte, int) and window_start > start_dte + max_days_ahead: status, message = "horizon_reached", f"Search window {window_start} is beyond {max_days_ahead} days ahead"; break
                                if repeated:
                                    # follow the continuation a couple of times first: a single re-served page still
                                    # points at the next chunk, and restarting early would skip the rest of its window
                                    strikes += 1
                                    if strikes < REPEAT_STRIKES: model["continueInfo"] = continuation; continue
                                    if last_end is None or not isinstance(start_dte, int): status, message = "repeated_page_stop", "Repeated Solutions page"; break
                                    next_start = last_end + 1
                                    if restart_from is not None and next_start <= restart_from: status, message = "restart_stalled", f"No progress after restarting the search at {next_start}"; break
                                    if next_start > start_dte + max_days_ahead: status, message = "horizon_reached", f"Search restart at {next_start} is beyond {max_days_ahead} days ahead"; break
                                    restart_from, restarts, strikes = next_start, restarts + 1, 0
                                    model["startDte"], model["continueInfo"] = next_start, None
                                    continue
                                model["continueInfo"] = continuation
                            else: status, message = "page_guard_reached", f"Maximum {args.max_slot_loads} pages reached"
                            write_part(part_path(output, flow_id, ".partial"), flow_rows, append=True); flow_rows.clear()
                            count = finish_part(output, flow_id); current["flow_id"] = None
                            audit.append({"flow_id": flow_id, "specialty": specialty.get("Name", ""), "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": status, "slot_count": count, "loads_completed": loads, "answer_path": json.dumps(path["answers"]), "message": message, "search_restarts": restarts, "last_window_end": last_end})
                            if cacheable and raw_slots is not None: search_cache[search_key] = {"raw": raw_slots, "status": status, "message": message, "loads": loads, "restarts": restarts, "last_end": last_end, "flow_id": flow_id}
                        except Exception as error:
                            if current["flow_id"] and current["rows"]: write_part(part_path(output, current["flow_id"], ".partial"), current["rows"], append=True); current["rows"].clear()
                            audit.append({"flow_id": flow_id, "specialty": specialty.get("Name", ""), "appointment_type": visit_name, "reason_for_visit": reason.get("DisplayName", ""), "status": "flow_error", "slot_count": 0, "answer_path": json.dumps(path["answers"]), "message": str(error)})
                        save(output, audit, system, current["rows"], spec_id)
    except Exception:
        (output / f"{system}-{spec_id}-error.txt").write_text(traceback.format_exc(), encoding="utf-8"); raise
    finally:
        if current["flow_id"] and current["rows"]: write_part(part_path(output, current["flow_id"], ".partial"), current["rows"], append=True); current["rows"].clear()
        total_rows = save(output, audit, system, [], spec_id)
    return {"system": site.code, "rows": total_rows, "auditRows": len(audit), "output": str(output)}
