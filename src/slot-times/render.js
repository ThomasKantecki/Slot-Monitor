// Builds public/index.html (Slot Availability): page markup + styles.css + client.js + the map shapes, all inlined into one file.
// Also writes the root index.html launcher and public/slot-times.html, which just forward to it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteInfoDialog, suiteNavigation, suiteTitle } from "../shared/suite-navigation.js";
import { slotDataChecks } from "../shared/dataset-facts.js";
import { copyOf, specialtyFromArgv, specialtyOf, specialtyPaths } from "../shared/specialties.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const W = 1000, H = 940, PAD = 12;
const read = (relative, encoding = "utf8") => readFileSync(join(ROOT, relative), encoding);
const readJson = (relative) => JSON.parse(read(relative));
const optional = (relative) => { try { return read(relative); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } };

function albersFactory() {
  const rad = Math.PI / 180, lat1 = 24, lat2 = 31.5, lat0 = 27.6, lon0 = -84;
  const n = 0.5 * (Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  const C = Math.cos(lat1 * rad) ** 2 + 2 * n * Math.sin(lat1 * rad);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * rad)) / n;
  return (lon, lat) => { const theta = n * ((lon - lon0) * rad); const rho = Math.sqrt(C - 2 * n * Math.sin(lat * rad)) / n; return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)]; };
}
function eachRing(geometry, fn) {
  if (!geometry) return;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) fn(ring);
}
function computeFit(features) {
  const project = albersFactory(); let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feature of features) eachRing(feature.geometry, (ring) => { for (const [lon, lat] of ring) { const [x, y] = project(lon, lat); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } });
  const scale = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
  const ox = PAD + ((W - 2 * PAD) - scale * (maxX - minX)) / 2, oy = PAD + ((H - 2 * PAD) - scale * (maxY - minY)) / 2;
  return { project, tx: (x) => (ox + scale * (x - minX)).toFixed(1), ty: (y) => (oy + scale * (maxY - y)).toFixed(1) };
}
function geometryPath(geometry, fit) {
  let path = "";
  eachRing(geometry, (ring) => { path += "M"; ring.forEach(([lon, lat], index) => { const [x, y] = fit.project(lon, lat); path += `${index ? "L" : ""}${fit.tx(x)} ${fit.ty(y)}`; }); path += "Z"; });
  return path;
}
export function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(String.fromCharCode(0x2028), "\\u2028").replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

export function renderSlotTimes(specialtyId = "cardiology") {
  const specialty = specialtyOf(specialtyId), sp = specialtyPaths(specialty), copy = copyOf(specialty);
  // The page embeds the published summary; the slots themselves load by date from public/data/<specialty>/slots.
  const data = readJson(sp.summary);
  data.zipCounty = readJson("data/zip-county.json");
  const centroidSource = read("data/geography/florida-zip-centroids.js").trim();
  const centroidPrefix = "window.FLORIDA_ZIP_CENTROIDS=";
  if (!centroidSource.startsWith(centroidPrefix)) throw new Error("Florida ZIP centroid data has an unexpected format");
  const centroids = JSON.parse(centroidSource.slice(centroidPrefix.length).replace(/;$/, ""));
  const county = readJson("data/fl-county.geojson"), zip = readJson("data/fl-zcta.geojson"), outline = readJson("data/fl-county-outline.geojson");
  const fit = computeFit(county.features);
  data.origins = centroids.map((row) => {
    const projected = fit.project(row.longitude, row.latitude);
    const north = fit.project(row.longitude, row.latitude + (1 / 69));
    const x = Number(fit.tx(projected[0])), y = Number(fit.ty(projected[1]));
    const nx = Number(fit.tx(north[0])), ny = Number(fit.ty(north[1]));
    return { z: row.zip, a: row.latitude, o: row.longitude, x, y, m: Math.hypot(nx - x, ny - y) };
  });
  const paths = {
    county: county.features.map((feature) => ({ k: feature.properties.name, d: geometryPath(feature.geometry, fit) })),
    zip: zip.features.map((feature) => ({ k: feature.properties.zip, d: geometryPath(feature.geometry, fit) })),
  };
  const outlinePath = (outline.geometries ?? (outline.features ?? []).map((feature) => feature.geometry)).map((geometry) => geometryPath(geometry, fit)).join("");
  const readB64 = (relative) => read(relative, null).toString("base64");
  const logoVars = `:root{--ah-logo-img:url(data:image/png;base64,${readB64("assets/adventhealth-logo.png")});--oh-logo-img:url(data:image/png;base64,${readB64("assets/orlandohealth-logo.png")})}`;
  return PAGE
    .replace("__FONTS__", optional("data/fonts.css"))
    .replace("__LOGO_VARS__", logoVars)
    .replace("__STYLES__", read("src/slot-times/styles.css"))
    .replace("__TITLE__", () => `${specialty.label} Slot Availability`)
    .replace("__NEW_PATIENT_TIP__", () => copy.newPatientTip)
    .replace("__BRAND__", suiteTitle("slot-times", specialty.id))
    .replace("__NAV__", suiteNavigation("slot-times"))
    .replace("__NAV_STYLES__", SUITE_NAV_STYLES)
    .replace("__INFO_DIALOG__", suiteInfoDialog("Data check", slotDataChecks(data, data.zipCounty)))
    .replace("__INFO_SCRIPT__", SUITE_INFO_SCRIPT)
    .replace("__SLOT_DATA__", escapeScriptJson(data))
    .replace("__SLOT_PATHS__", escapeScriptJson(paths))
    .replace("__SLOT_OUTLINE__", escapeScriptJson(outlinePath))
    .replace("__DATE_CLIENT__", read("src/shared/date.js"))
    .replace("__RADIUS_CLIENT__", read("src/slot-times/radius.js"))
    .replace("__PARTITION_LOADER__", () => read("src/slot-times/partition-loader.js").replaceAll("__SLOT_BASE__", sp.partitionBase))
    .replace("__MOTION_CLIENT__", read("src/shared/map-motion.js"))
    .replace("__CLIENT__", read("src/slot-times/client.js"));
}

export function writeSlotTimes(specialtyId = "cardiology") {
  const specialty = specialtyOf(specialtyId);
  const html = renderSlotTimes(specialty.id); const output = join(ROOT, specialtyPaths(specialty).pages); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "index.html"), html);
  if (specialty.folder) return { bytes: html.length };
  // the root pages: the old slot-times.html address and the repository-root launcher forward to Cardiology
  // slot-times.html was the page's earlier address; it now forwards to index.html instead of duplicating 1.7 MB
  writeFileSync(join(output, "slot-times.html"), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./index.html"><title>Cardiology Slot Availability</title><script>location.replace("./index.html" + location.search + location.hash)</script></head><body><p><a href="./index.html">Open Cardiology Slot Availability</a></p></body></html>\n');
  writeFileSync(join(ROOT, "index.html"), ROOT_LANDING);
  return { bytes: html.length };
}

const ROOT_LANDING = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=./public/index.html">
<title>Cardiology Slot Availability</title>
<script>location.replace("./public/index.html" + location.search + location.hash)</script>
</head>
<body>
<p><a href="./public/index.html">Open Cardiology Slot Availability</a></p>
</body>
</html>
`;

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>__TITLE__</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>__FONTS__
__LOGO_VARS__
__STYLES__
__NAV_STYLES__</style></head><body>
<header class="hdr"><div class="hdr-in">__BRAND__<div class="header-health-brand" aria-label="AdventHealth"><span class="header-health-logo" aria-hidden="true"></span></div>__NAV__</div></header>
<main class="page">
<section class="toolbar slot-toolbar" aria-label="Slot availability filters">
 <fieldset class="filter-group geography-group"><legend>Geography</legend><div class="filter-group-body"><div class="control-row"><div class="control-group" role="group" aria-label="Area type"><button id="gran-zip" class="toggle" aria-pressed="true">ZIP codes</button><button id="gran-county" class="toggle" aria-pressed="false">Counties</button></div><div class="control-group area-find"><input id="area-search" class="field search" list="area-options" autocomplete="off" aria-label="Find area"><datalist id="area-options"></datalist><button id="clear-area" class="plain" type="button" disabled>Clear</button></div></div><div class="control-row"><div class="control-group" role="group" aria-label="Radius center"><input id="origin-zip" class="field zip-field" list="origin-options" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="Center ZIP" aria-label="Center ZIP"><datalist id="origin-options"></datalist><button id="apply-radius" class="plain" type="button">Apply</button><button id="clear-radius" class="plain" type="button">All FL</button></div><div class="control-group radius-control"><input id="radius" type="range" min="5" max="250" step="5" value="140" aria-label="Distance in miles"><output id="radius-value" for="radius">140 miles</output></div></div><span id="radius-status" class="scope-status" role="status" hidden></span></div></fieldset>
 <fieldset class="filter-group comparison-group"><legend>Comparison</legend><div class="filter-group-body"><div class="filter-pairs"><div class="control-group view-group" role="group" aria-label="Health system view"><button id="view-diff" class="toggle" aria-pressed="true">AdventHealth + Orlando Health</button><button id="view-ah" class="toggle logo-toggle system-ah" aria-pressed="false" aria-label="AdventHealth" title="AdventHealth"><span class="comparison-logo ah" aria-hidden="true"></span></button><button id="view-oh" class="toggle logo-toggle system-oh" aria-pressed="false" aria-label="Orlando Health" title="Orlando Health"><span class="comparison-logo oh" aria-hidden="true"></span></button></div><div class="filter-row"><div class="control-group" role="group" aria-label="Visit type"><button id="vt-all" class="toggle" aria-pressed="true">All patients</button><span class="toggle-help"><button id="vt-new" class="toggle" aria-pressed="false">New patients</button><span class="location-help"><button id="vt-new-info" class="location-info" type="button" aria-label="About New patients" aria-describedby="vt-new-tip">i</button><span id="vt-new-tip" class="location-tip" role="tooltip">__NEW_PATIENT_TIP__</span></span></span></div><div class="control-group" role="group" aria-label="Clinicians"><button id="clin-all" class="toggle" aria-pressed="true">All clinicians</button><span class="toggle-help"><button id="clin-phys" class="toggle" aria-pressed="false">Physicians</button><span class="location-help"><button id="clin-phys-info" class="location-info" type="button" aria-label="About Physicians" aria-describedby="clin-phys-tip">i</button><span id="clin-phys-tip" class="location-tip" role="tooltip">Counts only MD and DO schedules. AdventHealth also lets patients book nurse practitioners, physician assistants and nurse visits online; Orlando Health publishes physicians only. This makes the two sides like for like.</span></span></span></div><div class="control-group" role="group" aria-label="Telemedicine"><button id="tele-show" class="toggle" aria-pressed="true">All visits</button><span class="toggle-help"><button id="tele-hide" class="toggle" aria-pressed="false">In person</button><span class="location-help"><button id="tele-hide-info" class="location-info" type="button" aria-label="About In person" aria-describedby="tele-hide-tip">i</button><span id="tele-hide-tip" class="location-tip" role="tooltip">Leaves out slots that can only be booked as a video visit. AdventHealth offers video visits online; Orlando Health does not, so this compares office visits with office visits.</span></span></span></div></div></div></div></fieldset>
 <fieldset class="filter-group period-group"><legend>Period</legend><div class="filter-group-body"><div class="control-group date-range"><input id="from-date" class="field" type="date" aria-label="From date"><span class="range-sep" aria-hidden="true">–</span><input id="through-date" class="field" type="date" aria-label="Through date"></div><div class="control-group"><select id="period-preset" class="field period-preset" aria-label="Quick period"><option value="all">Full window</option><option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option><option value="custom" hidden>Custom dates</option></select><button id="reset" class="plain" type="button">Reset all</button></div></div></fieldset>
</section>
<section class="workspace"><article class="panel map-panel"><div class="band"><h2 id="map-title">Physical appointments per ZIP code</h2><span id="map-meta" class="band-meta"></span></div><div class="map-wrap"><div class="hint">Scroll to zoom &middot; drag to pan &middot; click for appointments</div><svg id="map" viewBox="0 0 1000 940" role="img" aria-label="Florida physical appointment availability map"><defs><pattern id="tie-pattern" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="10" fill="#1a75aa"></rect><rect x="5" width="5" height="10" fill="#b20838"></rect></pattern></defs><g id="map-vp"></g></svg><canvas id="map-raster" width="1000" height="940" aria-hidden="true"></canvas><div class="legend"><div class="legend-row"><span class="swatch ah"></span>More AdventHealth</div><div class="legend-row"><span class="swatch tie"></span>Equal</div><div class="legend-row"><span class="swatch oh"></span>More Orlando Health</div></div><div class="zoom"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset map" style="font-size:12px">&#8634;</button></div></div></article>
 <aside class="side"><article class="card summary"><div class="summary-band"><h2 id="area-name" class="summary-title">—</h2></div><div class="summary-rows"><div class="summary-row ah"><span class="tlogo ah" role="img" aria-label="AdventHealth"></span><div class="summary-figure"><div id="kpi-ah" class="n">—</div><div id="kpi-ah-sub" class="s">Available appointment slots</div></div></div><div class="summary-rule"></div><div class="summary-row oh"><span class="tlogo oh" role="img" aria-label="Orlando Health"></span><div class="summary-figure"><div id="kpi-oh" class="n">—</div><div id="kpi-oh-sub" class="s">Available appointment slots</div></div></div></div><div class="summary-facts"><div class="fact"><span id="kpi-providers" class="fact-n">—</span><span class="fact-t">Available providers</span></div><div class="fact"><span class="fact-n pair"><span id="kpi-facilities-ah" class="ah">—</span><small>AH</small><span id="kpi-facilities-oh" class="oh">—</span><small>OH</small></span><span class="fact-t">Facilities with slots</span></div></div><div id="area-lead" class="lead">—</div></article><article class="panel profile-panel"><div class="band"><h2>Availability profile</h2></div><div class="profile-heading">Bookable appointments by date</div><div id="availability-profile" class="availability-profile"></div></article></aside>
</section>
<section class="panel facility-panel"><div class="band"><h2 id="facility-title">Facilities with availability within the radius</h2></div><div id="facility-list" class="facility-list"></div><div class="note">Select a facility to review its doctors and slots. Distances are measured from the current center using ZIP representative points.</div></section>
<section class="panel detail-panel"><div class="band"><h2>Appointment calendar and providers</h2><span id="provider-date" class="band-meta"></span></div><div class="detail"><div class="detail-calendar"><div class="calendar-head"><button id="month-prev" aria-label="Previous month">‹</button><div id="month-label" class="month"></div><button id="month-next" aria-label="Next month">›</button></div><div id="calendar" class="calendar"></div><div class="slot-mix-block"><div class="mix-card"><div class="mix-body"><div id="mix-donut" class="mix-donut"><div id="mix-total" class="mix-total"><span>—</span><small>slots</small></div></div><div class="mix-legend"><div><span class="mix-dot ah"></span><span>AdventHealth</span><b id="mix-ah">—</b></div><div><span class="mix-dot oh"></span><span>Orlando Health</span><b id="mix-oh">—</b></div></div></div></div></div></div><div class="detail-providers"><div id="provider-list" class="provider-list"></div><div class="note">AdventHealth booking categories are shown where supplied. Orlando Health source output does not provide equivalent category labels.</div></div></div></section>
</main><dialog id="facility-dialog" class="facility-dialog"><div class="dialog-head"><div><span id="dialog-system" class="system-logo big" role="img"></span><h2 id="dialog-title"></h2><p id="dialog-address"></p></div><button id="close-dialog" aria-label="Close facility appointments">×</button></div><div id="dialog-summary" class="dialog-summary"></div><div id="doctor-list" class="doctor-list"></div></dialog><div id="tip" class="tip" role="tooltip"></div>__INFO_DIALOG__<script>window.SLOT_DATA=__SLOT_DATA__;window.SLOT_PATHS=__SLOT_PATHS__;window.SLOT_OUTLINE=__SLOT_OUTLINE__;
__DATE_CLIENT__
__RADIUS_CLIENT__
__PARTITION_LOADER__
__MOTION_CLIENT__
__CLIENT__
__INFO_SCRIPT__</script></body></html>`;

function main() {
  const specialty = specialtyFromArgv(); const result = writeSlotTimes(specialty.id);
  console.log(specialty.folder ? `wrote ${specialtyPaths(specialty).pages}index.html — ${(result.bytes / 1e6).toFixed(2)} MB dashboard` : `wrote index.html + public/index.html (+ slot-times.html redirect) — ${(result.bytes / 1e6).toFixed(2)} MB dashboard`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
