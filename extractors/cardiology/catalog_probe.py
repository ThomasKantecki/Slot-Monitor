"""List what a system's anonymous MyChart scheduling catalog offers, so specialties.json can name the
entries an extraction should pull. One request for the specialty list; one more per --detail entry."""
from __future__ import annotations

import argparse
import json

from epic_public import SITES, PublicEpicClient, item_id, norm


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--system", choices=sorted(SITES), required=True)
    parser.add_argument("--detail", action="append", default=[], help="A catalog specialty name to describe (repeatable): visit types, reasons, provider-department pairs")
    parser.add_argument("--request-delay", type=float, default=0.5)
    args = parser.parse_args()
    site = SITES[args.system]
    client = PublicEpicClient(site, 3, args.request_delay)
    client.bootstrap()
    catalog = client.post_json("workflow", {"schedulingParameters.isAnonymous": "true", "schedulingParameters.workflow": "NewProvider", "nonce": client.page_nonce})
    specialties = catalog.get("Specialties", [])
    report: dict = {"system": site.code, "site": site.name, "specialties": [{"id": item_id(item), "name": item.get("Name", "")} for item in specialties], "details": []}
    wanted = {norm(name) for name in args.detail}
    for item in specialties:
        if norm(item.get("Name")) not in wanted: continue
        detail = client.post_json("specialty", {"SpecialtyId": item_id(item), "isFirstLoad": "true", "schedulingOverridesString": "{}"})
        pairs = detail.get("ProviderDepartmentPairs", [])
        supported = {info.get("VisitTypeID") for pair in pairs for info in pair.get("VisitTypeInformation", [])}
        report["details"].append({
            "name": item.get("Name", ""), "id": item_id(item),
            "visitTypes": [{"id": item_id(visit), "name": visit.get("DisplayName") or visit.get("Name", ""),
                            "questionnaire": bool(visit.get("AnonymousSchedulingDecisionTreeId")),
                            "supported": not supported or item_id(visit) in supported} for visit in detail.get("VisitTypes", [])],
            "reasons": [{"id": item_id(reason), "name": reason.get("DisplayName", ""), "directSchedule": reason.get("CanDirectSchedule")} for reason in detail.get("ReasonsForVisit", [])],
            "providerDepartmentPairs": len(pairs), "providers": len(detail.get("Providers", [])), "departments": len(detail.get("Departments", [])),
        })
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
