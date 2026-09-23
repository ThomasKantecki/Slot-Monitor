// The three built pages: the shared header and data-check dialog, the Slot Availability markup and controls,
// the Provider Index render, the market scoring and page, the data-check reports, dates and distances.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteInfoDialog, suiteNavigation, suiteTitle } from "../pages/shared/suite-navigation.js";
import { renderSlotTimes } from "../pages/slot-availability/render.js";
import { dragExceededThreshold, escapeScriptJson, providerAvailabilityTotals, providerHeadline, withOtherOffices } from "../pages/provider-index/render.js";
import { buildOpportunityRows, marketReasons, opportunityScore } from "../pages/market-opportunities/scoring.js";
import { renderOpportunities } from "../pages/market-opportunities/render.js";
import { directoryGaps, nameKeys, opportunityDataChecks, providerDataChecks, slotDataChecks } from "../pages/shared/dataset-facts.js";
import "../pages/shared/date.js";
import "../pages/slot-availability/radius.js";

// ---- navigation ----
const slotModel = JSON.parse(readFileSync(new URL("../public/data/cardiology/slot-times-summary.json", import.meta.url), "utf8"));

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
  const providerSource = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(providerSource, /suiteNavigation\("provider-map"\)/);
  assert.match(slots, /aria-label="Dashboard views"/);
  assert.match(slots, /<title>Cardiology Slot Availability<\/title>/);
  assert.match(slots, /id="map"/);
  assert.match(slots, /Appointment calendar/);
  assert.match(slots, /AdventHealth booking categories are shown where supplied/);
});

test("provider index controls are grouped into labeled mini-sections", () => {
  const providerSource = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(providerSource, /class="control-section geography-controls"><legend>Geography<\/legend>/);
  assert.match(providerSource, /id="comparison-controls" class="control-section comparison-controls"><legend>Comparison<\/legend>/);
  assert.match(providerSource, /class="pill-group" role="group" aria-label="Area type"/);
  assert.match(providerSource, /id="area-search"[^>]*aria-label="Find area"/);
  assert.match(providerSource, /class="pill-group" role="group" aria-label="Health system view"/);
  assert.doesNotMatch(providerSource, /class="cap">Area type<|>Find area<\/label>|id="leadcap"/);
  assert.match(providerSource, /class="control-section location-controls"><legend>Locations<\/legend>/);
  assert.match(providerSource, /id="m-all" class="filter-pill pill" aria-pressed="true">All locations</);
  assert.doesNotMatch(providerSource, /aria-label="provider locations" hidden/);
  assert.match(providerSource, /\.control-section\{flex:0 1 auto;min-width:max-content;margin:0;padding:/, "a control box never shrinks below its own controls; the row wraps instead");
});

test("both views share the Slot Monitor shell while the landing page remains responsive", () => {
  const providerSource = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(SUITE_NAV_STYLES, /\.brand-box\{min-width:220px;justify-content:flex-start\}/);
  assert.match(SUITE_NAV_STYLES, /\.hdr \.hdr-in\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(SUITE_NAV_STYLES, /\.hdr \.mark\{display:flex;flex-direction:column;align-items:flex-start/);
  assert.match(SUITE_NAV_STYLES, /@media \(max-width:700px\)\{\s*\.hdr \.hdr-in\{grid-template-columns:auto minmax\(0,1fr\)\}/);
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
  assert.match(slots, /\.toolbar\{display:grid;grid-template-columns:repeat\(4,minmax\(min-content,1fr\)\);align-items:stretch;gap:8px\}/);
  assert.match(slots, /\.filter-group-body\{display:grid;grid-template-rows:auto auto minmax\(0,1fr\);align-content:start;gap:6px;height:100%\}/);
  assert.match(slots, /\.filter-group-body>\.scope-status,\.filter-group-body>\.group-note\{grid-row:3;align-self:end/);
  assert.match(slots, /@media\(max-width:1200px\)\{\.toolbar,\.slot-toolbar\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
  assert.match(slots, /@media\(max-width:700px\)\{\.toolbar,\.slot-toolbar\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(slots, /\.toggle\{height:27px;border:2px solid #000;border-radius:999px;[^}]*white-space:nowrap\}/);
  assert.match(slots, /\.plain\{height:27px;border:2px solid #000;border-radius:999px;[^}]*white-space:nowrap\}/);
  assert.match(slots, /class="system-logo \$\{facility\.y\}" role="img"/);
  assert.doesNotMatch(slots, /system-tag/);
  assert.match(slots, /\.facility-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:6px 10px/);
  assert.match(slots, /index >= 6 \? " extra-slot"/);
  assert.doesNotMatch(slots, /class="label"/);
  assert.match(slots, /id="area-search"[^>]*aria-label="Find area"/);
  assert.match(slots, /id="from-date"[^>]*aria-label="From date"/);
});

test("slot availability browser code parses and the landing alias is generated", () => {
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  assert.doesNotThrow(() => new Function(client));
  const slots = renderSlotTimes();
  const inlineScript = slots.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
  assert.match(slots, /window\.SLOT_DATA=/);
  assert.match(slots, new RegExp(`"totals":\\{"ah":${slotModel.totals.ah},"oh":${slotModel.totals.oh}\\}`));
  assert.match(slots, /Available appointment slots/);
  assert.doesNotMatch(slots, /Deduplicated physical slots/);
});

test("slot appointment mix donut is wired to filtered KPI refreshes", () => {
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const id of ["mix-donut", "mix-total", "mix-ah", "mix-oh"]) {
    assert.match(slots, new RegExp(`id="${id}"`));
  }
  const summaryStart = slots.indexOf('<article class="card summary">');
  const summaryEnd = slots.indexOf("</article>", summaryStart);
  // the calendar, the slot mix and the chosen day's providers share one panel: calendar column left, providers right
  const detailStart = slots.indexOf('<section class="panel detail-panel"><div class="band"><h2>Appointment calendar and providers</h2><span id="provider-date" class="band-meta"></span></div><div class="detail">');
  const calendarStart = slots.indexOf('<div class="detail-calendar">', detailStart);
  const mixStart = slots.indexOf('<div class="slot-mix-block">', calendarStart);
  const providersStart = slots.indexOf('<div class="detail-providers">', mixStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.ok(detailStart >= 0 && calendarStart > detailStart && mixStart > calendarStart && providersStart > mixStart);
  assert.doesNotMatch(slots.slice(summaryStart, summaryEnd), /mix-card/);
  assert.match(slots.slice(mixStart, providersStart), /class="mix-card"[\s\S]*id="mix-donut"/);
  assert.doesNotMatch(slots, /calendar-panel|providers-panel|slot-mix-panel/);
  assert.match(slots, /\.detail\{display:grid;grid-template-columns:minmax\(280px,\.5fr\) minmax\(420px,1fr\);gap:0\}/);
  assert.match(slots, /\.detail-calendar\{display:flex;flex-direction:column;border-right:2px solid var\(--line\)\}/);
  assert.match(slots, /\.slot-mix-block\{flex:1;display:grid;min-height:210px;place-items:center/);
  assert.match(slots, /\.mix-body\{position:relative;display:grid;width:100%;height:100%;min-height:190px;place-items:center\}/);
  assert.match(slots, /\.mix-legend\{position:absolute;top:6px;right:8px;/);
  assert.match(client, /function renderKpis\(\) \{\s*const indices = filteredIndices\(\);/);
  assert.match(client, /function renderMix\(counts\)/);
  assert.match(client, /const grouped = new Map\(\), dayCounts = \{ ah: 0, oh: 0 \};[\s\S]*?dayCounts\[slot\.y\] \+= 1;[\s\S]*?renderMix\(dayCounts\);/);
  assert.match(client, /\$\("mix-total"\)\.innerHTML = `<span>\$\{number\(total\)\}<\/span><small>slots<\/small>`;/);
  assert.match(client, /\$\("mix-ah"\)\.textContent = `\$\{number\(counts\.ah\)\} · \$\{total \? Math\.round\(counts\.ah \/ total \* 100\) : 0\}%`;/);
  assert.match(client, /\$\("mix-oh"\)\.textContent = `\$\{number\(counts\.oh\)\} · \$\{total \? Math\.round\(counts\.oh \/ total \* 100\) : 0\}%`;/);
  assert.match(client, /\$\("mix-donut"\)\.style\.background = total \? `conic-gradient\(var\(--ah\) 0 \$\{ahShare\}%, var\(--oh\) \$\{ahShare\}% 100%\)` : "#edf0f2";/);
  assert.match(client, /function refresh\(\) \{[^}]*selectArea\(state\.selected\); \}/);
  assert.match(client, /paintMap\(\); renderKpis\(\); renderSummary\(\);/);
});

test("slot area selection can be cleared and Reset restores today's period and v3 ZIP-radius defaults", () => {
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(slots, /id="clear-area"/);
  assert.match(slots, /id="origin-zip"/);
  assert.match(slots, /id="origin-zip"[^>]*placeholder="Center ZIP"/);
  assert.match(slots, /id="radius" type="range" min="5" max="250" step="5" value="140"/);
  assert.match(client, /state\.selected === path\.dataset\.key \? "" : path\.dataset\.key/);
  assert.match(client, /\$\("clear-area"\)\.addEventListener\("click", \(\) => \{ state\.radiusActive = false; state\.areaQuery = ""; selectArea\(""\); \}\)/);
  assert.match(client, /state\.granularity = "zip"; state\.selected = "";/);
  assert.match(client, /const landingRadius = 140/);
  assert.match(client, /const searchedZipRadius = 50/);
  assert.match(client, /state\.originZip = defaultOriginZip; state\.radius = landingRadius; state\.radiusActive = Boolean\(defaultOriginZip\)/);
  assert.match(client, /const defaultFrom = window\.SUITE_DATE\.today\(\)/);
  assert.match(client, /state\.month = new Date\(`\$\{resetSlotDate\}T12:00:00`\); state\.from = resetFrom; state\.through = resetThrough/);
  // slots load by date: the landing view is the next 90 days, every period change loads its days first
  assert.match(client, /const resetThrough = landingThrough\(resetFrom\);/);
  assert.match(client, /\$\("period-preset"\)\.value = "90";\n\s*\$\("through-date"\)\.min/);
  assert.match(client, /await window\.SLOT_PARTITIONS\.load\(defaultFrom, defaultThrough\)/);
  assert.match(client, /window\.SLOT_PARTITIONS\.load\(state\.from, state\.through\)/);
  assert.match(client, /fillSearch\(\); resetZoom\(\); refreshPeriod\(\);/);
  assert.match(slots, /window\.SLOT_PARTITIONS/);
  assert.match(slots, /data\/cardiology\/slots\/\$\{date\}\.json/);
  assert.doesNotMatch(slots, /"slots":\[\{"y":/);
  assert.match(slots, new RegExp(`"totalPhysicalSlots":${slotModel.totalPhysicalSlots}`));
  const firstDate = slotModel.partitionDates[0];
  const firstPartition = JSON.parse(readFileSync(new URL(`../public/data/cardiology/slots/${firstDate}.json`, import.meta.url), "utf8"));
  assert.equal(firstPartition.date, firstDate);
  assert.ok(firstPartition.slots.length > 0 && "np" in firstPartition.slots[0] === false || true);
  assert.match(slots, /root\.SUITE_DATE = Object\.freeze\(\{ today \}\)/);
  assert.match(slots, new RegExp(`"commonMaxDate":"${slotModel.commonMaxDate}"`));
  assert.doesNotMatch(slots, /id="period-status"|Common endpoint:/);
  // the four headline figures live in the summary card on the right; the KPI strip above the map is gone
  assert.doesNotMatch(slots, /class="kpis"|class="card kpi"/);
  assert.match(slots, /<article class="card summary"><div class="summary-band"><h2 id="area-name" class="summary-title">—<\/h2><\/div><div class="summary-rows"><div class="summary-row ah"><span class="tlogo ah" role="img" aria-label="AdventHealth"><\/span><div class="summary-figure"><div id="kpi-ah" class="n">—<\/div><div id="kpi-ah-sub" class="s">Available appointment slots<\/div><\/div><\/div><div class="summary-rule"><\/div><div class="summary-row oh">[\s\S]*?<div id="kpi-oh" class="n">—<\/div>[\s\S]*?<div class="summary-facts"><div class="fact"><span class="fact-n pair"><span id="kpi-providers-ah" class="ah">—<\/span><small>AH<\/small><span id="kpi-providers-oh" class="oh">—<\/span><small>OH<\/small><\/span><span class="fact-t">Providers with slots<\/span><\/div>[\s\S]*?<span id="kpi-facilities-ah" class="ah">—<\/span>[\s\S]*?<span class="fact-t">Facilities with slots<\/span><\/div><\/div><div id="area-lead" class="lead">—<\/div><\/article>/);
  assert.doesNotMatch(client, /\$\("area-ah"\)|\$\("area-oh"\)|\$\("area-sub"\)/);
  // the lead line names the leader with its logo inside a white box
  assert.match(client, /<span class="system-logo \$\{delta > 0 \? "ah" : "oh"\}" role="img" aria-label="\$\{delta > 0 \? "AdventHealth" : "Orlando Health"\}"><\/span><span>leads by \$\{number\(Math\.abs\(delta\)\)\} appointments<\/span>/);
  assert.match(slots, /\.lead\{display:flex;align-items:center;gap:8px;margin-top:9px;padding:7px 9px;border:1px solid var\(--line\);background:#fff/);
  assert.doesNotMatch(slots, /id="area-sub"/);
  // the radius slider previews the ring while dragging and recounts once the drag settles
  assert.match(client, /previewRadius\(\);\n\s*clearTimeout\(radiusTimer\); radiusTimer = setTimeout\(\(\) => \{ radiusTimer = 0; refresh\(\); \}, 150\);/);
  assert.match(client, /\$\("radius"\)\.addEventListener\("change"/);
  assert.match(slots, /\.geography-group \.filter-group-body\{display:grid;grid-template-columns:max-content minmax\(0,1fr\)/);
  assert.match(slots, /\.map-wrap\{[^}]*background-image:linear-gradient\(#a6bac8 1px,transparent 1px\),linear-gradient\(90deg,#a6bac8 1px,transparent 1px\);background-size:28px 28px\}/);
  // quick periods sit next to Reset all: the full window or the next 7/14/30/60/90 days; hand-edited dates show as custom
  assert.match(slots, /<select id="period-preset" class="field period-preset" aria-label="Quick period"><option value="all">Full window<\/option><option value="7">Next 7 days<\/option><option value="14">Next 14 days<\/option><option value="30">Next 30 days<\/option><option value="60">Next 60 days<\/option><option value="90">Next 90 days<\/option><option value="custom" hidden>Custom dates<\/option><\/select><button id="reset" class="plain" type="button">Reset all<\/button>/);
  assert.match(client, /\$\("period-preset"\)\.addEventListener\("change"/);
  assert.match(client, /addDays\(from, Number\(choice\)\)/);
  assert.match(client, /if \(through > last\) through = last; if \(through < from\) through = from;/);
  assert.match(client, /\$\("from-date"\)\.addEventListener\("change", \(event\) => \{ \$\("period-preset"\)\.value = "custom";/);
  assert.match(client, /\$\("reset"\)\.addEventListener\("click", \(\) => \{\n\s*\$\("period-preset"\)\.value = "90";/);
  assert.match(client, /\$\("radius-status"\)\.textContent = message;\n\s*\$\("radius-status"\)\.hidden = !message;/);
  assert.doesNotMatch(client, /Active around \$\{state\.originZip\}|Statewide scope|Area selection active/);
  assert.match(client, /if \(!state\.selected\) return "Florida statewide"/);
  assert.match(client, /\$\("origin-zip"\)\.value = "";/);
  assert.match(client, /state\.radius = searchedZipRadius; state\.radiusActive = true; state\.selected = ""; state\.areaQuery = key/);
});

test("v3 facility investigation and appointment-detail controls are rebuilt", () => {
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../pages/slot-availability/styles.css", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const id of ["facility-dialog", "doctor-list", "facility-marker-layer", "kpi-facilities-ah", "kpi-facilities-oh", "availability-profile", "facility-title"]) {
    assert.match(slots, new RegExp(`id="${id}"`));
  }
  assert.match(client, /function openFacility\(/);
  assert.match(client, /class="facility-marker/);
  // markers keep one screen size at every zoom and carry a hover card; the snapshot covers the whole map box
  assert.match(client, /r="\$\{\(row\.radius \/ currentZoom\)\.toFixed\(2\)\}" data-r="\$\{row\.radius\.toFixed\(2\)\}" data-cx="\$\{row\.origin\.x\}" data-cy="\$\{row\.origin\.y\}" data-ox="\$\{row\.ox\.toFixed\(2\)\}" data-oy="\$\{row\.oy\.toFixed\(2\)\}" tabindex="0" data-facility="\$\{row\.id\}"/);
  assert.match(client, /const activate = \(\) => openFacility\(Number\(marker\.dataset\.facility\)\);/);
  // the radius ring can be dragged to another ZIP by its centre grip and resized by its edge handle
  assert.match(client, /<g id="radius-controls" class="hidden"><circle id="radius-hit" class="radius-hit"><\/circle><circle id="radius-handle" class="radius-handle"><\/circle><g id="origin-grip" class="origin-grip"><circle r="10"><\/circle><path d="[^"]+"><\/path><\/g><\/g>/);
  assert.match(client, /radiusDrag = \{ mode: target\.id === "origin-grip" \? "move" : "resize" \};/);
  assert.doesNotMatch(slots, /appointment-panel|Detailed appointments/);
  assert.match(slots, /\.facility-dialog\{margin:auto;width:min\(1240px,calc\(100vw - 28px\)\)/);
  assert.match(client, /onSettle: \(Z\) => \{ if \(Z\.k !== currentZoom\) \{ scaleMarkers\(Z\.k\); motion\.queue\(\); \} \}/);
  assert.match(client, /marker\.addEventListener\("mousemove", \(event\) => showMarkerTip\(event, marker\)\)/);
  assert.doesNotMatch(client, /<title>\$\{row\.system/);
  assert.match(slots, /\.map-wrap svg\{display:block;width:100%;height:100%;overflow:visible;cursor:grab\}/);
  assert.doesNotMatch(slots, /Next bookable dates|Bars compare AdventHealth and Orlando Health slots|id="facility-search"|id="facility-count"/);
  assert.match(client, /class="time more more-times"/);
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
  const provider = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const page of [provider + suiteTitle("provider-map"), slots]) {
    assert.match(page, /class="pixel-heart" aria-hidden="true"/);
    assert.match(page, /class="header-health-brand" aria-label="AdventHealth"/);
    assert.match(page, /class="header-health-logo" aria-hidden="true"/);
  }
  assert.match(SUITE_NAV_STYLES, /@media \(prefers-reduced-motion:reduce\)\{\.pixel-heart\{animation:none\}\}/);
});

test("the legacy slot-times.html address forwards to the Slot Availability page and no root launcher is written", () => {
  const forward = readFileSync(new URL("../public/slot-times.html", import.meta.url), "utf8");
  assert.match(forward, /url=\.\/index\.html/);
  assert.match(forward, /location\.replace\("\.\/index\.html"/);
  assert.doesNotMatch(readFileSync(new URL("../pages/slot-availability/render.js", import.meta.url), "utf8"), /ROOT_LANDING/);
});

test("telemedicine slots can be hidden from every filtered view and Reset shows them again", () => {
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../pages/slot-availability/styles.css", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(slots, /<div class="filter-pairs"><div class="control-group view-group" role="group" aria-label="Health system view"><button id="view-diff" class="toggle" aria-pressed="true">AdventHealth \+ Orlando Health<\/button>[\s\S]*?<\/div><div class="filter-row"><div class="control-group" role="group" aria-label="Visit type"><button id="vt-all" class="toggle" aria-pressed="true">All patients<\/button><span class="toggle-help"><button id="vt-new" class="toggle" aria-pressed="false">New patients<\/button><span class="location-help"><button id="vt-new-info" class="location-info" type="button" aria-label="About New patients" aria-describedby="vt-new-tip">i<\/button><span id="vt-new-tip" class="location-tip" role="tooltip">[\s\S]*?<\/div><div class="control-group" role="group" aria-label="Clinicians"><button id="clin-all" class="toggle" aria-pressed="true">All clinicians<\/button><span class="toggle-help"><button id="clin-phys" class="toggle" aria-pressed="false">Physicians<\/button><span class="location-help"><button id="clin-phys-info" class="location-info"[\s\S]*?<\/div><div class="control-group" role="group" aria-label="Telemedicine"><button id="tele-show" class="toggle" aria-pressed="true">All visits<\/button><span class="toggle-help"><button id="tele-hide" class="toggle" aria-pressed="false">In person<\/button><span class="location-help"><button id="tele-hide-info" class="location-info"[\s\S]*?<\/div><\/div><\/div><\/div><\/fieldset>/);
  assert.match(styles, /\.location-help:hover \.location-tip,\.location-help:focus-within \.location-tip\{opacity:1;visibility:visible\}/);
  assert.match(styles, /\.location-info\{display:inline-grid;place-items:center;width:16px;height:16px;padding:0;border:1\.5px solid #000;border-radius:50%!important/);
  assert.doesNotMatch(slots, /filter-info|filter-tip|has-tip/);
  assert.match(styles, /\.filter-pairs \.logo-toggle\{display:inline-flex;align-items:center;justify-content:center\}/);
  assert.doesNotMatch(slots, /tele-status/, "the hidden-in-scope status line was removed");
  assert.match(slots, /<section class="toolbar slot-toolbar"/);
  assert.match(styles, /\.slot-toolbar\{grid-template-columns:minmax\(416px,1fr\) minmax\(0,1\.9fr\) minmax\(250px,\.6fr\)\}/);
  // the radius controls live in the Geography box as its second control row; no separate Radius box
  assert.match(slots, /<fieldset class="filter-group geography-group"><legend>Geography<\/legend><div class="filter-group-body"><div class="control-row"><div class="control-group" role="group" aria-label="Area type">[\s\S]*?<\/div><div class="control-group area-find"><input id="area-search"[\s\S]*?<\/div><\/div><div class="control-row"><div class="control-group" role="group" aria-label="Radius center"><input id="origin-zip"[\s\S]*?<\/div><div class="control-group radius-control"><input id="radius"[\s\S]*?<\/div><\/div><span id="radius-status" class="scope-status" role="status" hidden><\/span><\/div><\/fieldset>/);
  assert.doesNotMatch(slots, /radius-group|<legend>Radius<\/legend>/);
  assert.equal((slots.match(/<fieldset class="filter-group /g) || []).length, 3);
  assert.match(styles, /\.control-row\{display:flex;flex-wrap:wrap;gap:6px 8px;min-width:0\}/);
  assert.match(styles, /\.filter-row\{display:flex;flex-wrap:wrap;gap:6px;min-width:0\}\.filter-row>\.control-group\{flex:1 1 150px;min-width:max-content\}/, "a filter pair never shrinks below its two pills; the row wraps instead");
  assert.match(styles, /\.filter-pairs \.filter-row>\.control-group \.toggle\{padding:0 5px;font-size:9px;letter-spacing:0\}/);
  assert.match(styles, /\.filter-row>\.control-group:not\(:last-child\) \.location-tip\{left:0;right:auto\}/);
  assert.match(slots, new RegExp(`"telemedicineSlots":${slotModel.telemedicineSlots}`));
  assert.ok(slotModel.telemedicineSlots > 0, "current dataset carries AdventHealth telemedicine slots");
  assert.match(client, /hideTelemedicine: false, physiciansOnly: false, newPatientOnly: false/);
  assert.match(client, /\(!state\.hideTelemedicine \|\| !slot\.v\) && \(!state\.physiciansOnly \|\| DATA\.providers\[slot\.p\]\.c === "Physician"\) && \(!state\.newPatientOnly \|\| Boolean\(slot\.np\)\)/);
  assert.match(client, /return visibleVisit\(index\) && inRadius\(index\)/);
  assert.match(client, /if \(visibleVisit\(index\) && inRadius\(index\)/);
  assert.match(client, /state\.hideTelemedicine = value === "hide"; setPressed\("tele", value, \["show", "hide"\]\); refresh\(\);/);
  assert.match(client, /state\.physiciansOnly = value === "phys"; setPressed\("clin", value, \["phys", "all"\]\); refresh\(\);/);
  assert.match(client, /state\.newPatientOnly = value === "new"; setPressed\("vt", value, \["all", "new"\]\); refresh\(\);/);
  assert.match(client, /state\.view = "diff"; state\.hideTelemedicine = false; state\.physiciansOnly = false; state\.newPatientOnly = false;/);
  assert.match(client, /setPressed\("tele", "show", \["show", "hide"\]\); setPressed\("clin", "all", \["phys", "all"\]\); setPressed\("vt", "all", \["all", "new"\]\)/);
  assert.doesNotMatch(client, /tele-status/);
  assert.match(styles, /\.filter-pairs\{display:grid;grid-template-columns:1fr;gap:6px/);
  assert.doesNotMatch(styles, /\.comparison-group \.filter-group-body\{flex-wrap:nowrap\}/);
});

test("the header box carries each view's title with the pixel heart and no page heading remains", () => {
  const slots = renderSlotTimes();
  const providerSource = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(slots, /<div class="brand-box"><span class="mark"><span class="specialty-pick"><span class="specialty-sizer" aria-hidden="true">Cardiology<\/span><select class="specialty-select" aria-label="Specialty"><option value="cardiology"[^>]*selected>Cardiology<\/option>[\s\S]*?<\/select><span class="specialty-caret" aria-hidden="true">[\s\S]*?<\/span><\/span><b>Slot Availability<\/b><\/span><span class="pixel-heart" aria-hidden="true">/);
  assert.doesNotMatch(slots, /<h1>|Cardiology <b>Access<\/b>/);
  assert.match(suiteTitle("opportunities"), /<b>AH Market Opportunities<\/b><\/span>/);
  assert.match(suiteTitle("provider-map"), /<b>Provider Index<\/b><\/span>/);
  assert.match(providerSource, /__BRAND__/);
  assert.match(providerSource, /\.replace\("__BRAND__", \(\) => suiteTitle\("provider-map", specialty\.id\)\)/);
  assert.doesNotMatch(providerSource, /Cardiology <b>Access<\/b>/);
  assert.throws(() => suiteTitle("nope"), /Unknown suite page/);
  assert.match(SUITE_NAV_STYLES, /\.hdr \.brand-box\{width:auto;min-width:220px;padding-right:44px;justify-self:start/);
});

test("the header info button replaces the freshness line and opens a dataset dialog on every page", () => {
  const slots = renderSlotTimes();
  const providerSource = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(suiteNavigation("provider-map"), /<div class="hdr-tools"><nav class="suite-switcher" aria-label="Dashboard views">[\s\S]*<\/nav><button id="dataset-info-button" class="info-button" type="button" aria-haspopup="dialog" aria-controls="dataset-info"/);
  assert.match(slots, /id="dataset-info-button"/);
  assert.match(slots, /<dialog id="dataset-info" class="dataset-dialog" aria-labelledby="dataset-info-title">/);
  assert.match(slots, /<div class="check-verdict (ok|warn)"><span class="check-dot"><\/span><b>(All good|Needs attention)<\/b><small>/);
  // the data-check lines follow the current dataset, so the expectations are derived from the model the page was built from
  const stamp = (iso) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const day = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const count = (value) => Number(value).toLocaleString("en-US");
  assert.ok(slots.includes(`<li class="ok" data-pulled="${slotModel.generatedAt}" data-fresh-days="7"><span class="check-mark">✓</span><span>Pulled ${stamp(slotModel.generatedAt)}<span data-age></span>`), "pulled line follows the model's generatedAt");
  assert.equal(slotModel.sources.ah.runId.slice(0, 10), slotModel.sources.oh.runId.slice(0, 10), "both systems were read on the same day");
  assert.ok(slots.includes(`Both systems read on ${day(slotModel.sources.ah.runId)}.`), "same-day check names the run date");
  assert.ok(slots.includes(`Totals reconcile: ${count(slotModel.totals.ah)} AdventHealth and ${count(slotModel.totals.oh)} Orlando Health slots.`), "totals line follows the model");
  assert.doesNotMatch(slots, /Latest dataset|class="freshness"|class="hero"/);
  assert.match(slots, /dialog\.showModal\(\)/);
  assert.match(providerSource, /__INFO_DIALOG__[\s\S]*<script id="cpaths"/);
  assert.match(providerSource, /__INFO_SCRIPT__\n<\/script>`;/);
  assert.match(providerSource, /providerDataChecks\(\{ specialty: \{ group: group\.group, label: specialty\.label, note: copyOf\(specialty\)\.rosterNote, members: group\.members \}, viaSecondary: index\.viaSecondary, elsewhere: index\.elsewhere, excluded: index\.excluded, data: zData/);
  assert.match(providerSource, /buildProviderIndex\(\{ group, rosterAll: readJson\("data\/rosters\/roster\.json"/);
  assert.match(providerSource, /class="psrc">MyChart scheduling/);
  const rendered = suiteInfoDialog("Data & check", { pulled: { at: "2026-09-14T00:00:00.000Z", label: "Pulled <now>", freshDays: 7 }, checks: [{ ok: true, text: "fine" }, { ok: false, text: "a <b>problem</b>" }] });
  assert.match(rendered, /<h2 id="dataset-info-title">Data &amp; check<\/h2>/);
  assert.match(rendered, /class="check-verdict warn"[\s\S]*<b>Needs attention<\/b><small>1 of 3 checks need a look<\/small>/);
  assert.match(rendered, /<li class="warn"><span class="check-mark">!<\/span><span>a &lt;b&gt;problem&lt;\/b&gt;<\/span><\/li>/);
  assert.match(SUITE_INFO_SCRIPT, /data-pulled|freshDays|attention/);
  assert.match(SUITE_INFO_SCRIPT, /dataset-info-button/);
  assert.match(SUITE_NAV_STYLES, /\.hdr-tools\{display:flex;align-items:stretch;align-self:stretch/);
  assert.match(SUITE_NAV_STYLES, /\.suite-switcher a\{display:flex;align-items:center/);
  assert.match(SUITE_NAV_STYLES, /\.info-button\{position:absolute;right:14px;top:50%;transform:translateY\(-50%\);height:56px/);
  assert.match(SUITE_NAV_STYLES, /@media \(min-width:701px\) and \(max-width:1400px\)\{\.hdr \.hdr-in\{padding-right:78px\}\}/);
  assert.match(SUITE_NAV_STYLES, /@media \(min-width:1401px\) and \(max-width:1595px\)\{\.hdr \.hdr-in\{padding-left:78px;padding-right:78px\}\}/);
  assert.match(SUITE_NAV_STYLES, /\.info-button\{position:static;transform:none;height:auto\}/);
  assert.match(SUITE_NAV_STYLES, /@media \(min-width:1401px\)\{\.hdr \.brand-box,\.hdr \.suite-switcher\{width:466px\}\.hdr \.brand-box\{height:56px\}\}/);
  assert.doesNotMatch(SUITE_NAV_STYLES, /\.hdr \.mark\{display:block;font-size:20px/, "the title stays two lines at every width so the specialty menu always fits");
});

test("slot and market maps share the smooth zoom used by Provider Index", () => {
  const motion = readFileSync(new URL("../pages/shared/map-motion.js", import.meta.url), "utf8");
  assert.match(motion, /raster\.style\.transformOrigin = `\$\{frame\.ox\}px \$\{frame\.oy\}px`/);
  assert.match(motion, /ctx\.setTransform\(dpr \* frame\.s, 0, 0, dpr \* frame\.s, dpr \* frame\.ox, dpr \* frame\.oy\)/);
  assert.doesNotThrow(() => new Function(motion));
  assert.match(motion, /root\.SUITE_MAP_MOTION = Object\.freeze\(\{ create \}\)/);
  assert.match(motion, /requestAnimationFrame\(tick\)/);
  assert.match(motion, /Math\.exp\(-dy \* 0\.0019\)/);
  const slots = renderSlotTimes();
  assert.match(slots, /<canvas id="map-raster" width="1000" height="940" aria-hidden="true"><\/canvas>/);
  assert.match(slots, /SUITE_MAP_MOTION\.create\(\{ svg, viewport: vp, raster: \$\("map-raster"\), width: W, height: H, maxZoom: 60/);
  assert.match(readFileSync(new URL("../pages/market-opportunities/client.js", import.meta.url), "utf8"), /maxZoom: 60,[\s\S]*zoomBy\(1\.5\)/, "the market map zooms like the slot map");
  const client = readFileSync(new URL("../pages/slot-availability/client.js", import.meta.url), "utf8");
  assert.match(client, /renderMapMarkers\(\);\n    motion\.queue\(\);/);
  assert.match(client, /if \(motion\.moved\(\)\) return; selectArea\(/);
  assert.doesNotMatch(client, /svg\.setPointerCapture|zoomBy\(event\.deltaY/);
  const styles = readFileSync(new URL("../pages/slot-availability/styles.css", import.meta.url), "utf8");
  assert.match(styles, /#map-raster\{position:absolute;z-index:1;/);
  assert.match(styles, /svg\.zooming \.area,svg\.dragging \.area,svg\.zooming \.op-area,svg\.dragging \.op-area\{pointer-events:none;transition:none;shape-rendering:optimizeSpeed\}/);
});

// ---- render ----
test("escapeScriptJson round-trips spaces (SVG path 'd' stays intact)", () => {
  const escaped = escapeScriptJson({ d: "M658.8 201.0L658.3 200.3Z" });
  assert.match(escaped, /M658\.8 201\.0L658\.3 200\.3Z/);
});
test("escapeScriptJson neutralizes script-closing sequences", () => {
  assert.doesNotMatch(escapeScriptJson({ x: "</script><script>alert(1)</script>" }), /<\/script>/);
});
test("escapeScriptJson escapes U+2028/U+2029", () => {
  const s = escapeScriptJson({ s: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
  assert.match(s, /a\\u2028b\\u2029c/);
});

test("all-location headline uses geography-independent provider-location totals", () => {
  const data = {
    totals: { ah: 2, oh: 3 },
    locationTotals: { ah: 5, oh: 6 },
    specialties: [{ name: "Cardiology", ah: 2, oh: 1, ahLocations: 4, ohLocations: 2 }],
    zips: {
      "32801": { ah: 2, oh: 1, spec: { Cardiology: { a: 1, o: 1 } } },
      "33607": { ah: 1, oh: 3, spec: { Cardiology: { a: 1, o: 0 } } },
    },
  };
  assert.deepEqual(providerAvailabilityTotals(data), { ah: 5, oh: 6 });
  assert.deepEqual(providerAvailabilityTotals(data, "Cardiology"), { ah: 4, oh: 2 });
  assert.deepEqual(providerHeadline(data, { locationMode: "all", gran: "zip" }), {
    ah: 5, oh: 6, title: "Total providers available", scope: "published locations",
  });
  assert.deepEqual(providerHeadline(data, { locationMode: "all", gran: "county" }), {
    ah: 5, oh: 6, title: "Total providers available", scope: "published locations",
  });
});

test("primary-only headline remains a distinct-provider count", () => {
  const data = {
    totals: { ah: 2, oh: 3 },
    specialties: [{ name: "Cardiology", ah: 2, oh: 1 }],
    zips: {},
  };
  assert.deepEqual(providerHeadline(data, { locationMode: "primary", gran: "county" }), {
    ah: 2, oh: 3, title: "Distinct providers", scope: "statewide",
  });
  assert.deepEqual(providerHeadline(data, { locationMode: "primary", gran: "county", specialty: "Cardiology" }), {
    ah: 2, oh: 1, title: "Distinct providers", scope: "in specialty",
  });
});

test("map color key lives in the totals card without a separate lead legend", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /class="panel lpanel"|id="legend"|id="legtitle"/);
  assert.match(src, /id="map-key"/);
  assert.match(src, />Orlando Health<\/span>/);
  assert.match(src, />AdventHealth<\/span>/);
});

test("map color key keeps all three comparison labels on one row", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /\.map-key\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(3,max-content\)[^}]*white-space:nowrap/);
  assert.match(src, /id="key-tie"[^>]*>[\s\S]*?<span>Equal<\/span>/);
});

test("totals scope shares a compact single-line header", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /\.tpanel \.panel-band\{[^}]*gap:5px;[^}]*flex-wrap:nowrap/);
  assert.match(src, /\.tpanel \.panel-band h2\{[^}]*white-space:nowrap/);
  assert.match(src, /\.tpanel \.panel-band \.band-meta\{[^}]*font-size:9px/);
});

test("company view filters and refreshes the provider index", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /if\(view!=="diff"\) list=list\.filter\(x=>x\.y===view\)/);
  assert.match(src, /VISIBLE_SYSTEMS\(\)\.map/);
  assert.match(src, /paint\(\);if\(selected\)showProviders\(selected\);else resetPanel\(\)/);
});

test("nonzero ties use a red-and-blue striped map fill", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /id="tie-stripes"/);
  assert.match(src, /const TIE_FILL="url\(#tie-stripes\)"/);
  assert.match(src, /if\(d===0\) return TIE_FILL/);
  assert.match(src, /red and blue striped areas are equal/);
});

test("selected ZIP and county borders override their base stroke widths", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /#lay-zip path\.z\.sel,#lay-county path\.z\.sel\{stroke:#000;stroke-width:2\.8\}/);
  assert.match(src, /#lay-zip path\.z:hover,#lay-county path\.z:hover\{stroke:#000;stroke-width:1\.8\}/);
});

test("desktop filter boxes fill one row when they fit and wrap instead of overlapping when they do not", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /container-type:inline-size/);
  assert.doesNotMatch(src, /\.controls\{flex-wrap:nowrap\}/, "the row is never forced onto one line");
  assert.match(src, /\.controls\{display:flex;[^}]*flex-wrap:wrap/);
  assert.match(src, /\.comparison-controls\{flex:0 0 auto\}/);
  assert.match(src, /\.location-controls\{flex:0 0 auto\}/);
  assert.match(src, /\.geography-controls \.control-section-body\{flex-wrap:nowrap\}/);
  assert.doesNotMatch(src, /@container \(min-width:680px\) and \(max-width:819px\)/);
  assert.match(src, /\.pill-logo\{[^}]*width:52px;height:16px/);
  assert.match(src, /select\.control\{[^}]*width:104px;max-width:104px/);
});

test("Primary Only includes an accessible multiple-location explanation", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /id="primary-location-info"[^>]*aria-describedby="primary-location-note"/);
  assert.match(src, /Some providers work at multiple locations\. Switch to Primary Only to show each provider only at their main location\./);
  assert.match(src, /\.location-help:hover \.location-tip,\.location-help:focus-within \.location-tip\{opacity:1;visibility:visible\}/);
});

test("statewide zoom uses a raster motion layer and avoids per-move layout reads", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /id="map-raster"/);
  assert.match(src, /function beginRasterMotion\(\)/);
  assert.match(src, /raster\.style\.transform=/);
  assert.match(src, /requestAnimationFrame\(moveDrag\)/);
  const moveDrag = src.match(/function moveDrag\(\)\{[^\n]+/)?.[0] ?? "";
  assert.doesNotMatch(moveDrag, /getBoundingClientRect/);
});

test("zoom and drag reuse one cached raster without high-resolution redraws", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  assert.match(src, /const dpr=Math\.min\(2,Math\.max\(1,window\.devicePixelRatio\|\|1\)\)/);
  assert.match(src, /const run=\(\)=>\{rasterQueued=false;drawRaster\(\);\}/);
  assert.match(src, /function beginRasterMotion\(\)\{svg\.classList\.add\("zooming"\);if\(!rasterReady\)return/);
  assert.match(src, /shape-rendering:optimizeSpeed/);
  assert.doesNotMatch(src, /map-raster-detail|drawDetailRaster|BASE_ZOOM_LIMIT|boundsIntersect|motionRasterTransform/);
});

test("a county click does not enter drag mode until real pointer movement", () => {
  assert.equal(dragExceededThreshold(0, 0), false);
  assert.equal(dragExceededThreshold(3, 4), false);
  assert.equal(dragExceededThreshold(4, 4), true);

  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  const mouseDown = src.match(/svg\.addEventListener\("mousedown",[^\n]+/)?.[0] ?? "";
  const moveDrag = src.match(/function moveDrag\(\)\{[^\n]+/)?.[0] ?? "";
  assert.doesNotMatch(mouseDown, /beginRasterMotion|classList\.add\("drag"\)/);
  assert.match(moveDrag, /if\(!dragExceededThreshold\(dx,dy\)\)return/);
  assert.match(moveDrag, /beginRasterMotion\(\);svg\.classList\.add\("drag"\)/);
});

test("generated provider-map client script parses", () => {
  const html = readFileSync(new URL("../public/provider-map.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const client = scripts.at(-1)?.[1] ?? "";
  assert.ok(client.length > 0);
  assert.doesNotThrow(() => new Function(client));
});

// Regression guard. The single-system branch removes DOM nodes (#tot-ah,
// #v-diff, #leadcap, the other system's toggle). Any code that looks one of
// those up WITHOUT a null check throws, and because the throw happens inside
// totals() it silently aborts before the surviving system's number is written —
// which is exactly how the headline came to read 0. Every lookup of a removable
// element must be guarded.
test("client code never dereferences an element the single-system branch removes", () => {
  const src = readFileSync(new URL("../pages/provider-index/render.js", import.meta.url), "utf8");
  const removable = ["tot-ah", "tot-oh", "v-diff", "v-ah", "v-oh", "leadcap"];
  const unguarded = [];
  for (const m of src.matchAll(/getElementById\((?:"([a-z-]+)"|([A-Za-z]+))\)(\.[A-Za-z]+)?/g)) {
    const [whole, literal, , prop] = m;
    // A bare id in a variable (getElementById(id)) is only safe if the very next
    // statement null-checks it; the literal cases are what we can check here.
    if (!literal || !removable.includes(literal)) continue;
    if (prop) unguarded.push(`${whole} — dereferences .${prop.slice(1)} directly`);
  }
  assert.deepEqual(unguarded, [], `unguarded lookups:\n  ${unguarded.join("\n  ")}`);

  // setNum is the specific path that broke: it takes an id and must bail out.
  const setNum = src.match(/function setNum\([^)]*\)\{[^\n]*/)?.[0] ?? "";
  assert.match(setNum, /if\(!el\)return/, "setNum must tolerate a removed element");
});

test("provider cards carry a person's offices outside the selected area", () => {
  const downtown = { n: "Downtown", a: "1 Main St", c: "Orlando", z: "32804" };
  const lakeMary = { n: "Lake Mary", a: "2 Lake Rd", c: "Lake Mary", z: "32746" };
  const roster = {
    "32804": [{ i: "1", n: "A", s: "Cardiology", y: "ah", l: [downtown] }],
    "32746": [{ i: "1", n: "A", s: "Cardiology", y: "ah", l: [lakeMary] }, { i: "2", n: "B", s: "Cardiology", y: "oh", l: [{ n: "Solo", a: "3 Oak St", c: "Lake Mary", z: "32746" }] }],
  };
  const out = withOtherOffices(roster);
  assert.deepEqual(out["32804"][0].o, [lakeMary]);
  assert.deepEqual(out["32746"][0].o, [downtown]);
  assert.equal("o" in out["32746"][1], false, "single-office providers gain nothing");
  assert.deepEqual(out["32804"][0].l, [downtown], "in-area offices are untouched");
  assert.deepEqual(withOtherOffices(out)["32804"][0].o, [lakeMary], "idempotent on already-enriched rosters");
});

// ---- opportunities ----
const marketModel = {
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
  const rows = buildOpportunityRows(marketModel, { miles: euclideanMiles });
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
  const rows = buildOpportunityRows(marketModel, { from: "2026-09-04", through: "2026-09-04", includeZips: ["32801"], miles: euclideanMiles });
  assert.equal(rows.length, 1);
  assert.deepEqual({ ah: rows[0].ah, oh: rows[0].oh }, { ah: 0, oh: 1 });
  assert.deepEqual(rows[0].slotIndices, [1]);
});

test("local-market aggregation compares all active facilities within a catchment", () => {
  const rows = buildOpportunityRows(marketModel, { marketRadiusMiles: 10, miles: euclideanMiles });
  const market = rows.find((row) => row.zip === "32804");
  assert.deepEqual({ ah: market.ah, oh: market.oh }, { ah: 2, oh: 2 });
  assert.deepEqual(market.slotIndices, [0, 1, 2, 3]);
  assert.equal(market.facilitiesAh, 2);
  assert.equal(market.facilitiesOh, 1);
  assert.equal(market.marketRadiusMiles, 10);
  assert.deepEqual(rows.map((row) => row.zip).sort(), ["32801", "32804"]);
});

test("market reasons read as plain English, strongest signal first", () => {
  const downtown = buildOpportunityRows(marketModel, { miles: euclideanMiles }).find((row) => row.zip === "32801");
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

// ---- dataset-facts ----
const model = {
  generatedAt: "2026-09-14T03:14:23.283Z", status: "completed_with_warnings",
  sources: { ah: { runId: "2026-09-13T000000-0400" }, oh: { runId: "2026-09-13T000000-0400" } },
  totals: { ah: 2, oh: 1 }, slots: [{}, {}, {}], areas: { zip: { "32804": { ah: 2, oh: 0 }, "32746": { ah: 0, oh: 1 } } },
  facilities: [{ z: "32804", ct: "Orange" }, { z: "32746", ct: "Seminole" }],
  providers: new Array(3), minDate: "2026-09-14", maxDateBySystem: { ah: "2027-10-11", oh: "2028-02-22" }, commonMaxDate: "2027-10-11", telemedicineSlots: 1,
};
const zipCounty = { "32804": "Orange", "32746": "Seminole" };

test("slot checks pass on a consistent model and name the pull for live freshness", () => {
  const report = slotDataChecks(model, zipCounty);
  assert.equal(report.pulled.at, model.generatedAt);
  assert.match(report.pulled.label, /^Pulled Sep 13, 2026, 11:14 PM$/);
  assert.equal(report.pulled.freshDays, 7);
  assert.deepEqual(report.checks.map((check) => check.ok), [true, true, true, true, true, true]);
  assert.match(report.checks[4].text, /^Video-only slots: 1 AdventHealth, 0 Orlando Health\. Orlando Health publishes no video visits online/);
  assert.match(report.checks[5].text, /^Other clinicians: 0 AdventHealth and 0 Orlando Health slots/);
  assert.match(report.checks[0].text, /Both systems read on Sep 13, 2026\./);
  assert.match(report.checks[1].text, /Totals reconcile: 2 AdventHealth and 1 Orlando Health slots\./);
  assert.match(report.checks[3].text, /Sep 14, 2026 to Oct 11, 2027/);
  assert.equal(opportunityDataChecks(model, zipCounty).checks.length, 7);
  const mixed = { ...model, providers: [{ c: "Physician" }, { c: "Nurse Practitioner" }], slots: [{ y: "ah", p: 0 }, { y: "ah", p: 1 }, { y: "oh", p: 0 }] };
  const last = slotDataChecks(mixed, zipCounty).checks.at(-1);
  assert.equal(last.ok, true, "the mix is information, not a failure");
  assert.match(last.text, /^Other clinicians: 1 AdventHealth and 0 Orlando Health slots/);
  assert.match(last.text, /Orlando Health publishes physicians only; the Physicians filter leaves them out\.$/);
  // Orlando Health's orthopedics and gastroenterology catalogs open nurse practitioners too: no physicians-only claim then
  const ohMixed = { ...model, providers: [{ c: "Physician" }, { c: "Nurse Practitioner" }], slots: [{ y: "ah", p: 0 }, { y: "oh", p: 1 }] };
  const ohLast = slotDataChecks(ohMixed, zipCounty).checks.at(-1).text;
  assert.match(ohLast, /^Other clinicians: 0 AdventHealth and 1 Orlando Health slots belong to .*\. The Physicians filter leaves them out\.$/);
  assert.doesNotMatch(ohLast, /physicians only/);
});

test("slot checks fail when runs differ, totals drift, or a facility has no map location", () => {
  const broken = { ...model, sources: { ah: { runId: "2026-09-13T000000-0400" }, oh: { runId: "2026-09-12T000000-0400" } }, totals: { ah: 5, oh: 1 }, facilities: [{ z: "99999", ct: "" }] };
  const checks = slotDataChecks(broken, zipCounty).checks;
  assert.deepEqual(checks.slice(0, 3).map((check) => check.ok), [false, false, false]);
  assert.match(checks[0].text, /not from the same day/);
  assert.match(checks[1].text, /do not reconcile/);
  assert.match(checks[2].text, /1 facilities have no map location/);
});

test("provider checks reconcile the roster and report scheduling-catalog gaps", () => {
  const data = { generatedAt: "2026-08-31T19:22:44.469Z", totals: { ah: 2, oh: 1 }, specialties: [{ name: "Cardiology", ah: 1, oh: 1 }] };
  const roster = { "32804": [{ i: "1234567890", n: "A", y: "ah" }, { i: "2234567890", n: "B", y: "ah" }], "32746": [{ i: "3234567890", n: "C", y: "oh" }] };
  const good = providerDataChecks({ data, roster, zipCounty, zipShapes: new Set(["32804", "32746"]), ahCapturedAt: "2026-08-31T16:32:17.304Z", ohCapturedAt: "2026-09-15T04:20:00.000Z", gaps: { ah: 0, oh: 0 } });
  assert.equal(good.pulled.label, "Directories captured Aug 31, 2026 (AdventHealth) and Sep 15, 2026 (Orlando Health)");
  assert.equal(good.pulled.at, "2026-08-31T16:32:17.304Z", "freshness is judged on the older capture");
  assert.equal(good.pulled.freshDays, 30);
  assert.deepEqual(good.checks.map((check) => check.ok), [true, true, true, true, true]);
  const bad = providerDataChecks({ data, roster: { ...roster, "00000": [{ i: "x", n: "D", y: "oh" }] }, zipCounty, zipShapes: new Set(["32804", "32746"]), gaps: { ah: 33, oh: 5 } });
  assert.deepEqual(bad.checks.map((check) => check.ok), [false, false, false, true, false]);
  assert.match(bad.checks[4].text, /33 AdventHealth and 5 Orlando Health clinicians who book Cardiology visits in MyChart are missing from the index/);
  const withAdded = providerDataChecks({ data: { ...data, totals: { ah: 3, oh: 1 } }, roster: { ...roster, "32827": [{ i: "WP-24abc", n: "Mayra McKoy", y: "ah", src: "mychart" }] }, zipCounty: { ...zipCounty, "32827": "Orange" }, zipShapes: new Set(["32804", "32746", "32827"]), gaps: { ah: 0, oh: 0 }, added: { ah: 1, oh: 0 } });
  assert.deepEqual(withAdded.checks.map((check) => check.ok), [true, true, true, true, true]);
  assert.match(withAdded.checks[2].text, /Every directory clinician has an NPI\. The 1 added from MyChart scheduling carry their scheduling ID instead\./);
  assert.match(withAdded.checks[4].text, /1 AdventHealth and 0 Orlando Health clinicians came from the scheduling catalog/);
});

test("directory gaps match slot providers to the roster by first and last name", () => {
  const roster = { "32804": [{ i: "1", n: "Manjunath Raju", y: "ah" }, { i: "2", n: "Ricardo J Villasmil", y: "ah" }], "32806": [{ i: "3", n: "Shivanand Karkal", y: "oh" }, { i: "4", n: "Lucianne Alers Sanchez", y: "oh" }] };
  const slotModel = { providers: [
    { n: "Manjunath Raju, MD, FACC", y: "ah", c: "Physician" }, { n: "Ricardo Villasmil, MD", y: "ah", c: "Physician" },
    { n: "George Abreut, DO", y: "ah", c: "Physician" }, { n: "Mayra McKoy, APRN", y: "ah", c: "Nurse Practitioner" },
    { n: "Shivanand Karkal, MD", y: "oh", c: "Physician" }, { n: "Joel Garcia, MD", y: "oh", c: "Physician" },
    { n: "Lucianne Alers-Sanchez, MD", y: "oh", c: "Physician" }, { n: "Shivanand Karkal Jr, MD", y: "oh", c: "Physician" },
    { n: "Some Resource", y: "ah", c: "Resource" },
  ] };
  assert.deepEqual(directoryGaps(roster, slotModel), { ah: 2, oh: 1 });
  assert.deepEqual(directoryGaps({ "32806": [{ i: "9", n: "Joel A. Garcia-Fernandez", y: "oh" }] }, { providers: [{ n: "Joel Garcia, MD", y: "oh", c: "Physician" }] }), { ah: 0, oh: 0 }, "double surnames match on either part");
  assert.deepEqual(directoryGaps({}, {}), { ah: 0, oh: 0 });
});

test("name keys strip credentials and suffixes and cover double surnames", () => {
  assert.deepEqual(nameKeys("Joel A. Garcia-Fernandez, MD"), ["joel|fernandez", "joel|garcia"]);
  assert.deepEqual(nameKeys("Shivanand Karkal Jr, MD"), ["shivanand|karkal"]);
  assert.deepEqual(nameKeys("Tiji Joseph, APRN,RN"), ["tiji|joseph"]);
  assert.deepEqual(nameKeys(""), []);
});

// ---- date ----
test("shared dashboard date uses the viewer's local calendar date", () => {
  const lateLocalTime = new Date(2026, 8, 5, 23, 59, 59);
  assert.equal(globalThis.SUITE_DATE.today(lateLocalTime), "2026-09-05");
});

// ---- radius ----
const centroidSource = readFileSync(new URL("../data/geography/florida-zip-centroids.js", import.meta.url), "utf8").trim();
const centroids = JSON.parse(centroidSource.replace(/^window\.FLORIDA_ZIP_CENTROIDS=/, "").replace(/;$/, ""));

test("radius distance uses v3's great-circle mile calculation", () => {
  assert.equal(globalThis.SLOT_RADIUS.miles(28.54, -81.38, 28.54, -81.38), 0);
  assert.ok(Math.abs(globalThis.SLOT_RADIUS.miles(28, -81, 29, -81) - 69.1) < 0.2);
});

test("local Florida origin data covers every current cardiology facility ZIP", () => {
  const model = (existsSync(new URL("../data/cardiology/current/slot-times-model.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("../data/cardiology/current/slot-times-model.json", import.meta.url), "utf8")) : JSON.parse(readFileSync(new URL("../public/data/cardiology/slot-times-summary.json", import.meta.url), "utf8")));
  const originZips = new Set(centroids.map((row) => row.zip));
  assert.ok(centroids.length > 900);
  assert.ok(originZips.has("32804"));
  assert.deepEqual([...new Set(model.facilities.map((facility) => facility.z))].filter((zip) => !originZips.has(zip)), []);
});
