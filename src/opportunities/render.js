import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUITE_NAV_STYLES, suiteNavigation } from "../shared/suite-navigation.js";
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
  const data = readJson("data/cardiology/current/slot-times-model.json");
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
  const generated = data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Unknown";
  const scoringClient = read("src/opportunities/scoring.js").replaceAll("export ", "");
  return PAGE
    .replace("__FONTS__", optional("data/fonts.css"))
    .replace("__LOGO_VARS__", logoVars)
    .replace("__BASE_STYLES__", read("src/slot-times/styles.css"))
    .replace("__STYLES__", read("src/opportunities/styles.css"))
    .replace("__NAV_STYLES__", SUITE_NAV_STYLES)
    .replace("__NAV__", suiteNavigation("opportunities"))
    .replace("__GENERATED__", generated)
    .replace("__STATUS__", data.status === "completed_with_warnings" ? "Completed with source warnings" : "Complete")
    .replace("__SLOT_DATA__", escapeScriptJson(data))
    .replace("__ZIP_PATHS__", escapeScriptJson(paths))
    .replace("__OUTLINE__", escapeScriptJson(outlinePath))
    .replace("__DATE_CLIENT__", read("src/shared/date.js"))
    .replace("__RADIUS_CLIENT__", read("src/slot-times/radius.js"))
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
<header class="hdr"><div class="hdr-in"><div class="brand-box"><span class="mark">Cardiology <b>Access</b></span><span class="pixel-heart" aria-hidden="true"><svg viewBox="0 0 9 8" shape-rendering="crispEdges"><path fill="currentColor" d="M1 0h3v1h1V0h3v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z"/></svg></span></div><div class="header-health-brand" aria-label="AdventHealth"><span class="header-health-logo" aria-hidden="true"></span></div>__NAV__</div></header>
<main class="page opportunity-page"><section class="hero"><div><h1>AH market opportunities</h1><p>Prioritize ZIP-centered 25-mile cardiology markets where Orlando Health leads AdventHealth in appointment availability.</p></div><div class="freshness">Latest dataset: __GENERATED__<br>__STATUS__</div></section>
<section class="toolbar op-toolbar" aria-label="Market opportunity filters">
 <fieldset class="filter-group geography-group"><legend>Geography</legend><div class="filter-group-body"><div class="control-stack grow-control"><label class="label" for="area-search">Find ZIP or county</label><div class="control-group"><input id="area-search" class="field search" list="area-options" autocomplete="off" placeholder="Search ZIP or county"><datalist id="area-options"></datalist><button id="clear-area" class="plain" type="button" disabled>Clear</button></div></div></div></fieldset>
 <fieldset class="filter-group radius-group"><legend>Radius</legend><div class="filter-group-body"><div class="control-stack"><label class="label" for="origin-zip">Center ZIP</label><div class="control-group"><input id="origin-zip" class="field zip-field" list="origin-options" inputmode="numeric" maxlength="5" autocomplete="postal-code" placeholder="32804 · default center"><datalist id="origin-options"></datalist><button id="apply-radius" class="plain" type="button">Apply</button><button id="clear-radius" class="plain" type="button">All FL</button></div></div><div class="control-stack radius-control"><label class="label" for="radius">Distance <output id="radius-value">140 miles</output></label><input id="radius" type="range" min="10" max="250" step="5" value="140"><span id="radius-status" class="scope-status" role="status"></span></div></div></fieldset>
 <fieldset class="filter-group opportunity-group"><legend>Opportunity</legend><div class="filter-group-body"><div class="control-stack"><label class="label" for="opportunity-filter">Show markets</label><select id="opportunity-filter" class="field"><option value="all">All opportunity signals</option><option value="high">High priority (50+)</option><option value="coverage">Exact-ZIP AH gaps</option><option value="earlier">OH earliest is sooner</option><option value="slots">OH has more slots</option></select></div></div></fieldset>
 <fieldset class="filter-group period-group"><legend>Period</legend><div class="filter-group-body"><div class="control-stack"><label class="label" for="from-date">From</label><input id="from-date" class="field" type="date"></div><div class="control-stack"><label class="label" for="through-date">Through</label><input id="through-date" class="field" type="date"></div><button id="reset" class="plain" type="button">Reset all</button><span id="period-status" class="group-note"></span></div></fieldset>
</section>
<section class="kpis" aria-label="Opportunity summary"><article class="card kpi"><div class="kpi-label">Exact-ZIP AH gaps</div><div id="kpi-priority" class="kpi-value oh">—</div><div class="kpi-sub">ZIPs with OH slots and no AH slots in the same ZIP</div></article><article class="card kpi"><div class="kpi-label">OH-leading local markets</div><div id="kpi-coverage" class="kpi-value oh">—</div><div class="kpi-sub">25-mile markets where OH has more slots than AH</div></article><article class="card kpi"><div class="kpi-label">OH earlier access</div><div id="kpi-earlier" class="kpi-value">—</div><div class="kpi-sub">OH-leading markets where OH's earliest date is sooner</div></article><article class="card kpi"><div class="kpi-label">Largest OH slot advantage</div><div id="kpi-slot-gap" class="kpi-value">—</div><div class="kpi-sub">Largest OH lead in one 25-mile market</div></article></section>
<section class="opportunity-workspace"><article class="panel opportunity-map-panel"><div class="band"><h2 id="map-title">Cardiology opportunity signals</h2><span id="map-meta" class="band-meta"></span></div><div class="map-wrap"><svg id="map" viewBox="0 0 1000 940" role="img" tabindex="0" aria-label="Exact-ZIP AdventHealth gaps and ZIP-centered 25-mile Florida markets where Orlando Health leads AdventHealth in cardiology appointment slots. Drag to pan, use the mouse wheel to zoom, or use arrow keys to pan."><g id="map-vp"></g></svg><div class="op-legend"><div><span class="op-dot coverage"></span>Exact ZIP: AH absent · OH present</div><div><span class="op-dot lead"></span>25-mile market: AH present · OH leads</div><div class="legend-size">Marker size = opportunity score · maroon core inside coral = both</div></div><div class="zoom"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset map">↻</button></div></div></article>
 <aside class="opportunity-side"><article class="panel evidence-panel"><div class="band"><h2>Selected market evidence</h2><span class="band-meta">Click a marker or table row</span></div><div id="market-evidence" class="market-evidence"><div class="evidence-empty">Select a market center to review exact-ZIP and nearby-market evidence.</div></div></article><article class="card methodology"><h2>How priority is scored</h2><div class="weight-list"><span><b>35</b> AH coverage gap</span><span><b>25</b> OH timing advantage</span><span><b>20</b> OH slot advantage</span><span><b>10</b> Persistent OH lead</span><span><b>10</b> Distance to active AH access</span></div><p>Maroon markers preserve same-ZIP gaps. Coral markers compare every active AH and OH facility within 25 miles of the represented ZIP center. The Radius control changes which centers are shown, not the 25-mile comparison. Overlapping markets can contain the same slots, so market counts should not be summed. This is a prioritization signal—not patient demand or market share.</p></article></aside>
</section>
<section class="panel opportunity-table-panel"><div class="band band-with-search"><h2>Ranked priority opportunities</h2><input id="table-search" class="band-search" type="search" placeholder="Search ZIP or county" aria-label="Search ranked opportunities"><span id="opportunity-count" class="band-meta"></span></div><div id="opportunity-table" class="opportunity-table"></div><div class="note">Counts represent physical appointment slots within each market's 25-mile catchment after the established AH/OH slot rules. Catchments overlap and are not additive. Comparisons stop at the common system endpoint unless the period is changed.</div></section>
</main>
<dialog id="market-dialog" class="facility-dialog market-dialog"><div class="dialog-head"><div><span class="system-tag oh">AH opportunity</span><h2 id="dialog-title"></h2><p id="dialog-subtitle"></p></div><button id="close-dialog" aria-label="Close market evidence">×</button></div><div id="dialog-summary" class="dialog-summary"></div><div id="dialog-facilities" class="dialog-facilities"></div></dialog><div id="tip" class="tip" role="tooltip"></div>
<script>window.SLOT_DATA=__SLOT_DATA__;window.ZIP_PATHS=__ZIP_PATHS__;window.FLORIDA_OUTLINE=__OUTLINE__;
__DATE_CLIENT__
__RADIUS_CLIENT__
__SCORING_CLIENT__
__CLIENT__</script></body></html>`;

function main() { const result = writeOpportunities(); console.log(`wrote public/market-opportunities.html — ${(result.bytes / 1e6).toFixed(2)} MB dashboard`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
