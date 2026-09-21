# slots/

Step 3 of the appointment data: turn a finished extraction run into the files the pages read. The Python
extractor (`extractor/`) leaves its raw output under `data/<specialty>/extractions/<run-id>/`; the scripts here
take it the rest of the way. `npm run refresh:<specialty>` runs them in order after the extraction; each can
also be run on its own with `--specialty <id>` (cardiology when absent).

```
extractions/<run>/ah/parts/*.jsonl   ─ build-ah-physical-slots ─▶  runs/<run>/ah/ah-<id>-physical-slots.json
extractions/<run>/oh/*-unique.csv    ─ import-oh-physical-slots ─▶  runs/<run>/oh/source-oh-unique-physical-slots.csv
                        both ─ build-specialty-current ─▶  data/<id>/current/  (the Florida dataset + manifest.json)
                        ─ build-slot-times-data ─▶  data/<id>/current/slot-times-model.json  (compact model)
                        ─ build-slot-partitions ─▶  public/data/<id>/slot-times-summary.json + slots/<day>.json
                        ─ build-specialties ─▶  runs the two steps above and the three page builds for every published specialty
```

A "physical slot" is one provider at one location at one time. AdventHealth publishes the same opening
under several visit types, and Orlando Health's questionnaire reaches the same opening by several paths;
both collapse to one slot here. Only Florida locations are kept.

| File | What it does |
|---|---|
| `build-ah-physical-slots.mjs` | Streams the AdventHealth run's part files into one physical-slot file per run, keeping every visit type an opening can be booked as. |
| `import-oh-physical-slots.mjs` | Copies the Orlando Health run's deduplicated slots and its flow audit into the run folder. |
| `build-specialty-current.mjs` | Joins the newest complete AdventHealth and Orlando Health runs into `data/<id>/current/` and writes `manifest.json` (per-system counts, run ids, the filter mix). |
| `slot-rules.js` | The three comparison filters the pages offer (physicians only, in-person only, new patients only) and what each means. |
| `slot-model.js` | Turns the current dataset into the compact model: numbered providers, facilities and visit types, each slot's Eastern day and time, video-only and new-patient flags. |
| `build-slot-times-data.mjs` | Writes that model to `data/<id>/current/slot-times-model.json` (local only; it is large). |
| `build-slot-partitions.mjs` | Splits the model into the published summary plus one JSON file per day under `public/data/<id>/slots/`. |
| `build-specialties.mjs` | The `npm run build` orchestrator: for every specialty with data, the model, the day files and the three pages. |
