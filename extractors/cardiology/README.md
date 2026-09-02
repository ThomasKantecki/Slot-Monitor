# Cardiology extraction pipeline

This folder contains everything needed to pull public Cardiology appointment
availability for AdventHealth and Orlando Health. The direct API extractor uses
Python's standard library; it does not require Selenium, pandas, credentials,
or a browser.

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

The full command runs AH, then OH, deduplicates physical appointments, promotes
both outputs into `data/cardiology/runs/<run-id>`, selects the latest valid AH
and OH sources for `data/cardiology/current`, and rebuilds the static site.
These are long-running network jobs; partial slot and audit files are
checkpointed after every public flow.

Run one source independently when needed:

```sh
npm run extract:ah -- --max-slot-loads 1000
npm run extract:oh -- --max-slot-loads 1000
```

Independent extraction writes raw output under
`data/cardiology/extractions/<run-id>/<system>`. Use the full refresh command
for automatic promotion and site rebuilding.

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
