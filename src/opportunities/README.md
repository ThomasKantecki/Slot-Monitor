# AH Market Opportunities

This view answers one question: where does Orlando Health have cardiology
appointment availability that AdventHealth does not match?

A market is a circle around a ZIP that has at least one facility with active
slots. Every active AdventHealth and Orlando Health facility inside the circle
contributes its slots, providers and earliest dates. The circle is 10, 25 or 50
miles (25 by default, chosen in the toolbar). The Geography controls only choose
which market centres are in view. Neighbouring circles overlap and can count the
same slots, so market figures are not additive.

Markets are ranked with the strongest gaps first. The ranking uses the score in
`scoring.js` (no AdventHealth slots, an earlier Orlando Health first appointment,
more Orlando Health slots, a persistent Orlando Health lead, distance to the
nearest AdventHealth site). The page shows the rank ("#3 of 72") and the reasons
in plain words (`marketReasons`), never the score itself.

The map draws one dot per market centre: red where Orlando Health leads, blue
where AdventHealth leads, and a white core where the ZIP itself has Orlando
Health slots and no AdventHealth slots. Hovering shows the market's counts;
clicking opens it in the summary card, which lists its facilities and providers
on request. The table below ranks every market in view.

`scoring.js` is the single implementation used by Node tests, the audit, and the
generated browser page. `client.js` owns filters, the map, the summary card, the
table and the market dialog. Run `npm run audit:opportunities` to reconcile the
current comparison window and `npm run build:opportunities` to generate
`public/market-opportunities.html`.

This is an availability signal, not a measure of patient demand, market share,
appointment completion, or unmet need.
