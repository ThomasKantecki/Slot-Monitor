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

## The agreed extraction method

This extractor is the reference method for the project, agreed on 2026-09-16 after
comparing it slot for slot with the earlier pulls. It is the one to use for every
future refresh.

What makes it the reference:

- It walks every search window to the end of each system's published schedule.
  Epic re-serves pages and jumps windows; the paging logic (see below) restarts a
  search where it was and stops only on Epic's own stop signal, the horizon, or
  a long run of empty windows. The earlier method stopped at a page ceiling and
  lost the back half of the AdventHealth schedule.
- It pulls every public flow on both sides: the five AdventHealth visit types,
  including the three video-visit types, and all 49 Orlando Health visit-type
  and reason paths. Physical slots are deduplicated across flows afterwards, so a
  slot bookable under several visit types counts once.
- It survives the network: non-JSON responses are retried, outages pause and
  resume, every flow checkpoints to part files, and `--resume` continues an
  interrupted run from its checkpoints.
- It is verified: `extractors/cardiology/paging_check.py` replays eight scripted
  Epic behaviours offline (re-served pages, stalls, killed runs, legacy resumes)
  and runs under `npm test`; the built pages carry a data check; and the
  2026-09-15 pull matched the independent 2026-09-14/15 pulls on 99.8 percent of
  AdventHealth slots and 99.6 percent of Orlando Health slots where both had
  data, the differences being the normal churn between pull times.

For a refresh, run `npm run refresh:cardiology` and let it finish. AdventHealth
takes most of a day; nothing has to be babysat, and an interrupted run continues
with `--resume` on the same run id.

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
npm run extract:ah
npm run extract:oh
```

Independent extraction writes raw output under
`data/cardiology/extractions/<run-id>/<system>`. Use the full refresh command
for automatic promotion and site rebuilding.

## Refreshing the data

There is no automated refresh. Run the pipeline on a machine you control:

```sh
npm run refresh:cardiology
```

It writes `data/cardiology/current` and rebuilds `public/`. Commit those and
push; GitHub Pages redeploys the site from `public/` on every push to main.
Raw checkpoints and the per-run folders under `data/cardiology` stay local.

## How slot paging works

Epic's `GetSlots` searches one short date window per request (one or two
days) and reports it in `ContinueInfo` (`SearchRangeStartDte`,
`SearchRangeEndDte`, `NextProviderIndex`, `IsStopSearch`). With many
provider-department pairs it walks a window in provider chunks and closes it
with an empty page, so empty pages are normal and never end a flow. A flow
ends when Epic sets `IsStopSearch`, when 40 searched windows in a row hold no
opening (the schedule has run out), or at `--max-days-ahead`.

Both systems sometimes re-serve an earlier page instead of moving on to the
next window. The extractor follows the continuation twice more (a single
re-served page still points at the next chunk), then restarts the search on
the day after the last window it saw; Epic honors `startDte`. Restarts are
counted per flow in the audit (`search_restarts`, `last_window_end`), and
every page is logged to `paging-trace.jsonl` in the run folder so a stall can
be diagnosed without another run.

Questionnaire paths that end in the same visit type, providers, reason and
telehealth mode ask Epic the same question, so the extractor runs that search
once and reuses it (`search_reused_from` in the audit). A full run is still
about ten thousand requests per system, several hours at the default delay.

`python3 extractors/cardiology/paging_check.py` replays the paging loop
against a scripted Epic (normal paging, server stop, a transient re-served
page, both stall styles) and fails if any of them loses a slot.

## Important controls

- `--max-slot-loads`: maximum paginated slot requests per flow (20,000; a
  complete schedule needs several thousand).
- `--max-days-ahead`: stop a flow past this many days from the catalog date
  (560, beyond either system's published horizon).
- `--max-paths`: maximum finite questionnaire branches per visit type.
- `--max-depth`: questionnaire depth guard.
- `--max-answers`: choices retained from one questionnaire prompt.
- `--request-delay`: pause between public API requests. Keep it; the
  AdventHealth edge blocks bursts.
- `--retries`: bounded network retries.
- `--run-id`: explicit timestamp/run identifier for reproducibility.

The run's audit files record public stops, endpoint errors, search restarts,
reused searches, and branches excluded by safety caps. A successful process
can still have source warnings; inspect the audit before presenting coverage
as complete.
