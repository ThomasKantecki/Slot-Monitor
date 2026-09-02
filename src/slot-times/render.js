import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUITE_NAV_STYLES, suiteNavigation } from "../shared/suite-navigation.js";

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

export function renderSlotTimes() {
  const data = readJson("data/cardiology/current/slot-times-model.json");
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
  const generated = data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Unknown";
  return PAGE
    .replace("__FONTS__", optional("data/fonts.css"))
    .replace("__LOGO_VARS__", logoVars)
    .replace("__STYLES__", read("src/slot-times/styles.css"))
    .replace("__NAV__", suiteNavigation("slot-times"))
    .replace("__NAV_STYLES__", SUITE_NAV_STYLES)
    .replace("__GENERATED__", generated)
    .replace("__STATUS__", data.status === "completed_with_warnings" ? "Completed with source warnings" : "Complete")
    .replace("__SLOT_DATA__", escapeScriptJson(data))
    .replace("__SLOT_PATHS__", escapeScriptJson(paths))
    .replace("__SLOT_OUTLINE__", escapeScriptJson(outlinePath))
    .replace("__DATE_CLIENT__", read("src/shared/date.js"))
    .replace("__RADIUS_CLIENT__", read("src/slot-times/radius.js"))
    .replace("__CLIENT__", read("src/slot-times/client.js"));
}

export function writeSlotTimes() {
  const html = renderSlotTimes(); const output = join(ROOT, "public"); mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "index.html"), html); writeFileSync(join(output, "slot-times.html"), html);
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

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cardiology Slot Availability</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>__FONTS__
__LOGO_VARS__
__STYLES__
__NAV_STYLES__</style></head><body>
<header class="hdr"><div class="hdr-in"><div class="brand-box"><span class="mark">Cardiology <b>Access</b></span><span class="pixel-heart" aria-hidden="true"><svg viewBox="0 0 9 8" shape-rendering="crispEdges"><path fill="currentColor" d="M1 0h3v1h1V0h3v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z"/></svg></span></div><div class="header-health-brand" aria-label="AdventHealth"><span class="header-health-logo" aria-hidden="true"></span></div>__NAV__</div></header>
<main class="page"><section class="hero"><div><h1>Cardiology slot availability</h1><p>Compare physical appointment availability from AdventHealth and Orlando Health across Florida ZIP codes and counties.</p></div><div class="freshness">Latest dataset: __GENERATED__<br>__STATUS__</div></section>
<section class="toolbar" aria-label="Slot availability filters">
 <fieldset class="filter-group geography-group"><legend>Geography</legend><div class="filter-group-body"><div class="control-stack"><span class="label">Area type</span><div class="control-group"><button id="gran-zip" class="toggle" aria-pressed="true">ZIP codes</button><button id="gran-county" class="toggle" aria-pressed="false">Counties</button></div></div><div class="control-stack grow-control"><label class="label" for="area-search">Find area</label><div class="control-group"><input id="area-search" class="field search" list="area-options" autocomplete="off"><datalist id="area-options"></datalist><button id="clear-area" class="plain" type="button" disabled>Clear</button></div></div></div></fieldset>
 <fieldset class="filter-group comparison-group"><legend>Comparison</legend><div class="filter-group-body"><div class="control-stack"><span class="label">Health system view</span><div class="control-group"><button id="view-diff" class="toggle" aria-pressed="true">AH + OH</button><button id="view-ah" class="toggle logo-toggle system-ah" aria-pressed="false" aria-label="AdventHealth" title="AdventHealth"><span class="comparison-logo ah" aria-hidden="true"></span></button><button id="view-oh" class="toggle logo-toggle system-oh" aria-pressed="false" aria-label="Orlando Health" title="Orlando Health"><span class="comparison-logo oh" aria-hidden="true"></span></button></div></div></div></fieldset>
 <fieldset class="filter-group radius-group"><legend>Radius</legend><div class="filter-group-body"><div class="control-stack"><label class="label" for="origin-zip">Center ZIP</label><div class="control-group"><input id="origin-zip" class="field zip-field" list="origin-options" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="32804 · default center"><datalist id="origin-options"></datalist><button id="apply-radius" class="plain" type="button">Apply</button><button id="clear-radius" class="plain" type="button">All FL</button></div></div><div class="control-stack radius-control"><label class="label" for="radius">Distance <output id="radius-value">140 miles</output></label><input id="radius" type="range" min="10" max="250" step="5" value="140"><span id="radius-status" class="scope-status" role="status"></span></div></div></fieldset>
 <fieldset class="filter-group period-group"><legend>Period</legend><div class="filter-group-body"><div class="control-stack"><label class="label" for="from-date">From</label><input id="from-date" class="field" type="date"></div><div class="control-stack"><label class="label" for="through-date">Through</label><input id="through-date" class="field" type="date"></div><button id="reset" class="plain">Reset all</button><span id="period-status" class="group-note"></span></div></fieldset>
</section>
<section class="kpis" aria-label="Filtered appointment summary"><article class="card kpi"><div class="kpi-label">AdventHealth appointments</div><div id="kpi-ah" class="kpi-value ah">—</div><div id="kpi-ah-sub" class="kpi-sub">Available appointment slots</div></article><article class="card kpi"><div class="kpi-label">Orlando Health appointments</div><div id="kpi-oh" class="kpi-value oh">—</div><div id="kpi-oh-sub" class="kpi-sub">Available appointment slots</div></article><article class="card kpi"><div class="kpi-label">Available providers</div><div id="kpi-providers" class="kpi-value">—</div><div id="kpi-period" class="kpi-sub">—</div></article><article class="card kpi"><div class="kpi-label">Facilities with slots</div><div class="kpi-pair"><div><span id="kpi-facilities-ah" class="kpi-value ah">—</span><small>AH</small></div><div><span id="kpi-facilities-oh" class="kpi-value oh">—</span><small>OH</small></div></div><div id="kpi-dates" class="kpi-sub">—</div></article></section>
<section class="workspace"><article class="panel map-panel"><div class="band"><h2 id="map-title">Physical appointments per ZIP code</h2><span id="map-meta" class="band-meta"></span></div><div class="map-wrap"><svg id="map" viewBox="0 0 1000 940" role="img" aria-label="Florida physical appointment availability map"><defs><pattern id="tie-pattern" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="10" fill="#1a75aa"></rect><rect x="5" width="5" height="10" fill="#b20838"></rect></pattern></defs><g id="map-vp"></g></svg><div class="legend"><div class="legend-row"><span class="swatch ah"></span>More AdventHealth</div><div class="legend-row"><span class="swatch tie"></span>Equal</div><div class="legend-row"><span class="swatch oh"></span>More Orlando Health</div></div><div class="zoom"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset map">↻</button></div></div></article>
 <aside class="side"><article class="card summary"><div id="area-name" class="summary-title">—</div><div id="area-sub" class="summary-sub">—</div><div class="compare"><div class="compare-box ah"><div id="area-ah" class="n">—</div><div class="t">AdventHealth appointments</div></div><div class="compare-box oh"><div id="area-oh" class="n">—</div><div class="t">Orlando Health appointments</div></div></div><div id="area-lead" class="lead">—</div></article><article class="panel profile-panel"><div class="band"><h2>Availability profile</h2><span class="band-meta">Next bookable dates</span></div><div class="profile-heading">Bookable appointments by date</div><div id="availability-profile" class="availability-profile"></div><div class="note">Bars compare AdventHealth and Orlando Health slots under the active filters.</div></article></aside>
</section>
<section class="panel facility-panel"><div class="band band-with-search"><h2 id="facility-title">Facilities with availability within the radius</h2><input id="facility-search" class="band-search" type="search" placeholder="Search facility, city, or ZIP" aria-label="Search facilities"><span id="facility-count" class="band-meta"></span></div><div id="facility-list" class="facility-list"></div><div class="note">Select a facility to review its doctors and slots. Distances are measured from the current center using ZIP representative points.</div></section>
<section class="detail"><article class="panel calendar-panel"><div class="band"><h2>Appointment calendar</h2><span class="band-meta">Select a date</span></div><div class="calendar-head"><button id="month-prev" aria-label="Previous month">‹</button><div id="month-label" class="month"></div><button id="month-next" aria-label="Next month">›</button></div><div id="calendar" class="calendar"></div></article><article class="panel slot-mix-panel"><div class="mix-card"><div class="mix-body"><div id="mix-donut" class="mix-donut"><div id="mix-total" class="mix-total"><span>—</span><small>slots</small></div></div><div class="mix-legend"><div><span class="mix-dot ah"></span><span>AdventHealth</span><b id="mix-ah">—</b></div><div><span class="mix-dot oh"></span><span>Orlando Health</span><b id="mix-oh">—</b></div></div></div></div></article><article class="panel providers-panel"><div class="band"><h2>Providers and appointment times</h2><span id="provider-date" class="band-meta"></span></div><div id="provider-list" class="provider-list"></div><div class="note">AdventHealth booking categories are shown where supplied. Orlando Health source output does not provide equivalent category labels.</div></article></section>
<section class="panel appointment-panel"><div class="band band-with-search"><h2>Detailed appointments</h2><input id="appointment-search" class="band-search appointment-search" type="search" placeholder="Search provider, location, ZIP, type, or reason" aria-label="Search appointments"><span id="appointment-count" class="band-meta"></span></div><div id="appointment-table" class="table-region"></div><div class="note">Appointment type and reason display only when retained by the source extraction.</div></section>
</main><dialog id="facility-dialog" class="facility-dialog"><div class="dialog-head"><div><span id="dialog-system" class="system-tag"></span><h2 id="dialog-title"></h2><p id="dialog-address"></p></div><button id="close-dialog" aria-label="Close facility appointments">×</button></div><div id="dialog-summary" class="dialog-summary"></div><div id="doctor-list" class="doctor-list"></div></dialog><div id="tip" class="tip" role="tooltip"></div><script>window.SLOT_DATA=__SLOT_DATA__;window.SLOT_PATHS=__SLOT_PATHS__;window.SLOT_OUTLINE=__SLOT_OUTLINE__;
__DATE_CLIENT__
__RADIUS_CLIENT__
__CLIENT__</script></body></html>`;

function main() { const result = writeSlotTimes(); console.log(`wrote index.html + public/index.html + public/slot-times.html — ${(result.bytes / 1e6).toFixed(2)} MB dashboard`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
