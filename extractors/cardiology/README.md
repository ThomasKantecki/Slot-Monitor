# Cardiology extraction pipeline

This folder contains everything needed to pull public Cardiology appointment
availability for AdventHealth and Orlando Health. The direct API extractor uses
Python's standard library; it does not require Selenium, pandas, credentials,
or a browser.

`AH_cardiology_exhaustive.py`, `OH_cardiology_all_public_flows.py`, and their
two `epic_scheduling_extractor_*.py` dependencies are mirrors of the current
root-workspace extractors used for the latest deep runs. `extract_ah.py` and
`extract_oh.py` now delegate to those current runners.

If Python is not already available on `PATH`, create a repository-local
`.venv` or set `CARDIOLOGY_PYTHON` to a Python 3.9+ executable. The npm commands
automatically prefer `.venv` on Windows and macOS/Linux.

The extractor reads only each system's anonymous Epic Open Scheduling workflow.
It does not log in, book, hold, or submit patient-identifying information.

## Full refresh

From the repository root:

```sh
npm run refresh:cardiology:dry-run
npm run refresh:cardiology
```

The older full-refresh command remains in the repository for its established
dashboard-promotion workflow. The current deep AH/OH runners below are the
source of truth for new extraction work; their outputs should be validated and
promoted through the current data-build process before publishing. These are
long-running network jobs; partial slot and audit files are checkpointed after
every public flow.

Run one source independently when needed:

```sh
npm run extract:ah
npm run extract:oh
```

AH defaults to a finite 10,000-page brake. OH defaults to uncapped pagination
(`--max-slot-loads 0`) and writes a run-health artifact that flags incomplete
flows and coverage failures. The current deep runners write their raw run
folders beside the script unless an `--artifacts` destination is supplied.

Independent extraction writes raw output below the supplied `--artifacts`
folder (or in the runner's default artifact folder). Promote a validated run
through the data-build process before rebuilding the site.

## Scheduled refresh

`.github/workflows/refresh-cardiology.yml` runs the same pipeline at 9:00 AM
Eastern and supports manual dispatch. It validates the generated dashboard and
commits only `data/cardiology/current` plus `public`; raw checkpoints and the
historical processed run are intentionally not committed by automation.

## Important controls

- `--max-slot-loads`: maximum paginated slot requests per flow.
- `--max-paths`: maximum finite questionnaire branches per visit type.
- `--max-depth`: questionnaire depth guard.
- `--max-answers`: choices retained from one questionnaire prompt.
- `--request-delay`: pause between public API requests.
- `--retries`: bounded network retries.
- `--run-id`: explicit timestamp/run identifier for reproducibility.

The run's audit files record public stops, endpoint errors, repeated-page
guards, and branches excluded by safety caps. A successful process can still
have source warnings; inspect the audit before presenting coverage as complete.
