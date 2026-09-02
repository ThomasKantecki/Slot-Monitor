import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUITE_NAV_STYLES, suiteNavigation } from "../src/shared/suite-navigation.js";
import { renderSlotTimes } from "../src/slot-times/render.js";

test("shared navigation marks exactly one current view", () => {
  const provider = suiteNavigation("provider-map");
  const slots = suiteNavigation("slot-times");
  const opportunities = suiteNavigation("opportunities");
  assert.match(provider, /href="\.\/provider-map\.html" aria-current="page"/);
  assert.doesNotMatch(provider, /href="\.\/index\.html" aria-current="page"/);
  assert.match(slots, /href="\.\/index\.html" aria-current="page"/);
  assert.doesNotMatch(slots, /href="\.\/provider-map\.html" aria-current="page"/);
  assert.match(opportunities, /href="\.\/market-opportunities\.html" aria-current="page"/);
  assert.ok(slots.indexOf("Slot Availability") < slots.indexOf("Market Opportunities"));
  assert.ok(slots.indexOf("Market Opportunities") < slots.indexOf("Provider Index"));
});

test("Provider Index and Slot Availability use the same top-level switcher", () => {
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(providerSource, /suiteNavigation\("provider-map"\)/);
  assert.match(slots, /aria-label="Dashboard views"/);
  assert.match(slots, /<title>Cardiology Slot Availability<\/title>/);
  assert.match(slots, /id="map"/);
  assert.match(slots, /Appointment calendar/);
  assert.match(slots, /AdventHealth booking categories are shown where supplied/);
});

test("provider index controls are grouped into labeled mini-sections", () => {
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(providerSource, /class="control-section geography-controls"><legend>Geography<\/legend>/);
  assert.match(providerSource, /id="comparison-controls" class="control-section comparison-controls"><legend>Comparison<\/legend>/);
  assert.match(providerSource, />Area type<\/span>/);
  assert.match(providerSource, /for="area-search">Find area<\/label>/);
  assert.match(providerSource, /id="leadcap">Health system view<\/span>/);
  assert.match(providerSource, /\.control-section\{min-width:0;margin:0;padding:/);
});

test("both views share the Slot Monitor shell while the landing page remains responsive", () => {
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(SUITE_NAV_STYLES, /\.brand-box\{width:220px;justify-content:flex-start\}/);
  assert.match(SUITE_NAV_STYLES, /\.hdr \.hdr-in\{display:grid;grid-template-columns:220px minmax\(150px,1fr\) auto/);
  assert.match(SUITE_NAV_STYLES, /\.hdr \.mark\{display:flex;flex-direction:column;align-items:flex-start/);
  assert.match(SUITE_NAV_STYLES, /@media \(max-width:700px\)\{\s*\.hdr \.hdr-in\{grid-template-columns:220px minmax\(0,1fr\)\}/);
  assert.doesNotMatch(providerSource, /brand-logo/);
  assert.doesNotMatch(slots, /brand-logo/);
  assert.match(SUITE_NAV_STYLES, /html\{scrollbar-gutter:stable\}/);
  assert.match(SUITE_NAV_STYLES, /@media \(min-width:881px\) and \(max-height:680px\)/);
  assert.match(SUITE_NAV_STYLES, /\.hdr-in\{min-height:52px;padding:6px 18px\}/);
  assert.match(SUITE_NAV_STYLES, /\.wrap\{padding:8px 16px 10px\}/);
  assert.match(SUITE_NAV_STYLES, /\.panel-band\{padding:5px 12px\}/);
  assert.match(slots, /\.page\{max-width:1500px/);
  assert.match(slots, /\.workspace\{display:grid/);
  assert.match(slots, /@media\(max-width:980px\)/);
  assert.match(slots, /@media\(max-width:680px\)/);
  assert.match(slots, /grid-template-columns:minmax\(380px,1fr\) minmax\(230px,\.58fr\) minmax\(410px,1\.05fr\) minmax\(350px,\.82fr\)/);
  assert.match(slots, /\.radius-group \.filter-group-body\{justify-content:space-between\}/);
  assert.match(slots, /@media\(max-width:1450px\)\{\.toolbar\{grid-template-columns:minmax\(330px,1fr\) minmax\(360px,1fr\)/);
  assert.match(slots, /\.period-group \.filter-group-body\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) auto;align-items:end\}/);
  assert.match(slots, /\.period-group \.group-note\{grid-column:1\/-1\}/);
});

test("slot availability browser code parses and the landing alias is generated", () => {
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(client));
  const slots = renderSlotTimes();
  const inlineScript = slots.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
  assert.match(slots, /window\.SLOT_DATA=/);
  assert.match(slots, /"totals":\{"ah":57266,"oh":40998\}/);
  assert.match(slots, /Available appointment slots/);
  assert.doesNotMatch(slots, /Deduplicated physical slots/);
});

test("slot appointment mix donut is wired to filtered KPI refreshes", () => {
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const id of ["mix-donut", "mix-total", "mix-ah", "mix-oh"]) {
    assert.match(slots, new RegExp(`id="${id}"`));
  }
  const summaryStart = slots.indexOf('<article class="card summary">');
  const summaryEnd = slots.indexOf("</article>", summaryStart);
  const calendarStart = slots.indexOf('<article class="panel calendar-panel">');
  const calendarEnd = slots.indexOf("</article>", calendarStart);
  const mixStart = slots.indexOf('<article class="panel slot-mix-panel">');
  const mixEnd = slots.indexOf("</article>", mixStart);
  const providersStart = slots.indexOf('<article class="panel providers-panel">');
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.ok(calendarStart >= 0 && calendarEnd > calendarStart);
  assert.ok(mixStart > calendarEnd && mixEnd > mixStart);
  assert.ok(providersStart > mixEnd);
  assert.doesNotMatch(slots.slice(summaryStart, summaryEnd), /mix-card/);
  assert.doesNotMatch(slots.slice(calendarStart, calendarEnd), /mix-card/);
  assert.doesNotMatch(slots.slice(mixStart, mixEnd), /Filtered appointment mix|mix-title/);
  assert.match(slots.slice(mixStart, mixEnd), /class="mix-card"[\s\S]*id="mix-donut"/);
  assert.match(slots, /grid-template-areas:"calendar providers" "mix providers"/);
  assert.match(slots, /\.slot-mix-panel\{grid-area:mix;display:grid/);
  assert.match(slots, /\.mix-body\{position:relative;display:grid;width:100%;height:100%;min-height:190px;place-items:center\}/);
  assert.match(slots, /\.mix-legend\{position:absolute;top:6px;right:8px;/);
  assert.match(client, /function renderKpis\(\) \{\s*const indices = filteredIndices\(\);/);
  assert.match(client, /\$\("mix-total"\)\.innerHTML = `<span>\$\{number\(total\)\}<\/span><small>slots<\/small>`;/);
  assert.match(client, /\$\("mix-ah"\)\.textContent = `\$\{number\(counts\.ah\)\} · \$\{total \? Math\.round\(counts\.ah \/ total \* 100\) : 0\}%`;/);
  assert.match(client, /\$\("mix-oh"\)\.textContent = `\$\{number\(counts\.oh\)\} · \$\{total \? Math\.round\(counts\.oh \/ total \* 100\) : 0\}%`;/);
  assert.match(client, /\$\("mix-donut"\)\.style\.background = total \? `conic-gradient\(var\(--ah\) 0 \$\{ahShare\}%, var\(--oh\) \$\{ahShare\}% 100%\)` : "#edf0f2";/);
  assert.match(client, /function refresh\(\) \{[^}]*selectArea\(state\.selected\); \}/);
  assert.match(client, /paintMap\(\); renderKpis\(\); renderSummary\(\);/);
});

test("slot area selection can be cleared and Reset restores today's period and v3 ZIP-radius defaults", () => {
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(slots, /id="clear-area"/);
  assert.match(slots, /id="origin-zip"/);
  assert.match(slots, /id="origin-zip"[^>]*placeholder="32804 · default center"/);
  assert.match(slots, /id="radius" type="range" min="10" max="250" step="5" value="140"/);
  assert.match(client, /state\.selected === path\.dataset\.key \? "" : path\.dataset\.key/);
  assert.match(client, /\$\("clear-area"\)\.addEventListener\("click", \(\) => \{ state\.radiusActive = false; state\.areaQuery = ""; selectArea\(""\); \}\)/);
  assert.match(client, /state\.granularity = "zip"; state\.selected = "";/);
  assert.match(client, /const landingRadius = 140/);
  assert.match(client, /const searchedZipRadius = 50/);
  assert.match(client, /state\.originZip = defaultOriginZip; state\.radius = landingRadius; state\.radiusActive = Boolean\(defaultOriginZip\)/);
  assert.match(client, /const defaultFrom = window\.SUITE_DATE\.today\(\)/);
  assert.match(client, /state\.month = new Date\(`\$\{resetSlotDate\}T12:00:00`\); state\.from = resetFrom; state\.through = resetThrough/);
  assert.match(slots, /root\.SUITE_DATE = Object\.freeze\(\{ today \}\)/);
  assert.match(slots, /"commonMaxDate":"2027-10-01"/);
  assert.match(slots, /id="period-status"/);
  assert.match(client, /if \(!state\.selected\) return "Florida statewide"/);
  assert.match(client, /\$\("origin-zip"\)\.value = "";/);
  assert.match(client, /state\.radius = searchedZipRadius; state\.radiusActive = true; state\.selected = ""; state\.areaQuery = key/);
});

test("v3 facility investigation and appointment-detail controls are rebuilt", () => {
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/slot-times/styles.css", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const id of ["facility-search", "facility-dialog", "doctor-list", "appointment-search", "appointment-table", "facility-marker-layer", "kpi-facilities-ah", "kpi-facilities-oh", "kpi-dates", "availability-profile", "facility-title"]) {
    assert.match(slots, new RegExp(`id="${id}"`));
  }
  assert.match(client, /function openFacility\(/);
  assert.match(client, /function renderAppointmentTable\(/);
  assert.match(client, /class="facility-marker/);
  assert.match(client, /class="time more more-times"/);
  assert.match(client, /Not supplied by source/);
  assert.match(client, /No facilities with appointments within \$\{number\(state\.radius\)\} miles of \$\{esc\(state\.originZip\)\}\. Expand the radius/);
  assert.match(client, /state\.granularity === "zip" && originByZip\.has\(key\)/);
  assert.match(client, /state\.originZip = key; state\.radius = searchedZipRadius; state\.radiusActive = true; state\.selected = ""; state\.areaQuery = key;/);
  assert.match(client, /facilityDistance\(a\.facilityIndex\) - facilityDistance\(b\.facilityIndex\)/);
  assert.match(client, /state\.granularity === "zip" \? origins\.map\(\(origin\) => origin\.z\)/);
  assert.match(styles, /\.radius-empty\{display:grid;min-height:100%;place-items:center/);
  assert.match(styles, /\.profile-panel\{display:flex;min-height:0;flex-direction:column\}/);
  assert.match(styles, /\.facility-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(client, /No appointments within \$\{number\(state\.radius\)\} miles of \$\{esc\(state\.originZip\)\}\. Expand the radius/);
});

test("slot comparison controls reuse the embedded provider-map brand assets", () => {
  const slots = renderSlotTimes();
  assert.match(slots, /--ah-logo-img:url\(data:image\/png;base64,/);
  assert.match(slots, /--oh-logo-img:url\(data:image\/png;base64,/);
  assert.match(slots, /id="view-ah"[^>]*aria-label="AdventHealth"[^>]*><span class="comparison-logo ah"/);
  assert.match(slots, /id="view-oh"[^>]*aria-label="Orlando Health"[^>]*><span class="comparison-logo oh"/);
});

test("shared header includes the AdventHealth signature and an accessible-motion pixel heart", () => {
  const provider = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const page of [provider, slots]) {
    assert.match(page, /class="pixel-heart" aria-hidden="true"/);
    assert.match(page, /class="header-health-brand" aria-label="AdventHealth"/);
    assert.match(page, /class="header-health-logo" aria-hidden="true"/);
  }
  assert.match(SUITE_NAV_STYLES, /@media \(prefers-reduced-motion:reduce\)\{\.pixel-heart\{animation:none\}\}/);
});

test("repository root index opens the Slot Availability landing page", () => {
  const rootIndex = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(rootIndex, /url=\.\/public\/index\.html/);
  assert.match(rootIndex, /location\.replace\("\.\/public\/index\.html"/);
});
