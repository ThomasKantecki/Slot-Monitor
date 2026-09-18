// Builds public/market-opportunities.html: page markup + styles.css + scoring.js + client.js + the map shapes, all inlined into one file.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteInfoDialog, suiteNavigation, suiteTitle } from "../shared/suite-navigation.js";
import { opportunityDataChecks } from "../shared/dataset-facts.js";
import { escapeScriptJson } from "../slot-times/render.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const W = 1000, H = 940, PAD = 12;
const read = (relative, encoding = "utf8") => readFileSync(join(ROOT, relative), encoding);
const readJson = (relative) => JSON.parse(read(relative));
const optional = (relative) => { try { return read(relative); } catch (error) { if (error.code === "ENOENT") return ""; throw error; } };

function albersFactory() {
  const rad = Math.PI / 180, lat1 = 24, lat2 = 31.5, lat0 = 27.6, lon0 = -84;
  const n = 0.5 * (Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  const c = Math.cos(lat1 * rad) ** 2 + 2 * n * Math.sin(lat1 * rad);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(lat0 * rad)) / n;
  return (lon, lat) => { const theta = n * ((lon - lon0) * rad); const rho = Math.sqrt(c - 2 * n * Math.sin(lat * rad)) / n; return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)]; };
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

export function renderOpportunities() {
  // The page embeds the published summary; the slots themselves load by date from public/data/cardiology/slots.
  const data = readJson("public/data/cardiology/slot-times-summary.json");
  data.zipCounty = readJson("data/zip-county.json");
  const centroidSource = read("data/geography/florida-zip-centroids.js").trim();
  const centroidPrefix = "window.FLORIDA_ZIP_CENTROIDS=";
  if (!centroidSource.startsWith(centroidPrefix)) throw new Error("Florida ZIP centroid data has an unexpected format");
  const centroids = JSON.parse(centroidSource.slice(centroidPrefix.length).replace(/;$/, ""));
  const counties = readJson("data/fl-county.geojson"), zips = readJson("data/fl-zcta.geojson"), outline = readJson("data/fl-county-outline.geojson");
  const fit = computeFit(counties.features);
  data.origins = centroids.map((row) => {
    const projected = fit.project(row.longitude, row.latitude);
    const north = fit.project(row.longitude, row.latitude + (1 / 69));
    const x = Number(fit.tx(projected[0])), y = Number(fit.ty(projected[1]));
    const nx = Number(fit.tx(north[0])), ny = Number(fit.ty(north[1]));
    return { z: row.zip, a: row.latitude, o: row.longitude, x, y, m: Math.hypot(nx - x, ny - y) };
  });
  const paths = zips.features.map((feature) => ({ k: feature.properties.zip, d: geometryPath(feature.geometry, fit) }));
  const outlinePath = (outline.geometries ?? (outline.features ?? []).map((feature) => feature.geometry)).map((geometry) => geometryPath(geometry, fit)).join("");
  const readB64 = (relative) => read(relative, null).toString("base64");
  const logoVars = `:root{--ah-logo-img:url(data:image/png;base64,${readB64("assets/adventhealth-logo.png")});--oh-logo-img:url(data:image/png;base64,${readB64("assets/orlandohealth-logo.png")})}`;
  const scoringClient = read("src/opportunities/scoring.js").replaceAll("export ", "");
  return PAGE
    .replace("__FONTS__", optional("data/fonts.css"))
    .replace("__LOGO_VARS__", logoVars)
    .replace("__BASE_STYLES__", read("src/slot-times/styles.css"))
    .replace("__STYLES__", read("src/opportunities/styles.css"))
    .replace("__NAV_STYLES__", SUITE_NAV_STYLES)
    .replace("__BRAND__", suiteTitle("opportunities"))
    .replace("__NAV__", suiteNavigation("opportunities"))
    .replace("__INFO_DIALOG__", suiteInfoDialog("Data check", opportunityDataChecks(data, data.zipCounty)))
    .replace("__INFO_SCRIPT__", SUITE_INFO_SCRIPT)
    .replace("__SLOT_DATA__", escapeScriptJson(data))
    .replace("__ZIP_PATHS__", escapeScriptJson(paths))
    .replace("__OUTLINE__", escapeScriptJson(outlinePath))
    .replace("__DATE_CLIENT__", read("src/shared/date.js"))
    .replace("__RADIUS_CLIENT__", read("src/slot-times/radius.js"))
    .replace("__PARTITION_LOADER__", read("src/slot-times/partition-loader.js"))
    .replace("__MOTION_CLIENT__", read("src/shared/map-motion.js"))
    .replace("__SCORING_CLIENT__", scoringClient)
    .replace("__CLIENT__", read("src/opportunities/client.js"));
}

export function writeOpportunities() {
  const html = renderOpportunities();
  const output = join(ROOT, "public");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "market-opportunities.html"), html);
  return { bytes: html.length };
}

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AH Market Opportunities</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>__FONTS__
__LOGO_VARS__
__BASE_STYLES__
__STYLES__
__NAV_STYLES__</style></head><body>
<header class="hdr"><div class="hdr-in">__BRAND__<div class="header-health-brand" aria-label="AdventHealth"><span class="header-health-logo" aria-hidden="true"></span></div>__NAV__</div></header>
<main class="page opportunity-page"><section class="toolbar op-toolbar" aria-label="Market opportunity filters">
 <fieldset class="filter-group geography-group"><legend>Geography</legend><div class="filter-group-body"><div class="control-row"><div class="control-group area-find"><input id="area-search" class="field search" list="area-options" autocomplete="off" placeholder="Search ZIP or county" aria-label="Find ZIP or county"><datalist id="area-options"></datalist><button id="clear-area" class="plain" type="button" disabled>Clear</button></div></div><div class="control-row"><div class="control-group" role="group" aria-label="Radius center"><input id="origin-zip" class="field zip-field" list="origin-options" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="Center ZIP" aria-label="Center ZIP"><datalist id="origin-options"></datalist><button id="apply-radius" class="plain" type="button">Apply</button><button id="clear-radius" class="plain" type="button">All FL</button></div><div class="control-group radius-control"><input id="radius" type="range" min="5" max="250" step="5" value="140" aria-label="Distance in miles"><output id="radius-value" for="radius">140 miles</output></div></div><span id="radius-status" class="scope-status" role="status" hidden></span></div></fieldset>
 <fieldset class="filter-group opportunity-group"><legend>Opportunity</legend><div class="filter-group-body"><div class="control-group market-filter"><select id="opportunity-filter" class="field" aria-label="Show markets"><option value="all">All markets</option><option value="lead">Orlando Health leads the market</option><option value="gap">No AdventHealth slots in the ZIP</option><option value="sooner">Orlando Health books a week sooner</option></select></div></div></fieldset>
 <fieldset class="filter-group period-group"><legend>Period</legend><div class="filter-group-body"><div class="control-group date-range"><input id="from-date" class="field" type="date" aria-label="From date"><span class="range-sep" aria-hidden="true">–</span><input id="through-date" class="field" type="date" aria-label="Through date"></div><div class="control-group"><select id="period-preset" class="field period-preset" aria-label="Quick period"><option value="all">Full window</option><option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option><option value="custom" hidden>Custom dates</option></select><button id="reset" class="plain" type="button">Reset all</button></div></div></fieldset>
</section>
<section class="workspace"><article class="panel map-panel"><div class="band"><h2 id="map-title">Cardiology markets</h2><span id="map-meta" class="band-meta"></span></div><div class="map-wrap"><svg id="map" viewBox="0 0 1000 940" role="img" tabindex="0" aria-label="Florida cardiology market map"><g id="map-vp"></g></svg><canvas id="map-raster" width="1000" height="940" aria-hidden="true"></canvas><div class="legend"><div class="legend-row"><span class="swatch dot oh"></span>Orlando Health leads the market</div><div class="legend-row"><span class="swatch dot gap"></span>No AdventHealth slots in the ZIP</div><div class="legend-row"><span class="swatch dot ah"></span>AdventHealth leads</div></div><div class="zoom"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset map">↻</button></div></div></article>
 <aside class="side"><article class="card summary"><div id="summary-overview"><div id="area-name" class="summary-title">—</div><div class="compare"><div class="compare-box oh"><div id="kpi-coverage" class="n">—</div><div class="t">Markets where Orlando Health leads</div></div><div class="compare-box oh"><div id="kpi-priority" class="n">—</div><div class="t">ZIPs with no AdventHealth slots</div></div><div class="compare-box"><div id="kpi-earlier" class="n">—</div><div class="t">Markets booking a week or more sooner at Orlando Health</div></div><div class="compare-box"><div id="kpi-slot-gap" class="n">—</div><div class="t">Largest Orlando Health lead</div><div id="kpi-slot-gap-sub" class="s">—</div></div></div><div id="area-lead" class="lead">—</div></div><div id="summary-market" hidden><div id="market-name" class="summary-title">—</div><div id="market-rank" class="summary-sub">—</div><div class="compare"><div class="compare-box oh"><div id="market-oh" class="n">—</div><div class="t"><span class="system-logo oh" role="img" aria-label="Orlando Health"></span> slots</div><div id="market-oh-sub" class="s">—</div></div><div class="compare-box ah"><div id="market-ah" class="n">—</div><div class="t"><span class="system-logo ah" role="img" aria-label="AdventHealth"></span> slots</div><div id="market-ah-sub" class="s">—</div></div><div class="compare-box"><div class="n pair dates"><span id="market-earliest-oh" class="oh">—</span><small>OH</small><span id="market-earliest-ah" class="ah">—</span><small>AH</small></div><div class="t">Earliest appointment</div></div><div class="compare-box"><div id="market-nearest" class="n">—</div><div class="t">Nearest AdventHealth</div><div id="market-nearest-sub" class="s">—</div></div></div><div id="market-reasons" class="reasons"></div><div id="market-lead" class="lead">—</div><div class="summary-actions"><button id="open-market" class="plain" type="button">Facilities and providers</button><button id="back-overview" class="plain" type="button">Back to overview</button></div></div></article><article class="panel rank-panel"><div class="band"><h2>Ranked markets</h2><span id="market-count" class="band-meta"></span></div><div id="market-table" class="rank-list"></div></article></aside>
</section>
</main>
<dialog id="market-dialog" class="facility-dialog"><div class="dialog-head"><div><h2 id="dialog-title"></h2><p id="dialog-subtitle"></p></div><button id="close-dialog" aria-label="Close market details">×</button></div><div id="dialog-summary" class="dialog-summary"></div><div id="dialog-facilities" class="dialog-facilities"></div></dialog><div id="tip" class="tip" role="tooltip"></div>
__INFO_DIALOG__<script>window.SLOT_DATA=__SLOT_DATA__;window.ZIP_PATHS=__ZIP_PATHS__;window.FLORIDA_OUTLINE=__OUTLINE__;
__DATE_CLIENT__
__RADIUS_CLIENT__
__PARTITION_LOADER__
__MOTION_CLIENT__
__SCORING_CLIENT__
__CLIENT__
__INFO_SCRIPT__</script></body></html>`;

function main() { const result = writeOpportunities(); console.log(`wrote public/market-opportunities.html — ${(result.bytes / 1e6).toFixed(2)} MB dashboard`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
