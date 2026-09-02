import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOpportunityRows, opportunityScore } from "../src/opportunities/scoring.js";
import { renderOpportunities } from "../src/opportunities/render.js";

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

test("ZIP aggregation preserves counts, earliest dates, and nearest active AH evidence", () => {
  const rows = buildOpportunityRows(model, { miles: euclideanMiles });
  const downtown = rows.find((row) => row.zip === "32801");
  assert.deepEqual({ ah: downtown.ah, oh: downtown.oh, earliestAh: downtown.earliestAh, earliestOh: downtown.earliestOh }, { ah: 1, oh: 2, earliestAh: "2026-09-10", earliestOh: "2026-09-03" });
  assert.equal(downtown.providersAh, 1);
  assert.equal(downtown.providersOh, 1);
  assert.equal(downtown.nearestAhFacility, 2);
  assert.equal(downtown.nearestAhMiles, 0);
  assert.equal(rows[0].zip, "32801");
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

test("market opportunity page is generated with the full decision workflow", () => {
  const html = renderOpportunities();
  const styles = readFileSync(new URL("../src/opportunities/styles.css", import.meta.url), "utf8");
  for (const id of ["kpi-priority", "map", "market-evidence", "opportunity-table", "market-dialog", "dialog-facilities"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /href="\.\/market-opportunities\.html" aria-current="page"/);
  assert.match(html, /How priority is scored/);
  assert.match(html, /Cardiology opportunity signals/);
  assert.doesNotMatch(html, />AH slot lead</);
  assert.match(html, /Marker size = opportunity score/);
  assert.match(html, /Exact ZIP: AH absent · OH present/);
  assert.match(html, /25-mile market: AH present · OH leads/);
  assert.match(html, /maroon core inside coral = both/i);
  assert.match(styles, /\.op-marker\.coverage\{fill:#5b001f/);
  assert.match(styles, /\.op-marker\.lead\{fill:#f06449/);
  assert.match(html, /not patient demand or market share/i);
  assert.match(html, /window\.SLOT_DATA=/);
});

test("opportunity browser source parses and uses the shared score implementation", () => {
  const client = readFileSync(new URL("../src/opportunities/client.js", import.meta.url), "utf8");
  const scoring = readFileSync(new URL("../src/opportunities/scoring.js", import.meta.url), "utf8").replaceAll("export ", "");
  assert.doesNotThrow(() => new Function(`${scoring}\n${client}`));
  assert.match(client, /buildOpportunityRows\(DATA/);
  assert.match(client, /const marketRadiusMiles = 25/);
  assert.match(client, /includeZips, marketRadiusMiles, miles/);
  assert.match(client, /exactGapByZip/);
  assert.match(client, /exactRows = buildOpportunityRows/);
  assert.match(client, /localMarker \+ exactMarker/);
  assert.match(client, /map\.addEventListener\("pointerdown"/);
  assert.match(client, /map\.setPointerCapture\(event\.pointerId\)/);
  assert.match(client, /event\.target\.closest\("\.op-marker"\)/);
  assert.match(client, /ArrowLeft/);
  assert.match(renderOpportunities(), /Drag to pan/);
  assert.match(client, /state\.radius = searchedZipRadius/);
  assert.match(client, /Review facilities and providers/);
  assert.match(client, /Nearest active AH comparison/);
  assert.match(client, /visibleRows\.filter\(\(row\) => row\.oh > row\.ah\)/);
  assert.match(client, /id="opportunity-marker-layer"/);
  assert.match(client, /class="op-marker/);
  assert.doesNotMatch(client, /path\.setAttribute\("fill", scoreColor/);
  assert.match(client, /const defaultFrom = window\.SUITE_DATE\.today\(\)/);
  assert.match(client, /state\.from = window\.SUITE_DATE\.today\(\)/);
});
