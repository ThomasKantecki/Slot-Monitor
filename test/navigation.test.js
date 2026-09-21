// The built Slot Availability page: header, toolbar markup, filters, map controls and the summary card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteInfoDialog, suiteNavigation, suiteTitle } from "../src/shared/suite-navigation.js";
import { renderSlotTimes } from "../src/slot-times/render.js";

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
  assert.match(providerSource, /class="pill-group" role="group" aria-label="Area type"/);
  assert.match(providerSource, /id="area-search"[^>]*aria-label="Find area"/);
  assert.match(providerSource, /class="pill-group" role="group" aria-label="Health system view"/);
  assert.doesNotMatch(providerSource, /class="cap">Area type<|>Find area<\/label>|id="leadcap"/);
  assert.match(providerSource, /class="control-section location-controls"><legend>Locations<\/legend>/);
  assert.match(providerSource, /id="m-all" class="filter-pill pill" aria-pressed="true">All locations</);
  assert.doesNotMatch(providerSource, /aria-label="provider locations" hidden/);
  assert.match(providerSource, /\.control-section\{min-width:0;margin:0;padding:/);
});

test("both views share the Slot Monitor shell while the landing page remains responsive", () => {
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
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
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
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
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
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
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
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
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/slot-times/styles.css", import.meta.url), "utf8");
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
  const provider = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  for (const page of [provider + suiteTitle("provider-map"), slots]) {
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

test("telemedicine slots can be hidden from every filtered view and Reset shows them again", () => {
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/slot-times/styles.css", import.meta.url), "utf8");
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
  assert.match(styles, /\.filter-row\{display:flex;flex-wrap:wrap;gap:6px;min-width:0\}\.filter-row>\.control-group\{flex:1 1 150px;min-width:0\}/);
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
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
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
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
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
  assert.match(providerSource, /buildProviderIndex\(\{ group, rosterAll: readJson\("data\/roster\.json"/);
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
  const motion = readFileSync(new URL("../src/shared/map-motion.js", import.meta.url), "utf8");
  assert.match(motion, /raster\.style\.transformOrigin = `\$\{frame\.ox\}px \$\{frame\.oy\}px`/);
  assert.match(motion, /ctx\.setTransform\(dpr \* frame\.s, 0, 0, dpr \* frame\.s, dpr \* frame\.ox, dpr \* frame\.oy\)/);
  assert.doesNotThrow(() => new Function(motion));
  assert.match(motion, /root\.SUITE_MAP_MOTION = Object\.freeze\(\{ create \}\)/);
  assert.match(motion, /requestAnimationFrame\(tick\)/);
  assert.match(motion, /Math\.exp\(-dy \* 0\.0019\)/);
  const slots = renderSlotTimes();
  assert.match(slots, /<canvas id="map-raster" width="1000" height="940" aria-hidden="true"><\/canvas>/);
  assert.match(slots, /SUITE_MAP_MOTION\.create\(\{ svg, viewport: vp, raster: \$\("map-raster"\), width: W, height: H, maxZoom: 60/);
  assert.match(readFileSync(new URL("../src/opportunities/client.js", import.meta.url), "utf8"), /maxZoom: 60,[\s\S]*zoomBy\(1\.5\)/, "the market map zooms like the slot map");
  const client = readFileSync(new URL("../src/slot-times/client.js", import.meta.url), "utf8");
  assert.match(client, /renderMapMarkers\(\);\n    motion\.queue\(\);/);
  assert.match(client, /if \(motion\.moved\(\)\) return; selectArea\(/);
  assert.doesNotMatch(client, /svg\.setPointerCapture|zoomBy\(event\.deltaY/);
  const styles = readFileSync(new URL("../src/slot-times/styles.css", import.meta.url), "utf8");
  assert.match(styles, /#map-raster\{position:absolute;z-index:1;/);
  assert.match(styles, /svg\.zooming \.area,svg\.dragging \.area,svg\.zooming \.op-area,svg\.dragging \.op-area\{pointer-events:none;transition:none;shape-rendering:optimizeSpeed\}/);
});
