"""Checks the questionnaire walker against a simulated Epic decision tree (no network): it has to find every search
an exhaustive walk finds while asking far fewer questions, keep the linear-continuation rule (one traversal is never
branched twice), withdraw a learned rule when a re-check contradicts it, and it is allowed to miss a difference that
only shows between two re-checks (that limit is what VERIFY_AT trades for speed)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import epic_public as ep  # noqa: E402

PARTS = [f"Part {index}" for index in range(1, 15)]
VISIT = {"ID": "visit", "AnonymousSchedulingDecisionTreeId": "tree"}


class FakeEpic:
    """A tree like Orlando Health's orthopedics questionnaire: new patient? -> age -> body part -> side -> prior
    surgery? -> car accident? -> insurance. Only the body part changes the search; accidents and two insurance
    answers stop scheduling; optionally one body part routes prior-surgery patients to a second search."""

    def __init__(self, special: str | None = None):
        self.special, self.calls, self.starts, self.page_nonce = special, 0, 0, ""

    def node(self, path):
        if not path: return "Are you a new patient?", ["Yes", "No"]
        if path[0] == "No": return ("Have you been seen before?", ["No", "Yes"]) if len(path) == 1 else ("COMPLETE", None)
        depth = len(path)
        if depth == 1: return "Please select your age from the list.", [str(age) for age in range(101)]
        if depth == 2: return "Please select the body part.", PARTS
        if depth == 3: return "Which side?", ["Left", "Right", "Both"]
        if depth == 4: return "Do you have any prior surgery?", ["No", "Yes"]
        if depth == 5: return "Is your injury car accident related?", ["No", "Yes"]
        if depth == 6: return "Please select the type of insurance.", ["HMO", "PPO", "Medicare", "Medicaid"]
        return "COMPLETE", None

    def post_json(self, endpoint, fields):
        assert endpoint == "decision_tree", endpoint
        self.calls += 1
        traversal = fields["traversalInfo"]
        if traversal.get("RestartTree"):
            self.starts += 1; path = []
        else:
            path = list(traversal["Path"])
            _, options = self.node(path)
            path.append(options[fields["question"]["Answer"]["Choices"][0]["Index"]])
        prompt, options = self.node(path)
        info = {"IsTraversalComplete": prompt == "COMPLETE", "TreeAnswerID": json.dumps(path), "Path": path, "RestartTree": False}
        if prompt == "COMPLETE": return {"TraversalInfo": info}
        return {"TraversalInfo": info, "NextInputNode": {"ID": "node", "CSN": 1, "Type": 1, "IsFirst": not path,
                "Question": {"ID": "q", "Prompt": prompt, "Choices": [{"Index": index, "Text": text} for index, text in enumerate(options)]}}}

    def resolve(self, info):
        answers = info["answers"]
        if answers[0] == "No": return {"stop": answers[1] == "Yes", "search_key": "established"}
        part, surgery, accident, insurance = answers[2], answers[4], answers[5], answers[6]
        if accident == "Yes" or insurance in ("HMO", "Medicaid"): return {"stop": True, "search_key": None}
        revision = ":revision" if surgery == "Yes" and part == self.special else ""
        return {"stop": False, "search_key": f"search:{part}{revision}"}


def searches(paths):
    return {path["resolved"]["search_key"] for path in paths if path.get("resolved") and not path["resolved"]["stop"]}


def run(label, special=None, verify_at=(12, 60, 250), learn=True):
    ep.VERIFY_AT = verify_at
    fake = FakeEpic(special)
    paths, audit = ep.enumerate_paths(fake, VISIT, {"Type": 1}, 10000, 50, 1000, resolve=fake.resolve if learn else None)
    if not learn:
        for path in paths: path["resolved"] = fake.resolve(path)
    statuses = [row["status"] for row in audit]
    print(f"{label:32} paths={len(paths):4d} requests={fake.calls:5d} traversals={fake.starts:4d} searches={len(searches(paths)):3d} "
          f"sampled={statuses.count('sampled')} conflicts={statuses.count('rule_conflict')}")
    return searches(paths), fake.calls, audit


expected = {"established"} | {f"search:{part}" for part in PARTS}
full, full_calls, _ = run("exhaustive (no resolver)", learn=False)
assert full == expected, full ^ expected
learned, calls, audit = run("learned rules")
assert learned == expected, learned ^ expected
assert calls * 4 < full_calls, (calls, full_calls)
messages = " | ".join(row["message"] for row in audit)
assert "route alike" in messages and "only stop scheduling" in messages, messages
special = PARTS[4]
conflict, _, audit = run("re-check finds a conflict", special=special, verify_at=(5,))
assert f"search:{special}:revision" in conflict and expected <= conflict, conflict
assert any(row["status"] == "rule_conflict" for row in audit)
missed, _, _ = run("difference between re-checks", special=PARTS[2], verify_at=(5,))
assert f"search:{PARTS[2]}:revision" not in missed and expected <= missed, missed
print("walk check ok")
