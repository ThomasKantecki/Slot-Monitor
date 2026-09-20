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
future refresh. In short:

- It walks every search window to the end of each system's published schedule,
  restarts a search when Epic re-serves a page, and ends a flow only on Epic's
  own stop signal, the horizon, or a long run of empty windows.
- It pulls every public flow on both sides: the five AdventHealth visit types,
  including the three video-visit types, and all 49 Orlando Health visit-type
  and reason paths, then deduplicates physical slots across flows so a slot
  bookable under several visit types counts once.
- It survives the network: bad responses are retried, outages are waited out,
  every flow checkpoints to part files, and `--resume` continues an interrupted
  run from its checkpoints.
- It is verified: `paging_check.py` replays eight scripted Epic behaviours
  offline and runs under `npm test`, the built pages carry a data check, and
  the 2026-09-15 pull matched the independent 2026-09-14/15 pulls on 99.8
  percent of AdventHealth slots and 99.6 percent of Orlando Health slots where
  both had data.

The next section holds the evidence behind those four points. "How slot paging
works", further down, explains the mechanism.

## Why this method replaced the September 16 runners

Commit 9d2ab49 (2026-09-17) replaced the runners added in commit f02e864
(`AH_cardiology_exhaustive.py`, `OH_cardiology_all_public_flows.py`,
`epic_scheduling_extractor_AH.py`, `epic_scheduling_extractor_OH.py`, 2,835 lines)
with this extractor. Nothing is lost: those files are in history, and
`git show f02e864:extractors/cardiology/<file>` restores any of them. Every line
number below can be checked the same way; the commands are listed at the end.

Where the two methods pulled the same slots they agree to within a fraction of a
percent, so this is not about the data either one produced. It is about how a
flow ends, what happens when Epic or the network misbehaves, whether a run can be
resumed and proven, and how the output reaches the site. On each of those this
extractor is the stronger one, and a site needs exactly one extraction path.

### The two pulls, side by side

| | September 16 runners (data at 0b20e60 / f897909) | This extractor (run 2026-09-15T103541-0400) |
|---|---|---|
| AdventHealth physical slots | 656,104 | 652,873 |
| Orlando Health physical slots | 63,597 in the manifest, 64,111 in the published day files | 64,193 |
| AdventHealth flows walked | 2 (New Patient, Specialists Office Visit) | 5 visit types, including the 3 telemedicine types |
| Orlando Health paths | 28 questionnaire flows errored before slots, 14 kept partial results, 2 hit the 1,000-page guard | 49 paths, none failed after the retry pass |
| Run status | `completed_with_warnings` | every flow ended with a named reason |

The warnings are the manifest's own words (`data/cardiology/current/manifest.json`
at commit 0b20e60):

- AdventHealth: "Specialists flow reached the temporary 10,000-page ceiling; New
  Patient ended after an AH non-JSON response."
- Orlando Health: "28 questionnaire flows errored before slots, 14 slot flows
  preserved partial results after non-JSON responses, and 2 flows reached the
  1,000-page guard."

This extractor's run ended its AdventHealth flows at the 560-day horizon:
Specialists Office Visit after 3,798 pages (821,210 rows before de-duplication),
New Patient after 4,702 pages (432,353 rows), Patient Telemedicine Visit after
402 pages. Its 49 Orlando Health paths ended 42 at the horizon and 7 on Epic's
own stop signal.

Slot-level agreement, keyed by system, provider, facility and appointment time,
both pulls through 2027-10-14, in-person slots:

| | September 16 data | This extractor | In both |
|---|---|---|---|
| AdventHealth | 656,104 | 648,761 | 647,488 (99.8%) |
| Orlando Health | 52,823 | 53,017 | 52,783 (99.6%) |

The differences are timing, not method. The AdventHealth pulls were 33 hours
apart (Sep 14 01:18 against Sep 15 10:35 to 23:58), and 2,249 of the 8,616 slots
found only by the earlier pull fall within its first 30 days, which is where
slots get booked between pulls. Of the 173 Orlando Health slots found only by the
later f897909 pull, 133 sit on 2028-02-24, a day released after this run. The
1,600 telemedicine-only AdventHealth slots exist only here because the
September 16 run had no telemedicine flows.

### How a flow ends

Epic's public GetSlots endpoint pages through short date windows with a
`ContinueInfo` token. Two things make it hard to know when a schedule is
finished: Epic sometimes re-serves an earlier page instead of moving on, and some
flows never set `IsStopSearch` and eventually run into an error page. The
September 16 Orlando Health runner says this itself
(`OH_cardiology_all_public_flows.py` lines 403-405). The September 13 data in
this repository (commit 5bd9a58) shows what that looks like when a page guard is
the only brake: 56,137 AdventHealth slots, the two big searches ending in early
December 2026 and every later month nearly empty.

**Shared engine used for AdventHealth** (`epic_scheduling_extractor_OH.py`,
`run_api_inventory`, page loop at lines 881-946; `epic_scheduling_extractor_AH.py`
subclasses its session and points it at AdventHealth). A flow ends on Epic's stop
signal or an error code (line 924), on a bad response once retries are exhausted
(line 913, "slot response skipped ... continuing", which ends the flow with the
rows it had), or on the page ceiling (line 934). The engine has no test for a
re-served page and no horizon, so once Epic stalls, the flow pages until the
ceiling. That ceiling is `DEFAULT_MAX_SLOT_LOADS = 10_000` in
`AH_cardiology_exhaustive.py` line 34, under the comment "Temporary AH-only deep
run: retain a finite brake". A flow that ends there cannot be told apart from a
truncated one, which is why the manifest carries a warning. The same Specialists
flow took 3,798 pages here and ended with a reason.

**Orlando Health runner** (`OH_cardiology_all_public_flows.py`,
`collect_slot_pages`, lines 300-430). This one does hash each page and each
continuation token, and it has a 730-day horizon (defaults at lines 639-655). But
a repeated page is treated as the end of the flow (`repeated_page_stop`, listed
with the failure statuses at lines 612-616). The only recovery is one
fresh-session retry, and only when the repeat happened within the first 12 pages
(lines 561-575). A stall later in a long flow ends it.

**This extractor** (`epic_public.py`). A repeated page or token is tolerated
`REPEAT_STRIKES = 3` times (line 300), then the search restarts at the day after
the last window it searched (line 571, `next_start = last_end + 1`), so a stall
in the middle of a schedule does not end the flow. A flow ends on Epic's stop
signal, at the 560-day horizon (`extract_system.py` line 27), after 40 searched
windows in a row with no opening (`EMPTY_WINDOWS`, line 301, which is the real
end of a schedule), or when a restart makes no progress. The per-flow audit
records the reason, the page count and the number of restarts.

### When the network misbehaves

**September 16 engine.** Each page gets `--api-retries` attempts (default 2,
line 1693) with a session refresh in between, then the flow ends with the rows
it had (status `slot_response_error`). That is what "New Patient ended after an
AH non-JSON response" means. The wrapper's `--max-retries 5` and `--resume` flags
(lines 169-170) never reach the engine: `configure_engines` (lines 81-118)
applies them through `set_when_present` (lines 73-78), which only sets names the
engine already defines, and the engine defines none of `MAX_REQUEST_RETRIES`,
`RESUME_FROM_CHECKPOINT`, `CHECKPOINT_AFTER_EACH_FLOW` or
`INCLUDE_ALL_VISIT_TYPES` (a grep finds no hits). So the effective retry count is
2 and there is no resume. The engine does write its artifacts after every flow
(line 949), which protects finished flows; an AdventHealth flow runs for hours,
and an interruption loses the flow in progress.

**This extractor.** A non-JSON or HTML reply is retried with backoff up to
`--retries` (default 5) per request (`epic_public.py` lines 141-153). If a page
still fails, it is treated as an outage: the same page is asked again after
90-second pauses, up to 6 times (line 303), keeping every page gathered. Rows are
flushed to part files every 250 pages (line 302). `--resume` continues an
interrupted run from the last checkpointed window of the flow it was in
(`load_checkpoint`, lines 405-446). `--only-visit` and `--only-answer-path` re-run
specific flows and `refresh.py` merges them; in the September 15 run that pass
merged 54,010 retried Orlando Health rows and left no failed flow.

### Coverage and the site's filters

This extractor walks the five AdventHealth visit types and all 49 Orlando Health
visit-type and reason paths, then `deduplicate.py` collapses the flows to
physical slots while keeping the flags the pages filter on: telemedicine, new
patient, clinician type. The site's three comparison filters depend on those
flags. The September 16 AdventHealth run walked two flows, and its published
visit types are "New Patient" and "Specialists Office Visit" only; its Orlando
Health rows all sit under the two "New Cardiology Patient" visit types, so a
new-patient filter has nothing to separate there.

### Proof

`paging_check.py` replays eight scripted Epic behaviours offline (normal, server
stop, a re-served page, a stall with new tokens, a stall with the same token, an
outage, a run killed mid-flow, a resume of an older run folder) and runs under
`npm test` (`test/extraction-pipeline.test.js`). The built pages also carry a
data check. The September 16 runners came with no tests; their run-health
artifact is useful, but it describes a run after the fact.

### Reaching the site

This extractor is one command, `npm run refresh:cardiology`: extract both
systems, deduplicate, promote into `data/cardiology/runs/<run-id>` and
`data/cardiology/current`, then `scripts/build-slot-times-data.mjs` and
`scripts/build-slot-partitions.mjs` build the per-day files the pages fetch. An
interrupted run continues with `--resume` on the same run id.

The September 16 runners wrote CSV and XLSX beside the script, relaunching into a
Windows virtual environment (`AH_cardiology_exhaustive.py` lines 43-59), and
needed a separate converter, `scripts/build-deep-ah-slot-model.py`, to turn the
CSV into the site model (the manifest's `modelSource: streamed-large-ah-csv`).
The f02e864 README described them as "mirrors of the current root-workspace
extractors used for the latest deep runs". The converter left with the runners
and is in history at f02e864 as well.

Two extraction paths would mean two paging behaviours to keep in step and two
output formats to convert. One is enough, and this is the one that ends every
flow with a reason, recovers from Epic's stalls and from the network without
dropping a flow, resumes mid-flow, covers every visit type, and is tested.

### Checking this yourself

```sh
git show f02e864:extractors/cardiology/AH_cardiology_exhaustive.py | sed -n 28,36p
git show f02e864:extractors/cardiology/AH_cardiology_exhaustive.py | sed -n 73,118p
git show f02e864:extractors/cardiology/epic_scheduling_extractor_OH.py | sed -n 881,946p
git show f02e864:extractors/cardiology/epic_scheduling_extractor_OH.py | grep -c "RESUME_FROM_CHECKPOINT\|MAX_REQUEST_RETRIES"
git show f02e864:extractors/cardiology/OH_cardiology_all_public_flows.py | sed -n 300,430p
git show 0b20e60:data/cardiology/current/manifest.json
sed -n 141,153p extractors/cardiology/epic_public.py
sed -n 299,303p extractors/cardiology/epic_public.py
sed -n 518,580p extractors/cardiology/epic_public.py
npm test
```

## Running a refresh

There is no automated refresh. From the repository root, on a machine you
control:

```sh
npm run refresh:cardiology:dry-run
npm run refresh:cardiology
```

The full command runs AH, then OH, deduplicates physical appointments, promotes
both outputs into `data/cardiology/runs/<run-id>`, selects the latest valid AH
and OH sources for `data/cardiology/current`, and rebuilds the static site.
These are long-running network jobs: AdventHealth takes most of a day, nothing
has to be babysat, and an interrupted run continues with `--resume` on the same
run id. When it finishes, run `npm test`, commit `data/cardiology/current` and
`public/`, and push; GitHub Pages redeploys the site from `public/` on every
push to main. Raw checkpoints and the per-run folders under `data/cardiology`
stay local.

Run one source independently when needed:

```sh
npm run extract:ah
npm run extract:oh
```

Independent extraction writes raw output under
`data/cardiology/extractions/<run-id>/<system>`. Use the full refresh command
for automatic promotion and site rebuilding.

## Questionnaires

Some visit types ask a scheduling questionnaire before Epic will search for
openings (a search without answers is refused with `LqfAnswersRequired`). The
walker in `enumerate_paths` answers it the way a patient would, and every
complete set of answers becomes a flow. Two rules keep that affordable:

- Epic keeps one in-progress answer record per traversal, so a stored answer
  cannot be branched twice: the first answer to a question continues the same
  traversal (one request); every other answer replays the path from the root.
- The walker learns which answers matter. Before anything is walked, a long
  numeric list (an age picker) is sampled to its middle and last value and a
  left/right question keeps its first answer. The first time a question is met
  every answer is walked and each complete path is resolved: which visit type,
  providers and reason it selects, or that it stops scheduling. From then on,
  answers whose paths lead to the same searches are asked once and answers that
  only stop scheduling are skipped. At the 12th, 60th and 250th meeting of a
  question it is walked in full again; a rule that fails that re-check is
  withdrawn and everything it skipped is walked after all. Audit rows with
  status `sampled` record every rule, `rule_conflict` a withdrawn one, and the
  paging trace gets a `walk` record per learned rule and per 25 paths.

Orlando Health's orthopedics questionnaire is why: 27 to 29 body parts, then
side, prior surgery, car accident, litigation and insurance questions, for two
visit types and two sampled ages. Walked in full that is more than 100,000
requests; with the rules it is about 2,000. Mapped on 2026-09-20: only the body
part and the age change the providers, while prior surgery, an accident,
litigation, HMO and Medicaid all stop scheduling. The limit of the approach is
that a difference which only appears between two re-checks is not seen;
`walk_check.py` shows both the saving and that limit on a simulated tree.

## Specialties

The same extractor serves every specialty. `src/shared/specialties.json` names,
per specialty and per system, the entries of the anonymous scheduling catalog
to pull (`catalog.ah`, `catalog.oh`); every listed entry is walked and its
visit types, reasons and questionnaire paths become flows, with the catalog
entry's id in each flow id so two entries cannot share a part file.

```sh
npm run probe:catalog -- --system oh                      # every catalog specialty name
npm run probe:catalog -- --system ah --detail "Orthopedics"   # its visit types, reasons, provider-department pairs
npm run refresh:orthopedics                               # refresh.py --specialty orthopedics
npm run extract:ah -- --specialty orthopedics --run-id <id> --resume
```

Each specialty has its own roots: `data/<id>/extractions/<run-id>/<system>`,
`data/<id>/runs/<run-id>`, `data/<id>/current`, and its artifacts carry the id
(`ah-orthopedics-slots.json`, `oh-orthopedics-flow-audit.json`, ...).
Cardiology keeps the names it always had. Flow ids changed on 2026-09-20 when
the catalog entry joined them, so a run folder started before that date cannot
be resumed; start a new run id instead.

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
page, both stall styles, an outage, a killed run, a legacy resume) and fails
if any of them loses a slot.

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
- `--resume`: continue an interrupted run from its checkpoint files (same
  `--run-id`).
- `--only-visit` / `--only-answer-path`: run only one visit type or one questionnaire
  path, for example to retry a failed flow.
- `--run-id`: explicit timestamp/run identifier for reproducibility.

The run's audit files record public stops, endpoint errors, search restarts,
reused searches, and branches excluded by safety caps. A successful process
can still have source warnings; inspect the audit before presenting coverage
as complete.
