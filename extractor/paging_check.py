"""Replay the slot paging loop against a scripted Epic and fail if any behaviour loses a slot.

The fake mirrors what both systems do: one-day windows walked in provider chunks (``State`` 2 pages
with a ``NextProviderIndex``), each window closed by an empty ``State`` 1 page, a lead time only for a
search that starts today, weekends without openings. The modes add the behaviours seen in real runs.
No network is used. Exit code 0 means every mode produced the complete schedule.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import types
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import epic_public as ep  # noqa: E402

TODAY, LEAD, HORIZON, CHUNK, PROVIDERS = 1000, 2, 40, 11, 22
MODES = ("normal", "server_stops", "reserve_once", "reserve_window", "stall_new_tokens", "stall_same_token", "outage_once", "failed_resume", "year_jump", "killed", "legacy_resume")
ep.OUTAGE_PAUSE = 0  # the real loop waits 90 seconds between outage retries


def opening(day: int, provider: str) -> dict:
    return {"ProviderId": provider, "DepartmentId": "d1", "DateString": f"day{day}", "TimeString": "8:00 AM",
            "DisplayDateTimeUtc": f"2026-01-01T00:00:00Z#{day}", "DaysAhead": day - TODAY, "LengthInMinutes": 30, "TimeZoneMarker": "E"}


def has_openings(day: int) -> bool:
    return TODAY + LEAD <= day <= TODAY + HORIZON and day % 7 not in (5, 6)


class ScriptedEpic:
    def __init__(self, mode: str):
        self.mode, self.requests, self.page_nonce, self.events = mode, 0, "nonce", []
        self.chunk = 4 if mode == "reserve_window" else CHUNK  # smaller chunks: a window has six pages, three can be re-served

    def bootstrap(self) -> None:
        pass

    def page(self, day: int, chunk: int) -> dict:
        CHUNK = self.chunk
        chunks = (PROVIDERS + CHUNK - 1) // CHUNK
        if chunk >= chunks:  # the empty closing page of a window
            stop = self.mode == "server_stops" and day >= TODAY + HORIZON
            return {"Solutions": [], "ContinueInfo": {"State": 1, "SearchRangeStartDte": day, "SearchRangeEndDte": day, "NextProviderIndex": "", "IsStopSearch": stop}, "ErrorCode": None}
        providers = range(1 + chunk * CHUNK, min(PROVIDERS, (chunk + 1) * CHUNK) + 1)
        quiet = self.mode == "reserve_window" and day == TODAY + 9  # providers 1-12 have nothing new that day
        solutions = [{"ProviderId": f"p{i}", "DepartmentId": "d1", "Slots": [opening(day, f"p{i}")] if has_openings(day) and not (quiet and i <= 12) else []} for i in providers]
        return {"Solutions": solutions, "ContinueInfo": {"State": 2, "SearchRangeStartDte": day, "SearchRangeEndDte": day, "NextProviderIndex": f"{(chunk + 1) * CHUNK}^1", "IsStopSearch": False}, "ErrorCode": None}

    def post_json(self, endpoint: str, fields) -> dict:
        if endpoint == "workflow":
            return {"WorkflowSettings": {"CurrentDTE": TODAY}, "Specialties": [{"Name": "Cardiology", "ID": "spec"}]}
        if endpoint == "specialty":
            pairs = [{"ProviderId": f"p{i}", "DepartmentId": "d1", "VisitTypeInformation": [{"VisitTypeID": "visit"}]} for i in range(1, PROVIDERS + 1)]
            return {"VisitTypes": [{"ID": "visit", "DisplayName": "Office Visit"}], "ProviderDepartmentPairs": pairs, "ReasonsForVisit": [],
                    "Providers": [{"ID": f"p{i}", "Name": f"Doctor {i}", "Credentials": "MD"} for i in range(1, PROVIDERS + 1)],
                    "Departments": [{"ID": "d1", "Name": "Clinic", "Address": "1 Main St, Orlando FL 32801"}]}
        assert endpoint == "slots", endpoint
        self.requests += 1
        if self.mode == "outage_once" and self.requests == 40:  # one request fails outright (retries exhausted)
            raise RuntimeError("slots returned non-JSON data after 5 attempts")
        if self.mode == "failed_resume" and 70 <= self.requests <= 80:  # a long outage: the flow ends request_failed after its checkpoint
            raise RuntimeError("slots returned non-JSON data after 5 attempts")
        if self.mode in ("killed", "legacy_resume") and self.requests == 70:  # the process dies mid-flow (not an Exception, so nothing catches it)
            raise SystemExit("simulated kill")
        continuation, start = fields.get("continueInfo"), fields["startDte"]
        if not continuation:
            day, chunk = (start + LEAD if start == TODAY else start), 0
        elif continuation["State"] == 2:
            day, chunk = continuation["SearchRangeStartDte"], int(continuation["NextProviderIndex"].split("^")[0]) // self.chunk
        else:
            day, chunk = continuation["SearchRangeStartDte"] + 1, 0
            if self.mode == "year_jump" and day > TODAY + HORIZON:  # nothing left: Epic jumps the next window a year ahead
                day = continuation["SearchRangeStartDte"] + 366
        if self.mode == "reserve_window" and day == TODAY + 9 and chunk < 3:
            # Epic re-serves a chunk's previous results when it has nothing new in this window; the continuation
            # still advances, so the rest of the window (chunks 3-5, with openings) must still be searched
            served = self.page(TODAY + 8, chunk)
            return {"Solutions": served["Solutions"], "ContinueInfo": self.page(day, chunk)["ContinueInfo"], "ErrorCode": None}
        closing = bool(continuation) and continuation["State"] == 1 and day - TODAY > 6
        if self.mode == "stall_new_tokens" and closing:  # re-serve the window's first pages, with fresh tokens, forever
            self.events.append("stall")
            day, chunk = continuation["SearchRangeStartDte"], min(1, len([e for e in self.events[-3:] if e == "stall"]) - 1)
        if self.mode == "stall_same_token" and closing:  # the same closing page again, forever
            return self.page(continuation["SearchRangeStartDte"], 99)
        if self.mode == "reserve_once" and continuation and continuation["State"] == 2 and day == TODAY + 5 and chunk == 1 and "once" not in self.events:
            self.events.append("once"); chunk = 0  # one transient repeat of a chunk page, then normal service
        if day > TODAY + 1000:
            return {"Solutions": [], "ContinueInfo": None, "ErrorCode": None}
        return self.page(day, chunk)


def run(mode: str, folder: Path) -> str:
    epic = ScriptedEpic(mode)
    ep.PublicEpicClient = lambda site, retries, delay: epic
    args = types.SimpleNamespace(retries=1, request_delay=0, max_paths=10, max_depth=5, max_answers=5, max_slot_loads=20000, max_days_ahead=560)
    output = folder / mode
    if mode in ("killed", "legacy_resume", "failed_resume"):  # die or fail mid-flow after a checkpoint, then resume the same run folder
        ep.CHECKPOINT_PAGES = 20
        try:
            ep.extract(ep.SITES["oh"], output, args)
        except SystemExit:
            pass
        if mode == "failed_resume":
            first = json.loads((output / "oh-cardiology-flow-audit.json").read_text(encoding="utf-8"))
            if first[-1]["status"] != "request_failed": raise SystemExit(f"failed_resume: first pass ended {first[-1]['status']}, expected request_failed")
        if mode == "legacy_resume":  # a run folder from before part files existed: only slots.json and the audit
            shutil.rmtree(output / ep.PARTS)
        epic = ScriptedEpic("normal"); ep.PublicEpicClient = lambda site, retries, delay: epic
        args.resume = True
    ep.extract(ep.SITES["oh"], output, args)
    audit = json.loads((output / "oh-cardiology-flow-audit.json").read_text(encoding="utf-8"))
    rows = json.loads((output / "oh-cardiology-slots.json").read_text(encoding="utf-8"))
    if mode == "failed_resume":  # the resumed pass continued from the checkpoint instead of starting over
        trace = (output / "paging-trace.jsonl").read_text(encoding="utf-8")
        if '"resumed_from"' not in trace: raise SystemExit("failed_resume: the resumed pass did not continue from the checkpoint")
    expected_days = [d - TODAY for d in range(TODAY + LEAD, TODAY + HORIZON + 1) if has_openings(d)]
    per_day = Counter(int(row["days_ahead"]) for row in rows)
    expected_per_day = lambda d: PROVIDERS - 12 if mode == "reserve_window" and d == 9 else PROVIDERS  # noqa: E731
    complete = sorted(per_day) == expected_days and all(per_day[d] == expected_per_day(d) for d in expected_days)
    last = audit[-1]
    line = f"{mode:17s} {last['status']:13s} slots={len(rows):4d} expected={sum(expected_per_day(d) for d in expected_days):4d} requests={epic.requests:4d} restarts={last['search_restarts']:3d} {'ok' if complete else 'INCOMPLETE'}"
    if not complete:
        raise SystemExit(line)
    return line


def main() -> None:
    folder = Path(tempfile.mkdtemp(prefix="paging-check-"))
    try:
        for mode in MODES:
            print(run(mode, folder))
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    settings, workflow, specialty, reason, visit, pair = {"CurrentDTE": TODAY}, {}, {"ID": "spec"}, {"Id": "r"}, {"ID": "visit"}, {"ProviderId": "p1", "DepartmentId": "d1"}
    same = [ep.search_signature(ep.build_slot_request(settings, workflow, specialty, reason, visit, [pair], {"override": {"LqfIds": ["tree"], "HqaIds": [answer], "OriginalPrcId": "visit"}})) for answer in ("a1", "a2")]
    other_pairs = ep.search_signature(ep.build_slot_request(settings, workflow, specialty, reason, visit, [{"ProviderId": "p2", "DepartmentId": "d1"}], {"override": None}))
    other_mode = ep.search_signature(ep.build_slot_request(settings, workflow, specialty, reason, {"ID": "visit", "DefaultTelehealthMode": 2}, [pair], {"override": None}))
    if not (same[0] == same[1] and same[0] not in (other_pairs, other_mode)):
        raise SystemExit("search identity: questionnaire ids must not matter, providers and telehealth mode must")
    print("search identity ok")


if __name__ == "__main__":
    main()
