# AH Market Opportunities

This view ranks ZIP-centered 25-mile Florida markets where the current
Cardiology appointment snapshot indicates an AdventHealth access opportunity
relative to Orlando Health. Candidate market centers are ZIPs represented by
active facilities. Every active AH and OH facility within 25 miles of a center
contributes to that market's counts, dates, providers, and score.

The page's Radius control limits which market centers are displayed; it does
not change the fixed 25-mile catchment used for each comparison. Catchments can
overlap and reuse the same source slots, so counts across market rows are not
additive. Exact-ZIP aggregation remains available from `buildOpportunityRows`
when `marketRadiusMiles` is omitted and is used for source reconciliation.

The map deliberately keeps both grains visible. Maroon markers identify an
exact ZIP where OH has slots and AH has none. Coral markers identify a 25-mile
market where both systems are present and OH has more slots. When both apply at
one center, the exact-ZIP marker is drawn as a maroon core inside the coral
local-market marker.

The 100-point score is intentionally transparent:

- 35 points: OH has active slots and AH has none within 25 miles.
- 25 points: OH's earliest active date is sooner, capped at a 30-day gap.
- 20 points: OH's relative physical-slot advantage.
- 10 points: share of represented dates on which OH has more slots.
- 10 points: distance to the nearest AH facility with active slots, capped at
  50 miles.

`scoring.js` is the single score implementation used by Node tests, the audit,
and the generated browser page. `client.js` owns filters, map selection, the
ranked table, and the facility/provider evidence dialog. Run
`npm run audit:opportunities` to reconcile the current comparison window and
inspect the highest-ranked ZIPs. Run `npm run build:opportunities` to generate
`public/market-opportunities.html`.

This is an availability prioritization signal, not a measure of patient demand,
market share, appointment completion, or unmet need.
