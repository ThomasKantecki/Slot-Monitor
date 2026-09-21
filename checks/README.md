# checks/

Audits that prove a refresh is right before it is published. `npm run verify` (tests + `audit:dataset`)
runs automatically at the end of every `npm run refresh:<specialty>`; a refresh whose numbers do not
reconcile stops there and nothing should be committed.

| Command | File | What it proves |
|---|---|---|
| `npm run audit:dataset` | `audit-dataset.mjs` | Every published figure recomputed from the raw rows: counts at every layer agree, no duplicate slots, every slot's day and time match its UTC instant, the video and new-patient flags, geography, the catalog entries, how every extraction flow ended, and the Provider Index rosters (including that no person is listed twice). 28 checks per specialty. |
| `npm run audit:pages -- --specialty <id>` | `audit-pages.cjs` | Opens the three built pages in headless Chrome and recomputes every figure through every control (filters, views, radius, ZIP and county, presets, dialogs, the sub-specialty menu). Needs Chrome and the `playwright-core` package: `PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core`; skipped with a note otherwise. |
| `npm run audit:live` | `audit-live.mjs` | After a deploy: every published file on the live site is byte-identical to `public/`. |
| `npm run audit:geography -- --specialty <id>` | `audit-geography-coverage.mjs` | Every facility maps to a ZIP shape and county and the per-area totals add up (also run by the tests). |
| `npm run audit:opportunities -- --specialty <id>` | `audit-opportunities.mjs` | The market rows reconcile with the slot totals; prints the top markets. |
