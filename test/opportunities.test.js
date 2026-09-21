// The market ranking (scoring.js) and the built Market Opportunities page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOpportunityRows, marketReasons, opportunityScore } from "../pages/market-opportunities/scoring.js";
import { renderOpportunities } from "../pages/market-opportunities/render.js";

const model = {
  minDate: "2026-09-03", commonMaxDate: "2026-10-01",
  origins: [
    { z: "32801", a: 28.54, o: -81.38 },
    { z: "32804", a: 28.58, o: -81.41 },
    { z: "33701", a: 27.77, o: -82.64 },
  ],
  facilities: [
    { y: "ah", z: "32804", ct: "Orange", n: "AH Heart" },
    { y: "oh", z: "32801", ct: "Orange", n: "OH Heart" },
    { y: "ah", z: "32801", ct: "Orange", n: "AH Downtown" },
  ],
  providers: [{}, {}, {}],
  slots: [
    { y: "oh", f: 1, p: 1, d: "2026-09-03" },
    { y: "oh", f: 1, p: 1, d: "2026-09-04" },
    { y: "ah", f: 2, p: 0, d: "2026-09-10" },
    { y: "ah", f: 0, p: 2, d: "2026-09-03" },
  ],
};

const euclideanMiles = (a, o, b, p) => Math.hypot(a - b, o - p) * 69;

test("opportunity score is transparent, bounded, and rewards a complete AH coverage gap", () => {
  const score = opportunityScore({ ah: 0, oh: 4, earliestAh: "", earliestOh: "2026-09-03", dates: new Map([["2026-09-03", { ah: 0, oh: 4 }]]), nearestAhMiles: 75 });
  assert.deepEqual(score, { total: 100, coverageGap: 35, timingAdvantage: 25, slotAdvantage: 20, persistentLead: 10, ahDistance: 10 });
});

test("ZIP aggregation preserves counts, earliest dates, rank and nearest active AH evidence", () => {
  const rows = buildOpportunityRows(model, { miles: euclideanMiles });
  const downtown = rows.find((row) => row.zip === "32801");
  assert.deepEqual({ ah: downtown.ah, oh: downtown.oh, earliestAh: downtown.earliestAh, earliestOh: downtown.earliestOh }, { ah: 1, oh: 2, earliestAh: "2026-09-10", earliestOh: "2026-09-03" });
  assert.equal(downtown.providersAh, 1);
  assert.equal(downtown.providersOh, 1);
  assert.equal(downtown.nearestAhFacility, 2);
  assert.equal(downtown.nearestAhMiles, 0);
  assert.equal(downtown.booksSooner, true);
  assert.equal(downtown.leadDates, 2);
  assert.equal(rows[0].zip, "32801");
  assert.deepEqual(rows.map((row) => row.rank), rows.map((_, index) => index + 1));
});

test("date and ZIP filters are applied before scoring", () => {
  const rows = buildOpportunityRows(model, { from: "2026-09-04", through: "2026-09-04", includeZips: ["32801"], miles: euclideanMiles });
  assert.equal(rows.length, 1);
  assert.deepEqual({ ah: rows[0].ah, oh: rows[0].oh }, { ah: 0, oh: 1 });
  assert.deepEqual(rows[0].slotIndices, [1]);
});

test("local-market aggregation compares all active facilities within a catchment", () => {
  const rows = buildOpportunityRows(model, { marketRadiusMiles: 10, miles: euclideanMiles });
  const market = rows.find((row) => row.zip === "32804");
  assert.deepEqual({ ah: market.ah, oh: market.oh }, { ah: 2, oh: 2 });
  assert.deepEqual(market.slotIndices, [0, 1, 2, 3]);
  assert.equal(market.facilitiesAh, 2);
  assert.equal(market.facilitiesOh, 1);
  assert.equal(market.marketRadiusMiles, 10);
  assert.deepEqual(rows.map((row) => row.zip).sort(), ["32801", "32804"]);
});

test("market reasons read as plain English, strongest signal first", () => {
  const downtown = buildOpportunityRows(model, { miles: euclideanMiles }).find((row) => row.zip === "32801");
  assert.deepEqual(marketReasons(downtown).map((reason) => reason.text), ["Orlando Health books 7 days sooner", "Orlando Health has 1 more slot", "Orlando Health ahead on 2 of 3 dates"]);
  assert.deepEqual(marketReasons({ ah: 0, oh: 5, slotGap: 5, earliestAh: "", earliestOh: "2027-01-19", nearestAhMiles: 28.2, leadDates: 1, representedDates: 1, marketRadiusMiles: 25 }, { exactGap: true }).map((reason) => reason.text),
    ["No AdventHealth slots in this ZIP", "No AdventHealth slots within 25 miles", "Nearest AdventHealth 28 mi away"]);
  const ahLed = marketReasons({ ah: 240937, oh: 19965, slotGap: -220972, earliestAh: "2026-09-17", earliestOh: "2026-09-16", nearestAhMiles: 0, leadDates: 0, representedDates: 280, marketRadiusMiles: 25 });
  assert.deepEqual(ahLed.map((reason) => [reason.system, reason.text]), [["oh", "Orlando Health books 1 day sooner"], ["ah", "AdventHealth has 220,972 more slots"]]);
});

test("market opportunity page is built from the Slot Availability parts with no explanatory text", () => {
  const html = renderOpportunities();
  const styles = readFileSync(new URL("../pages/market-opportunities/styles.css", import.meta.url), "utf8");
  for (const id of ["opportunity-filter", "summary-overview", "summary-market", "kpi-priority", "kpi-coverage", "kpi-earlier", "kpi-slot-gap", "area-lead", "market-name", "market-rank", "market-reasons", "market-lead", "open-market", "back-overview", "market-table", "market-count", "market-dialog", "dialog-facilities", "map", "map-raster", "tip"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /href="\.\/market-opportunities\.html" aria-current="page"/);
  assert.doesNotMatch(html, /id="market-10"|id="market-25"|id="market-50"/);
  assert.match(html, /<option value="all">All markets<\/option><option value="lead">Orlando Health leads the market<\/option><option value="gap">No AdventHealth slots in the ZIP<\/option><option value="sooner">Orlando Health books a week sooner<\/option>/);
  assert.match(html, /<div class="legend"><div class="legend-row"><span class="swatch dot oh"><\/span>Orlando Health leads the market<\/div><div class="legend-row"><span class="swatch dot gap"><\/span>No AdventHealth slots in the ZIP<\/div><div class="legend-row"><span class="swatch dot ah"><\/span>AdventHealth leads<\/div><\/div>/);
  assert.match(html, /<section class="workspace"><article class="panel map-panel">/);
  assert.match(html, /<aside class="side"><article class="card summary"><div id="summary-overview">/);
  assert.match(html, /<\/article><article class="panel rank-panel"><div class="band"><h2>Ranked markets<\/h2><span id="market-count" class="band-meta"><\/span><\/div><div id="market-table" class="rank-list"><\/div><\/article><\/aside>/);
  assert.doesNotMatch(html, /market-panel|overview-list|market-facilities/);
  assert.doesNotMatch(html, /class="kpis"|card kpi|High priority|table-search|class="note"|Drag to pan|score-badge|op-marker|system-tag|How priority is scored|opportunity signals|maroon/);
  assert.match(styles, /\.market-marker\.oh \.dot\{fill:var\(--oh\)\}\.market-marker\.ah \.dot\{fill:var\(--ah\)\}/);
  assert.match(styles, /\.market-row\.selected\{background:#e8f5fb;box-shadow:inset 3px 0 0 var\(--sky\);border-color:var\(--sky\)\}/);
  assert.match(html, /window\.SLOT_DATA=/);
  assert.match(html, /Markets are 25-mile circles around each ZIP/);
});

test("opportunity browser source parses and uses the shared score implementation", () => {
  const client = readFileSync(new URL("../pages/market-opportunities/client.js", import.meta.url), "utf8");
  const scoring = readFileSync(new URL("../pages/market-opportunities/scoring.js", import.meta.url), "utf8").replaceAll("export ", "");
  assert.doesNotThrow(() => new Function(`${scoring}\n${client}`));
  assert.match(client, /exactRows = buildOpportunityRows\(DATA, \{ from: state\.from, through: state\.through, includeZips, miles \}\)/);
  assert.match(client, /allRows = buildOpportunityRows\(DATA, \{ from: state\.from, through: state\.through, includeZips, marketRadiusMiles: state\.marketMiles, miles \}\)/);
  assert.match(client, /marketMiles: 25, selectedZip: ""/);
  assert.match(client, /id="market-marker-layer"/);
  assert.match(client, /class="market-marker \$\{row\.oh > row\.ah \|\| gap \? "oh" : "ah"\}\$\{gap \? " gap" : ""\}/);
  assert.match(client, /class="facility market-row\$\{row\.zip === state\.selectedZip \? " selected" : ""\}"/);
  assert.doesNotMatch(client, /setPressed\("market"/);
  assert.match(client, /<g id="radius-controls" class="hidden"><circle id="radius-hit" class="radius-hit"><\/circle><circle id="radius-handle" class="radius-handle"><\/circle><g id="origin-grip" class="origin-grip"><circle r="10"><\/circle><path d="[^"]+"><\/path><\/g><\/g>/);
  assert.match(client, /radiusDrag = \{ mode: target\.id === "origin-grip" \? "move" : "resize" \};/);
  assert.match(client, /onSettle: \(Z\) => \{ if \(Z\.k !== currentZoom\) \{ scaleMarkers\(Z\.k\); motion\.queue\(\); \} \}/);
  assert.match(client, /function showMarkerTip\(event, marker\)/);
  assert.match(client, /class="zh"[\s\S]*class="cty"[\s\S]*class="r"/);
  assert.match(client, /SUITE_MAP_MOTION\.create\(\{ svg, viewport: vp, raster: \$\("map-raster"\)/);
  assert.match(client, /motion\.panBy\(/);
  assert.match(client, /motion\.queue\(\);/);
  assert.match(client, /ArrowLeft/);
  assert.match(client, /state\.radius = searchedZipRadius/);
  assert.match(client, /marketReasons\(row, \{ exactGap: gap \}\)/);
  assert.match(client, /\$\("open-market"\)\.addEventListener\("click"/);
  assert.match(client, /\$\("back-overview"\)\.addEventListener\("click", clearMarket\)/);
  assert.doesNotMatch(client, /visibleRows\[0\]\?\.zip|op-marker|system-tag|scoreLabel|scoreBreakdown|renderEvidence|table-search/);
  assert.match(client, /const defaultFrom = window\.SUITE_DATE\.today\(\)/);
  assert.match(client, /state\.from = window\.SUITE_DATE\.today\(\)/);
  assert.match(client, /await window\.SLOT_PARTITIONS\.load\(defaultFrom, defaultThrough\)/);
  assert.match(client, /async function refreshPeriod\(/);
  assert.match(renderOpportunities(), /window\.SLOT_PARTITIONS/);
  assert.doesNotMatch(renderOpportunities(), /"slots":\[\{"y":/);
});
