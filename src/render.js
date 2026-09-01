// Build the self-contained provider-map.html. County layer (complete, all 67 FL
// counties, default) + ZIP layer (detail) as inline SVG paths via a server-side
// Albers projection, with counts + rosters embedded and a client that
// colors/filters/zooms/inspects. Offline, no dependencies.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { SUITE_NAV_STYLES, suiteNavigation } from "./shared/suite-navigation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1000, H = 940, PAD = 12;

function albersFactory() {
  const rad = Math.PI / 180, lat1 = 24, lat2 = 31.5, lat0 = 27.6, lon0 = -84;
  const n = 0.5 * (Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  const C = Math.cos(lat1 * rad) ** 2 + 2 * n * Math.sin(lat1 * rad);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * rad)) / n;
  return (lon, lat) => {
    const theta = n * ((lon - lon0) * rad);
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * rad)) / n;
    return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
  };
}
function eachRing(geometry, fn) {
  if (!geometry) return;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const ring of poly) fn(ring);
}
function computeFit(features) {
  const project = albersFactory();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) eachRing(f.geometry, (ring) => {
    for (const [lon, lat] of ring) { const [x, y] = project(lon, lat); if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  });
  const s = Math.min((W - 2 * PAD) / (maxX - minX), (H - 2 * PAD) / (maxY - minY));
  const ox = PAD + ((W - 2 * PAD) - s * (maxX - minX)) / 2;
  const oy = PAD + ((H - 2 * PAD) - s * (maxY - minY)) / 2;
  return { project, tx: (x) => (ox + s * (x - minX)).toFixed(1), ty: (y) => (oy + s * (maxY - y)).toFixed(1) };
}
function geomToD(geometry, fit) {
  let d = "";
  eachRing(geometry, (ring) => {
    d += "M";
    for (let i = 0; i < ring.length; i += 1) { const [x, y] = fit.project(ring[i][0], ring[i][1]); d += `${i ? "L" : ""}${fit.tx(x)} ${fit.ty(y)}`; }
    d += "Z";
  });
  return d;
}
export function escapeScriptJson(value) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(LS, "\\u2028")
    .replaceAll(PS, "\\u2029");
}
export function providerAvailabilityTotals(data, specialty = "") {
  if (specialty) {
    const counts = data?.specialties?.find((item) => item.name === specialty);
    if (counts && (counts.ahLocations !== undefined || counts.ohLocations !== undefined)) {
      return { ah: Number(counts.ahLocations ?? 0), oh: Number(counts.ohLocations ?? 0) };
    }
  } else if (data?.locationTotals) {
    return { ah: Number(data.locationTotals.ah ?? 0), oh: Number(data.locationTotals.oh ?? 0) };
  }
  // Backward-compatible fallback for an older generated dataset.
  const totals = { ah: 0, oh: 0 };
  for (const area of Object.values(data?.zips ?? {})) {
    if (specialty) {
      const counts = area.spec?.[specialty];
      totals.ah += Number(counts?.a ?? 0);
      totals.oh += Number(counts?.o ?? 0);
    } else {
      totals.ah += Number(area.ah ?? 0);
      totals.oh += Number(area.oh ?? 0);
    }
  }
  return totals;
}
export function providerHeadline(data, { locationMode = "all", gran = "zip", specialty = "" } = {}) {
  if (locationMode === "all") {
    return {
      ...providerAvailabilityTotals(data, specialty),
      title: "Total providers available",
      scope: "published locations",
    };
  }
  const counts = specialty
    ? data?.specialties?.find((item) => item.name === specialty)
    : data?.totals;
  return {
    ah: Number(counts?.ah ?? 0),
    oh: Number(counts?.oh ?? 0),
    title: "Distinct providers",
    scope: specialty ? "in specialty" : "statewide",
  };
}
export function dragExceededThreshold(dx, dy, threshold = 5) {
  return Math.hypot(dx, dy) > threshold;
}
// ── Data contract ───────────────────────────────────────────────────────────
// Everything under data/ that isn't geometry comes from the data pipeline.
// Whatever gets built to replace it has to emit exactly these shapes:
//
//   providers-by-zip.json / providers-by-county.json
//     default all-published-location footprint, keyed by ZIP5 / county
//   providers-by-zip-primary.json / providers-by-county-primary.json
//     same shape, reduced to one primary or first-published location per person
//     { generatedAt, source, locationMode: "all"|"primary",
//       systems:     { ah: "AdventHealth", oh: "Orlando Health" },
//       totals:      { ah: <int>, oh: <int>, note? },   // statewide, distinct
//       specialties: [ { name, label, ah, oh } ],
//       zips:        { <key>: { ah, oh, spec: { <SPECIALTY>: { a, o } } } } }
//     `zips` is the property name in BOTH files, the county one included.
//
//   roster.json / roster-county.json and their *-primary counterparts
//     { <key>: [ { i: id, n: name, s: SPECIALTY, y: "ah"|"oh",
//                  cr: credential, ph: photo URL, u: profile URL,
//                  l: [ { n: location, a: address, c: city, z: ZIP5 } ] } ] }
//
//   zip-county.json     { <zip5>: "<County Name>" }   — census geography, already built
//
// Join keys that must line up exactly: specialties[].name === the keys of
// zips[].spec === roster[].s. The specialty filter matches on that raw string;
// `label` is display-only.
const EMPTY_DATA = { systems: { ah: "AdventHealth", oh: "Orlando Health" }, totals: { ah: 0, oh: 0 }, specialties: [], zips: {} };
// Geometry passes no fallback — it must exist. The provider files may not yet,
// and the page renders an honest empty state without them: grey map, 0 totals.
const readJson = (rel, fallback) => {
  try { return JSON.parse(readFileSync(join(ROOT, rel), "utf8")); }
  catch (e) { if (fallback !== undefined && e.code === "ENOENT") return fallback; throw e; }
};

export function render() {
  const countyGeo = readJson("data/fl-county.geojson");
  const zipGeo = readJson("data/fl-zcta.geojson");
  const cData = readJson("data/providers-by-county.json", EMPTY_DATA);
  const zData = readJson("data/providers-by-zip.json", EMPTY_DATA);
  const cRoster = readJson("data/roster-county.json", {});
  const zRoster = readJson("data/roster.json", {});
  const cDataPrimary = readJson("data/providers-by-county-primary.json", cData);
  const zDataPrimary = readJson("data/providers-by-zip-primary.json", zData);
  const cRosterPrimary = readJson("data/roster-county-primary.json", cRoster);
  const zRosterPrimary = readJson("data/roster-primary.json", zRoster);
  const cty = readJson("data/zip-county.json");
  // One clean FL coast outline (dissolved counties -> outer rings). ZIPs are
  // clipped to this same boundary at build time, so it traces both layers exactly
  // and has no interior excursion around the no-ZIP lake/Everglades regions.
  const countyOutline = readJson("data/fl-county-outline.geojson");

  // Brand logos embedded as base64 data-URI CSS vars (self-contained, offline).
  const readB64 = (rel) => { try { return readFileSync(join(ROOT, rel)).toString("base64"); } catch { return null; } };
  const ahLogo = readB64("assets/adventhealth-logo.png"), ohLogo = readB64("assets/orlandohealth-logo.png");
  // Webfonts embedded as base64 so the page renders identically offline and on
  // any machine (see scripts/embed-fonts.mjs). Without this, JetBrains Mono is
  // fetched from Google at load time and silently falls back elsewhere.
  let fontsCss = ""; try { fontsCss = readFileSync(join(ROOT, "data", "fonts.css"), "utf8"); } catch { /* optional */ }

  const logoVars = `:root{${ahLogo ? `--ah-logo-img:url(data:image/png;base64,${ahLogo});` : ""}${ohLogo ? `--oh-logo-img:url(data:image/png;base64,${ohLogo});` : ""}}`;

  const fit = computeFit(countyGeo.features); // frame the whole state
  const cPaths = countyGeo.features.map((f) => ({ k: f.properties.name, d: geomToD(f.geometry, fit) }));
  const zPaths = zipGeo.features.map((f) => ({ k: f.properties.zip, d: geomToD(f.geometry, fit) }));
  const outlineD = (g) => (g.geometries ?? (g.features ?? []).map((f) => f.geometry)).map((gm) => geomToD(gm, fit)).join("");
  const outlines = { county: outlineD(countyOutline) };

  const html = PAGE
    .replace("__CPATHS__", escapeScriptJson(cPaths))
    .replace("__ZPATHS__", escapeScriptJson(zPaths))
    .replace("__CDATA__", escapeScriptJson(cData))
    .replace("__ZDATA__", escapeScriptJson(zData))
    .replace("__CROSTER__", escapeScriptJson(cRoster))
    .replace("__ZROSTER__", escapeScriptJson(zRoster))
    .replace("__CDATA_PRIMARY__", escapeScriptJson(cDataPrimary))
    .replace("__ZDATA_PRIMARY__", escapeScriptJson(zDataPrimary))
    .replace("__CROSTER_PRIMARY__", escapeScriptJson(cRosterPrimary))
    .replace("__ZROSTER_PRIMARY__", escapeScriptJson(zRosterPrimary))
    .replace("__CTY__", escapeScriptJson(cty))
    .replace("__OUTLINES__", escapeScriptJson(outlines))
    .replace("__HEADLINE_FUNCTIONS__", `${providerAvailabilityTotals.toString()}\n${providerHeadline.toString()}`)
    .replace("__DRAG_THRESHOLD_FUNCTION__", dragExceededThreshold.toString())
    .replace("__LOGOVARS__", logoVars)
    .replace("__FONTS__", fontsCss)
    .replace("__VIEWBOX__", `0 0 ${W} ${H}`)
    .replaceAll("__W__", String(W)).replaceAll("__H__", String(H));
  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeFileSync(join(ROOT, "public", "provider-map.html"), html);
  return { counties: cPaths.length, zips: zPaths.length, bytes: html.length };
}

const PAGE = String.raw`<meta charset="utf-8">
<title>Florida Provider Map</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23005C99'/%3E%3Crect y='12' width='16' height='4' fill='%231FA9E1'/%3E%3C/svg%3E">
<style>
__FONTS__
:root{--navy:#14233e;--cream:#f5f1e8;--cream-90:#eee9dc;--cream-70:#d4cdb8;
--chrome:#005c99;--accent:#1fa9e1;--accent-deep:#1276b5;--accent-tint:rgba(31,169,225,.12);--accent-band:#a5d8f3;
--ink:#14233e;--mute:#41506c;--faint:#63748c;--ah:#005c99;--oh:#b20838;--nodata:#e6e2dc;
--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--display:"Helvetica Neue","Inter",Helvetica,Arial,system-ui,sans-serif;}
*,*::before,*::after{border-radius:0!important;box-shadow:none!important;box-sizing:border-box}
.pill{border-radius:999px!important}
*{margin:0}
html{height:100%;overflow:hidden}
body{background:var(--cream);color:var(--ink);font-family:var(--display);font-size:15px;line-height:1.5;height:100vh;height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.mono{font-family:var(--mono)}
.hdr{background:var(--chrome);border-bottom:1px solid rgba(245,241,232,.14);flex:none}
.hdr-in{max-width:1440px;margin:0 auto;min-height:60px;padding:11px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand-box{display:inline-flex;align-items:center;justify-content:center;background:#fff;border:3px solid #000;padding:8px 16px}
.mark{font-family:var(--mono);font-size:19px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--navy);white-space:nowrap}
.mark b{color:var(--accent);font-weight:700}
${SUITE_NAV_STYLES}
.wrap{max-width:1440px;width:100%;margin:0 auto;padding:14px 22px 16px;flex:1;min-height:0;display:flex;flex-direction:column}
.card,.panel{background:#fff;border:3px solid #000}
.cap{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
.totbox{display:flex;flex-direction:column}
.trow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.tlogo{display:inline-block;width:120px;height:26px;background-repeat:no-repeat;background-position:left center;background-size:contain}
.tlogo.ah{background-image:var(--ah-logo-img)}.tlogo.oh{background-image:var(--oh-logo-img)}
.tnum{font-weight:700;font-size:30px;line-height:1;font-variant-numeric:tabular-nums}
.tnum.ah{color:var(--ah)}.tnum.oh{color:var(--oh)}
.tsub{font-family:var(--mono);font-size:11px;color:var(--faint);margin-top:4px;letter-spacing:.02em}
.tdiv{height:2px;background:#000;margin:8px 0}
.map-key{display:grid;grid-template-columns:repeat(3,max-content);align-items:center;justify-content:space-between;column-gap:4px;white-space:nowrap;border-top:1px solid var(--cream-90);margin-top:7px;padding-top:6px;font-family:var(--mono);font-size:10px;font-weight:700;line-height:1.1;color:var(--faint);letter-spacing:.01em}
.map-key-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.map-key-item[hidden]{display:none}
.map-key-swatch{display:inline-block;width:16px;height:7px;border:1px solid rgba(0,0,0,.3);flex:none}
.map-key-item.ah .map-key-swatch{background:linear-gradient(90deg,#cfe0ee,#00436f)}
.map-key-item.oh .map-key-swatch{background:linear-gradient(90deg,#f1d2da,#83091f)}
.map-key-item.tie .map-key-swatch{background:repeating-linear-gradient(135deg,#b3284e 0 3px,#1a6ba3 3px 6px)}
.stage{display:grid;grid-template-columns:minmax(0,1fr) clamp(320px,29vw,372px);gap:16px;flex:1;min-height:0}
.panel-band{background:var(--chrome);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;flex:none}
.panel-band h2{font-family:var(--mono);font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--cream);min-width:0}
.band-meta{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.03em;color:var(--accent-band);white-space:nowrap;font-variant-numeric:tabular-nums}
.controls{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:6px 8px;border-bottom:2px solid #000}
.controls .spacer{flex:1 1 0;min-width:0}
.pill-group{display:inline-flex;gap:2px;flex:none}
.filter-pill{padding:4px 6px;border:2px solid #000;background:#fff;color:var(--mute);font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.035em;text-transform:uppercase;cursor:pointer;transition:background .15s,color .15s}
.filter-pill:hover{color:var(--ink);background:var(--accent-tint)}
.filter-pill[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--navy)}
.location-help{position:relative;display:inline-flex;align-items:center;margin-left:2px;flex:none}
.location-info{display:inline-grid;place-items:center;width:16px;height:16px;padding:0;border:1.5px solid #000;border-radius:50%!important;background:#fff;color:var(--mute);font-family:var(--mono);font-size:9px;font-weight:800;line-height:1;cursor:help}
.location-info:hover,.location-info:focus-visible{background:var(--accent-tint);color:var(--ink)}
.location-tip{position:absolute;z-index:30;top:calc(100% + 7px);right:0;width:250px;max-width:calc(100vw - 32px);padding:8px 9px;border:2px solid #000;background:#fff;color:var(--ink);font-family:var(--display);font-size:11px;font-weight:500;line-height:1.35;letter-spacing:0;text-transform:none;white-space:normal;opacity:0;visibility:hidden;pointer-events:none}
.location-help:hover .location-tip,.location-help:focus-within .location-tip{opacity:1;visibility:visible}
.logo-pill{padding:2px 6px}
.logo-pill[aria-pressed="true"]{background:var(--accent-tint);border-color:#000}
.pill-logo{display:block;width:52px;height:16px;background-repeat:no-repeat;background-position:center;background-size:contain}
.pill-logo.ah{background-image:var(--ah-logo-img)}
.pill-logo.oh{background-image:var(--oh-logo-img)}
select.control{border:2px solid #000;background:#fff;padding:4px 6px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.01em;color:var(--ink);cursor:pointer;width:104px;max-width:104px;text-overflow:ellipsis;overflow:hidden}
.fgroup{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;flex:none}
.mapbox{display:flex;flex-direction:column;overflow:hidden;min-width:0;min-height:0;container-type:inline-size}
@container (min-width:680px) and (max-width:819px){.controls{flex-wrap:nowrap}.controls>.cap,.fgroup>.cap{display:none}}
@container (min-width:820px){.controls{flex-wrap:nowrap}}
.mapwrap{position:relative;flex:1;min-height:0;overflow:hidden;background:#c6d3dc;contain:layout paint}
svg{display:block;position:relative;z-index:0;width:100%;height:100%;cursor:grab}svg.drag{cursor:grabbing}
#map-raster{position:absolute;z-index:1;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;transform-origin:0 0}
svg.zooming path.z,svg.drag path.z{pointer-events:none;transition:none;shape-rendering:optimizeSpeed}
#land{fill:#e6e2dc;stroke:#cdd8df;stroke-width:.6;vector-effect:non-scaling-stroke}
#coast{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none;stroke-linejoin:round}
path.z{vector-effect:non-scaling-stroke;stroke:#000;transition:fill .4s ease,fill-opacity .45s ease}
#lay-zip path.z{stroke-width:.4}
#lay-county path.z{stroke-width:.9}
.g-zip #lay-county{display:none}
.g-county #lay-zip{display:none}
@keyframes drawin{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
.lay.draw path.z{fill-opacity:0;stroke-dasharray:1;stroke-dashoffset:1;animation:drawin .5s ease forwards;transition:none}
#lay-zip path.z:hover,#lay-county path.z:hover{stroke:#000;stroke-width:1.8}
#lay-zip path.z.sel,#lay-county path.z.sel{stroke:#000;stroke-width:2.8}
.zoomctl{position:absolute;z-index:3;left:12px;bottom:12px;display:flex;flex-direction:column;border:2px solid #000;background:#fff}
.zoomctl button{width:30px;height:30px;border:0;background:#fff;font-size:17px;cursor:pointer;color:var(--chrome);font-family:var(--mono)}
.zoomctl button+button{border-top:2px solid #000}.zoomctl button:hover{background:var(--accent-tint)}
.hint{position:absolute;z-index:3;right:12px;bottom:12px;font-family:var(--mono);font-size:10.5px;letter-spacing:.02em;color:var(--mute);background:rgba(245,241,232,.93);border:1px solid #000;padding:3px 7px}
.side{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;overflow:hidden}
.cbody{padding:12px 14px}
.tpanel .panel-band{padding:5px 10px;gap:5px;flex-wrap:nowrap}
.tpanel .panel-band h2{font-size:11.5px;letter-spacing:.055em;white-space:nowrap}
.tpanel .panel-band .band-meta{margin-left:auto;font-size:9px;letter-spacing:.01em;line-height:1.2}
.tpanel .cbody{padding:8px 14px}
.ppanel{flex:1;min-height:120px;display:flex;flex-direction:column}
.pscroll{position:relative;overflow:auto;padding:0 14px 12px;flex:1;min-height:0}
.phead{border-bottom:2px solid #000;padding:11px 0 8px;margin-bottom:8px;position:sticky;top:0;z-index:3;isolation:isolate;background:#fff}
.phead .pz{font-family:var(--mono);font-weight:700;font-size:16.5px;letter-spacing:.03em;color:var(--navy)}.phead .pcty{font-weight:400;font-size:13px;color:var(--mute);font-family:var(--display);letter-spacing:0}
.phead .pcount{font-family:var(--mono);font-size:13px;margin-top:5px;letter-spacing:.02em}.phead .pcount .ah{color:var(--ah);font-weight:700}.phead .pcount .oh{color:var(--oh);font-weight:700}
.prov{display:flex;gap:9px;padding:10px 0;border-bottom:1px solid var(--cream-90);align-items:flex-start}
.prov .dot{width:7px;height:7px;margin-top:6px;flex:none}.dot.ah{background:var(--ah)}.dot.oh{background:var(--oh)}
.pavatar{position:relative;width:46px;height:54px;flex:none;border:2px solid var(--navy);background:var(--cream-90);overflow:hidden;contain:paint}
.pavatar.ah{border-color:var(--ah)}.pavatar.oh{border-color:var(--oh)}
.pinitials{position:absolute;inset:0;display:grid;place-items:center;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--mute)}
.pimg{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;background:#fff}
.pdetail{min-width:0;flex:1}.prov .pn{font-weight:600;font-size:14px;color:var(--ink);text-decoration:none}.prov a.pn:hover{text-decoration:underline}
.prov .ps{font-size:12.5px;color:var(--mute);margin-top:1px}.plocs{margin-top:4px}.ploc+.ploc{margin-top:5px}
.prov .pln{font-size:11.5px;font-weight:600;color:var(--mute);line-height:1.3}.prov .pa{font-family:var(--mono);font-size:10.5px;color:var(--faint);line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}
.empty,.prompt{color:var(--mute);font-size:13px;padding:12px 0}
#tip{position:fixed;pointer-events:none;background:var(--chrome);color:var(--cream);border:2px solid #000;padding:8px 10px;font-size:12px;line-height:1.35;opacity:0;transition:opacity .07s;z-index:20;max-width:240px;font-family:var(--mono)}
#tip .zh{font-weight:700}#tip .cty{color:var(--accent-band);font-size:11px}
#tip .r{display:flex;justify-content:space-between;gap:14px;margin-top:3px}#tip .r .ah{color:#8fc7ea}#tip .r .oh{color:#f0899f}
#tip .lead{margin-top:4px;font-size:11px;color:var(--accent-band)}
a{color:var(--accent-deep)}
@media (prefers-reduced-motion:reduce){path.z{transition:none}}
/* Short desktop windows stay one-screen by compacting chrome and side cards. */
@media (min-width:881px) and (max-height:680px){
 .hdr-in{min-height:52px;padding:6px 18px}
 .brand-box{padding:5px 12px}
 .mark{font-size:16px}
 .wrap{padding:8px 16px 10px}
 .stage{grid-template-columns:minmax(0,1fr) clamp(320px,27vw,350px);gap:12px}
 .panel-band{padding:5px 12px}.panel-band h2{font-size:12px}.band-meta{font-size:10.5px}
 .controls{gap:4px;padding:5px 8px}
 .filter-pill{padding:4px 6px;font-size:9.5px}.logo-pill{padding:2px 6px}.pill-logo{width:52px;height:16px}
 select.control{padding:4px 6px;font-size:9.5px;width:104px;max-width:104px}
 .side{gap:8px}
 .tpanel .panel-band{padding:5px 10px}
 .tpanel .cbody{padding:6px 12px}.tlogo{width:108px;height:22px}.tnum{font-size:26px}.tdiv{margin:6px 0}.map-key{font-size:9.5px;margin-top:5px;padding-top:5px}
 .ppanel{min-height:100px}
 .hint{right:8px;bottom:8px;font-size:9.5px}
}
/* Narrow or very short windows stack vertically and fit every card to the width. */
@media (max-width:880px),(max-height:520px){
 html{height:auto;min-height:100%;overflow:auto}
 body{height:auto;min-height:100vh;min-height:100dvh;display:block;overflow:visible}
 .wrap{height:auto;display:block;padding:12px}
 .stage{display:block;min-height:0}
 .mapbox{height:auto;margin-bottom:12px}
 .mapwrap{flex:none;height:clamp(320px,min(58vh,72vw),620px);min-height:0}
 .side{gap:10px;overflow:visible}
 .ppanel{flex:none;height:clamp(420px,64vh,720px);min-height:420px;max-height:none}
}
@media (max-width:480px){
 .hdr-in{padding:8px 10px}
 .brand-box{width:100%;justify-content:center;padding:6px 10px}
 .mark{font-size:16px}
 .wrap{padding:10px}
 .controls{gap:6px;padding:8px 10px}
 .filter-pill{padding:6px 10px;font-size:10.5px}.logo-pill{padding:3px 9px}.pill-logo{width:70px;height:19px}
 .fgroup{width:100%;justify-content:space-between}.fgroup select.control{flex:1;width:auto;max-width:none}
}
@media (max-width:340px){
 .tpanel .panel-band{padding-inline:7px;gap:3px}
 .tpanel .panel-band h2{font-size:10px;letter-spacing:.035em}
 .tpanel .panel-band .band-meta{font-size:8px}
}
__LOGOVARS__
</style>
<header class="hdr"><div class="hdr-in">
 <div class="brand-box"><span class="mark">Provider<b> Map</b></span></div>
 ${suiteNavigation("provider-map")}
</div></header>
<div class="wrap">
<div class="stage">
 <section class="panel mapbox">
  <div class="panel-band"><h2 class="mono" id="mapband">Providers per ZIP code</h2><span class="band-meta" id="mapmeta">All specialties</span></div>
  <div class="controls">
   <span class="cap">Area</span>
   <span class="pill-group" role="group" aria-label="granularity"><button id="g-zip" class="filter-pill pill" aria-pressed="true">ZIP codes</button><button id="g-county" class="filter-pill pill" aria-pressed="false">Counties</button></span>
   <span class="cap" id="leadcap">Lead</span>
   <span class="pill-group" role="group" aria-label="view"><button id="v-diff" class="filter-pill pill" aria-pressed="true">Difference</button><button id="v-ah" class="filter-pill pill logo-pill" aria-pressed="false" title="AdventHealth"><span class="pill-logo ah" aria-label="AdventHealth"></span></button><button id="v-oh" class="filter-pill pill logo-pill" aria-pressed="false" title="Orlando Health"><span class="pill-logo oh" aria-label="Orlando Health"></span></button></span>
   <span class="cap">Locations</span>
   <span class="pill-group" role="group" aria-label="provider locations"><button id="m-all" class="filter-pill pill" aria-pressed="true">All locations</button><button id="m-primary" class="filter-pill pill" aria-pressed="false">Primary only</button><span class="location-help"><button id="primary-location-info" class="location-info" type="button" aria-label="About Primary Only" aria-describedby="primary-location-note">i</button><span id="primary-location-note" class="location-tip" role="tooltip">Some providers work at multiple locations. Switch to Primary Only to show each provider only at their main location.</span></span></span>
   <span class="spacer"></span>
   <span class="fgroup"><label class="cap" for="spec">Specialty</label><select id="spec" class="control" aria-label="Specialty"></select></span>
  </div>
  <div class="mapwrap">
   <svg viewBox="__VIEWBOX__" id="map" class="g-zip" aria-label="Florida provider map"><defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="#c6d3dc"></rect><path d="M25 0H0V25" fill="none" stroke="#a6bac8" stroke-width="1"></path></pattern><pattern id="tie-stripes" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#b3284e"></rect><rect x="4" width="4" height="8" fill="#1a6ba3"></rect></pattern></defs><rect id="sea" x="-3000" y="-3000" width="7000" height="7000" fill="url(#grid)"></rect><g id="vp"></g></svg>
   <canvas id="map-raster" width="__W__" height="__H__" aria-hidden="true"></canvas>
   <div class="zoomctl"><button id="zin" title="Zoom in">+</button><button id="zout" title="Zoom out">&minus;</button><button id="zreset" title="Reset" style="font-size:12px">&#8634;</button></div>
   <div class="hint">Scroll to zoom &middot; drag to pan &middot; click for providers</div>
  </div>
 </section>
 <div class="side">
  <section class="panel tpanel">
   <div class="panel-band"><h2 class="mono" id="tot-title">Total providers available</h2><span class="band-meta" id="tot-scope">ZIP areas</span></div>
   <div class="cbody totbox">
    <div class="trow"><span class="tlogo ah" role="img" aria-label="AdventHealth"></span><span class="tnum ah" id="tot-ah">0</span></div>
    <div class="tdiv"></div>
    <div class="trow"><span class="tlogo oh" role="img" aria-label="Orlando Health"></span><span class="tnum oh" id="tot-oh">0</span></div>
    <div class="map-key" id="map-key" aria-label="Map color key">
     <span class="map-key-item oh" id="key-oh"><i class="map-key-swatch" aria-hidden="true"></i><span id="key-oh-label">Orlando Health</span></span>
     <span class="map-key-item tie" id="key-tie"><i class="map-key-swatch" aria-hidden="true"></i><span>Equal</span></span>
     <span class="map-key-item ah" id="key-ah"><i class="map-key-swatch" aria-hidden="true"></i><span id="key-ah-label">AdventHealth</span></span>
    </div>
   </div>
  </section>
  <section class="panel ppanel">
   <div class="panel-band"><h2 class="mono">Providers</h2></div>
   <div id="panel" class="pscroll"><div class="prompt">Click a ZIP (or switch to counties) to list its AdventHealth and Orlando Health providers.</div></div>
  </section>
 </div>
</div>
</div>
<div id="tip"></div>
<script id="cpaths" type="application/json">__CPATHS__</script>
<script id="zpaths" type="application/json">__ZPATHS__</script>
<script id="cdata" type="application/json">__CDATA__</script>
<script id="zdata" type="application/json">__ZDATA__</script>
<script id="croster" type="application/json">__CROSTER__</script>
<script id="zroster" type="application/json">__ZROSTER__</script>
<script id="cdata-primary" type="application/json">__CDATA_PRIMARY__</script>
<script id="zdata-primary" type="application/json">__ZDATA_PRIMARY__</script>
<script id="croster-primary" type="application/json">__CROSTER_PRIMARY__</script>
<script id="zroster-primary" type="application/json">__ZROSTER_PRIMARY__</script>
<script id="cty" type="application/json">__CTY__</script>
<script id="outlines" type="application/json">__OUTLINES__</script>
<script>
const W=__W__, H=__H__;
const J=(id)=>JSON.parse(document.getElementById(id).textContent);
const PATHS={county:J("cpaths"),zip:J("zpaths")};
const DATASETS={
 all:{
  county:{paths:PATHS.county,data:J("cdata"),roster:J("croster"),unit:"county"},
  zip:{paths:PATHS.zip,data:J("zdata"),roster:J("zroster"),unit:"ZIP"},
 },
 primary:{
  county:{paths:PATHS.county,data:J("cdata-primary"),roster:J("croster-primary"),unit:"county"},
  zip:{paths:PATHS.zip,data:J("zdata-primary"),roster:J("zroster-primary"),unit:"ZIP"},
 },
};
__HEADLINE_FUNCTIONS__
__DRAG_THRESHOLD_FUNCTION__
const CTY=J("cty"), OUTLINES=J("outlines");
const NAVY=["#cfe0ee","#8dbcdb","#4c92c3","#1a6ba3","#00436f"];
const RED=["#f1d2da","#e199ab","#cf5a79","#b3284e","#83091f"];
const NODATA="#e6e2dc";
const TIE_FILL="url(#tie-stripes)";
const REDUCE=matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE="cubic-bezier(.16,1,.3,1)";
function slideY(el){if(!REDUCE&&el&&el.animate)el.animate([{opacity:0,transform:"translateY(8px)"},{opacity:1,transform:"none"}],{duration:300,easing:EASE});}
function fade(el){if(!REDUCE&&el&&el.animate)el.animate([{opacity:0},{opacity:1}],{duration:240,easing:EASE});}
// Which systems are in this build is read off the data, not hard-coded: a
// single-system build hides the comparison chrome (the diverging view, the
// other total, the other toggle) and the whole page reads as that system's map.
// Restoring the second system's data restores the UI with it, no edit here.
const SYS=DATASETS.all.zip.data.systems;
const ACTIVE=["ah","oh"].filter(k=>DATASETS.all.zip.data.totals[k]>0);
const SOLO=ACTIVE.length===1?ACTIVE[0]:null;
let gran="zip", locationMode="all", view=SOLO??"diff", specialty="", selected=null;
const L=()=>DATASETS[locationMode][gran];
const tc=(s)=>String(s||"").toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase());
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const initials=(s)=>String(s||"").trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();

function val(k){const e=L().data.zips[k]; if(!e) return null;
 if(!specialty) return {ah:e.ah,oh:e.oh};
 const s=e.spec[specialty]; return s?{ah:s.a,oh:s.o}:{ah:0,oh:0};}
function quantiles(arr,n){const a=arr.filter(x=>x>0).sort((x,y)=>x-y); if(!a.length) return [];
 const q=[]; for(let i=1;i<n;i++) q.push(a[Math.floor(i/n*a.length)]); return q;}
function bin(v,thr){let i=0; while(i<thr.length&&v>=thr[i]) i++; return i;}
function colorFor(k,thr){const v=val(k); if(!v||(v.ah===0&&v.oh===0)) return NODATA;
 if(view==="ah") return v.ah===0?NODATA:NAVY[bin(v.ah,thr.ah)];
 if(view==="oh") return v.oh===0?NODATA:RED[bin(v.oh,thr.oh)];
 const d=v.ah-v.oh; if(d===0) return TIE_FILL;
 return d>0?NAVY[bin(d,thr.diff)]:RED[bin(-d,thr.diff)];}
function scales(){const zs=L().paths.map(p=>val(p.k)).filter(Boolean);
 return {ah:quantiles(zs.map(v=>v.ah),5),oh:quantiles(zs.map(v=>v.oh),5),diff:quantiles(zs.map(v=>Math.abs(v.ah-v.oh)),5)};}
function paint(){const thr=scales();
 document.querySelectorAll("#lay-"+gran+" path.z").forEach(p=>p.setAttribute("fill",colorFor(p.getAttribute("data-k"),thr)));
 totals(); updateColorKey(); updateMapLabels(); queueRaster();}
function setNum(id,val){const el=document.getElementById(id);if(!el)return;const s=val.toLocaleString();const ch=el.textContent!==s;el.textContent=s;if(ch)slideY(el);}
function totals(){const headline=providerHeadline(L().data,{locationMode,gran,specialty});
 setNum("tot-ah",headline.ah); setNum("tot-oh",headline.oh);
 document.getElementById("tot-title").textContent=headline.title;
 document.getElementById("tot-scope").textContent=headline.scope;}
function updateColorKey(){const ah=document.getElementById("key-ah"),oh=document.getElementById("key-oh"),tie=document.getElementById("key-tie");
 if(view==="diff"){
  ah.hidden=!ACTIVE.includes("ah");oh.hidden=!ACTIVE.includes("oh");tie.hidden=false;
  document.getElementById("key-ah-label").textContent="AdventHealth";
  document.getElementById("key-oh-label").textContent="Orlando Health";
  document.getElementById("map-key").setAttribute("aria-label","Redder areas favor Orlando Health; red and blue striped areas are equal; bluer areas favor AdventHealth");
 }else{
  const isAh=view==="ah";ah.hidden=!isAh;oh.hidden=isAh;tie.hidden=true;
  document.getElementById(isAh?"key-ah-label":"key-oh-label").textContent=isAh?"Darker blue: more AdventHealth":"Darker red: more Orlando Health";
  document.getElementById("map-key").setAttribute("aria-label",isAh?"Darker blue means more AdventHealth providers":"Darker red means more Orlando Health providers");
 }}
function updateMapLabels(){const s=specialty?(L().data.specialties.find(x=>x.name===specialty)||{}).label||specialty:"All specialties";
 const per=gran==="zip"?"ZIP code":"county";
 const mode=locationMode==="all"?"all published locations":"primary location only";
 document.getElementById("mapband").textContent="Providers per "+per;
 document.getElementById("mapmeta").textContent=s+" · "+mode;}

function showProviders(k){selected=k;
 document.querySelectorAll("path.z.sel").forEach(p=>p.classList.remove("sel"));
 const pel=document.querySelector('#lay-'+gran+' path.z[data-k="'+cssq(k)+'"]'); if(pel)pel.classList.add("sel");
 queueRaster();
 let list=(L().roster[k]||[]).slice(); if(specialty) list=list.filter(x=>x.s===specialty);
 if(view!=="diff") list=list.filter(x=>x.y===view);
 const counts=val(k)||{ah:0,oh:0};
 const label=gran==="county"?(esc(k)+" County"):(esc(k)+' <span class="pcty">'+(CTY[k]?esc(CTY[k])+" County":"")+'</span>');
 const head='<div class="phead"><div class="pz">'+label+'</div><div class="pcount">'+VISIBLE_SYSTEMS().map(k=>'<span class="'+k+'">'+SYS[k]+' '+counts[k]+'</span>').join(" &middot; ")+'</div></div>';
 const body=list.length?list.map(x=>{
  const name=esc(x.n)+(x.cr?', '+esc(x.cr):'');
  const nameEl=x.u?'<a class="pn" href="'+esc(x.u)+'" target="_blank" rel="noreferrer">'+name+'</a>':'<div class="pn">'+name+'</div>';
  const photo=x.ph?'<img class="pimg" src="'+esc(x.ph)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'';
  const locs=(x.l||[]).map(l=>{const address=[l.a,l.c,l.z].filter(Boolean).map(esc).join(", ");return '<div class="ploc">'+(l.n?'<div class="pln">'+esc(l.n)+'</div>':'')+(address?'<div class="pa">'+address+'</div>':'')+'</div>';}).join("");
  return '<div class="prov"><span class="dot '+x.y+'"></span><div class="pavatar '+x.y+'"><span class="pinitials">'+esc(initials(x.n))+'</span>'+photo+'</div><div class="pdetail">'+nameEl+'<div class="ps">'+esc(tc(x.s))+'</div>'+(locs?'<div class="plocs">'+locs+'</div>':'')+'</div></div>';
 }).join(""):'<div class="empty">No '+SYSLIST()+(specialty?" providers in this specialty":" providers")+' here.</div>';
 const pn=document.getElementById("panel"); pn.innerHTML=head+body; pn.querySelectorAll("img.pimg").forEach(img=>img.addEventListener("error",()=>img.remove(),{once:true})); pn.scrollTop=0; fade(pn);}
const cssq=(s)=>String(s).replace(/"/g,'\\"');

const svg=document.getElementById("map"), vp=document.getElementById("vp");
const raster=document.getElementById("map-raster"), rctx=raster.getContext("2d",{alpha:true});
const RASTER_OK=!!rctx&&typeof Path2D==="function";
let rasterPaths=null,rasterReady=false,rasterQueued=false,rasterActive=false;
let mapFrame={left:0,top:0,s:1,ox:0,oy:0};
function ensureRasterPaths(){if(rasterPaths||!RASTER_OK)return;
 rasterPaths={
  county:PATHS.county.map(p=>new Path2D(p.d)),
  zip:PATHS.zip.map(p=>new Path2D(p.d)),
  outline:new Path2D(OUTLINES.county),
 };}
function rasterTiePattern(){const tile=document.createElement("canvas");tile.width=8;tile.height=8;const t=tile.getContext("2d");
 t.fillStyle="#b3284e";t.fillRect(0,0,4,8);t.fillStyle="#1a6ba3";t.fillRect(4,0,4,8);
 const pattern=rctx.createPattern(tile,"repeat");if(pattern&&pattern.setTransform&&typeof DOMMatrix==="function")pattern.setTransform(new DOMMatrix().rotate(45));return pattern;}
function drawRaster(){if(!RASTER_OK)return;ensureRasterPaths();
 const dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));raster.width=Math.round(W*dpr);raster.height=Math.round(H*dpr);
 rctx.setTransform(dpr,0,0,dpr,0,0);rctx.clearRect(0,0,W,H);rctx.lineJoin="round";
 rctx.fillStyle=NODATA;rctx.strokeStyle="#cdd8df";rctx.lineWidth=.6;rctx.fill(rasterPaths.outline);rctx.stroke(rasterPaths.outline);
 const nodes=[...document.querySelectorAll("#lay-"+gran+" path.z")],paths=rasterPaths[gran],tie=rasterTiePattern();let selectedPath=null;
 rctx.strokeStyle="#000";rctx.lineWidth=gran==="zip"?.4:.9;
 paths.forEach((path,i)=>{const node=nodes[i],fill=node?node.getAttribute("fill"):NODATA;rctx.fillStyle=fill===TIE_FILL?(tie||NODATA):(fill||NODATA);rctx.fill(path);rctx.stroke(path);if(node&&node.classList.contains("sel"))selectedPath=path;});
 if(selectedPath){rctx.strokeStyle="#000";rctx.lineWidth=2.8;rctx.stroke(selectedPath);}
 rctx.strokeStyle="#000";rctx.lineWidth=2;rctx.stroke(rasterPaths.outline);rasterReady=true;}
function queueRaster(){if(!RASTER_OK)return;rasterReady=false;if(rasterActive)endRasterMotion();if(rasterQueued)return;rasterQueued=true;
 const run=()=>{rasterQueued=false;drawRaster();};if(window.requestIdleCallback)window.requestIdleCallback(run,{timeout:120});else requestAnimationFrame(run);}
function syncMapFrame(){const r=svg.getBoundingClientRect(),s=fitScale(r);mapFrame={left:r.left,top:r.top,s,ox:(r.width-W*s)/2,oy:(r.height-H*s)/2};
 raster.style.left=mapFrame.ox+"px";raster.style.top=mapFrame.oy+"px";raster.style.width=W*s+"px";raster.style.height=H*s+"px";if(rasterActive)applyRasterZoom();}
function applyRasterZoom(){raster.style.transform="translate("+(Z.x*mapFrame.s)+"px,"+(Z.y*mapFrame.s)+"px) scale("+Z.k+")";}
function beginRasterMotion(){svg.classList.add("zooming");if(!rasterReady)return;syncMapFrame();rasterActive=true;raster.style.opacity="1";vp.style.visibility="hidden";applyRasterZoom();}
function endRasterMotion(){vp.setAttribute("transform","translate("+Z.x+" "+Z.y+") scale("+Z.k+")");vp.style.visibility="";
 if(rasterActive){raster.style.opacity="0";rasterActive=false;}svg.classList.remove("zooming");}
const layerHTML=(name)=>PATHS[name].map(p=>'<path class="z" pathLength="1" fill="'+NODATA+'" data-k="'+p.k.replace(/"/g,"&quot;")+'" d="'+p.d+'"></path>').join("");
const VISIBLE_SYSTEMS=()=>view==="diff"?ACTIVE:ACTIVE.filter(k=>k===view);
const SYSLIST=()=>VISIBLE_SYSTEMS().map(k=>SYS[k]).join(" and ");
function resetPanel(){selected=null;const pn=document.getElementById("panel");pn.innerHTML='<div class="prompt">Click a '+L().unit+' to list its '+SYSLIST()+' providers.</div>';fade(pn);}
// BOTH layers are built once and stay in the DOM; the svg class only flips which
// one is visible. The Area switch therefore never re-parses ~1,000 paths mid-
// animation (the old innerHTML swap caused a long main-thread frame = stutter).
function drawLayer(){
 svg.className.baseVal="g-"+gran;
 const OUT=OUTLINES.county;
 vp.innerHTML='<path id="land" d="'+OUT+'"></path><g id="lay-county" class="lay">'+layerHTML("county")+'</g><g id="lay-zip" class="lay">'+layerHTML("zip")+'</g><path id="coast" d="'+OUT+'"></path>';
 resetPanel(); paint();
}
// Cache each layer's path list + west-to-east stagger delays (geometry is static).
function prepDraw(lay){
 if(!lay.__paths){
  lay.__paths=[...lay.querySelectorAll("path.z")];
  let lo=Infinity,hi=-Infinity;
  const xs=lay.__paths.map(p=>{const m=/M(-?[\d.]+)/.exec(p.getAttribute("d"));const x=m?parseFloat(m[1]):0;if(x<lo)lo=x;if(x>hi)hi=x;return x;});
  const span=(hi-lo)||1;
  lay.__delays=xs.map(x=>((x-lo)/span*380).toFixed(1)+"ms");
 }
 lay.__paths.forEach((p,i)=>{p.style.animationDelay=lay.__delays[i];});
 return lay.__paths;
}
// Area toggle: fade the visible borders out, flip visibility, then draw the new
// layer in west-to-east with fills hidden, then flood the colors. The draw class
// is armed while the layer is still display:none, so its animations start exactly
// on reveal; the recolor is deferred one frame so the reveal frame stays light.
// A token + state reset on both groups makes rapid toggling safe.
let switchTok=0, drawTimer=null;
function switchLayer(){
 const newLay=document.getElementById("lay-"+gran);
 const oldLay=document.getElementById(gran==="zip"?"lay-county":"lay-zip");
 if(REDUCE||!newLay.animate){svg.className.baseVal="g-"+gran;resetPanel();paint();return;}
 const tok=++switchTok;
 if(drawTimer){clearTimeout(drawTimer);drawTimer=null;}
 [oldLay,newLay].forEach(g=>{g.classList.remove("draw");g.getAnimations().forEach(a=>a.cancel());g.style.opacity="";});
 oldLay.animate([{opacity:1},{opacity:0}],{duration:150,easing:"ease"}).onfinish=()=>{
  if(tok!==switchTok)return;                   // superseded by a newer toggle
  // Zoomed in we crossfade instead of sweeping. The sweep staggers west-to-east
  // across the whole state, nearly all of which is off-screen at that point, so
  // it reads as noise -- and dashed strokes under a big scale() are what glitch:
  // non-scaling-stroke resolves in screen space while dasharray/pathLength are
  // user-space, so the browser reconciles the two per frame across ~1,000 paths
  // and the borders flicker.
  const zoomed=T.k>1.5, paths=zoomed?null:prepDraw(newLay);
  if(!zoomed)newLay.classList.add("draw");     // arm while hidden: fills transparent, lines undrawn
  svg.className.baseVal="g-"+gran;             // reveal new layer / hide old; draw starts now
  resetPanel();
  requestAnimationFrame(()=>{if(tok===switchTok)paint();}); // colors land next frame, still hidden by .draw
  if(zoomed){newLay.animate([{opacity:0},{opacity:1}],{duration:190,easing:EASE});return;}
  drawTimer=setTimeout(()=>{if(tok!==switchTok)return;newLay.classList.remove("draw");paths.forEach(p=>{p.style.animationDelay="";});drawTimer=null;},900); // reveal colors after lines finish
 };
}
document.getElementById("spec").innerHTML=['<option value="">All specialties</option>'].concat(DATASETS.all.zip.data.specialties.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.label)+' ('+(s.ah+s.oh)+')</option>')).join("");
document.getElementById("spec").onchange=(e)=>{specialty=e.target.value;paint();if(selected)showProviders(selected);};
function setView(v){view=v;["diff","ah","oh"].forEach(x=>{const b=document.getElementById("v-"+x);if(b)b.setAttribute("aria-pressed",String(x===v));});paint();if(selected)showProviders(selected);else resetPanel();}
for(const v of ["diff","ah","oh"]){const b=document.getElementById("v-"+v);if(b)b.onclick=()=>setView(v);}
function setGran(g){if(g===gran)return;gran=g;document.getElementById("g-county").setAttribute("aria-pressed",String(g==="county"));document.getElementById("g-zip").setAttribute("aria-pressed",String(g==="zip"));switchLayer();}
document.getElementById("g-county").onclick=()=>setGran("county");document.getElementById("g-zip").onclick=()=>setGran("zip");
function setLocationMode(mode){if(mode===locationMode)return;locationMode=mode;document.getElementById("m-all").setAttribute("aria-pressed",String(mode==="all"));document.getElementById("m-primary").setAttribute("aria-pressed",String(mode==="primary"));paint();if(selected)showProviders(selected);}
document.getElementById("m-all").onclick=()=>setLocationMode("all");document.getElementById("m-primary").onclick=()=>setLocationMode("primary");

// zoom + pan — Z is what's drawn, T is where we're heading; each frame eases Z
// toward T so wheel/trackpad zoom glides and the +/-/reset buttons animate.
let Z={k:1,x:0,y:0}, T={k:1,x:0,y:0}, raf=null;
function applyZoom(){if(rasterActive)applyRasterZoom();else vp.setAttribute("transform","translate("+Z.x+" "+Z.y+") scale("+Z.k+")");}
function tick(){const a=0.34;
 Z.k+=(T.k-Z.k)*a; Z.x+=(T.x-Z.x)*a; Z.y+=(T.y-Z.y)*a;
 if(Math.abs(T.k-Z.k)<0.0025&&Math.abs(T.x-Z.x)<0.12&&Math.abs(T.y-Z.y)<0.12){Z.k=T.k;Z.x=T.x;Z.y=T.y;raf=null;endRasterMotion();return;}
 applyZoom(); raf=requestAnimationFrame(tick);}
function animate(){if(!raf){beginRasterMotion();raf=requestAnimationFrame(tick);}}
// The svg fits its box with preserveAspectRatio=meet, so the viewBox is scaled
// uniformly and centered (letterboxed). Map screen px -> viewBox coords through
// that same scale/offset, or zoom-to-cursor and pan drift.
function fitScale(r){return Math.min(r.width/W,r.height/H);}
function svgPt(cx,cy){return [(cx-mapFrame.left-mapFrame.ox)/mapFrame.s,(cy-mapFrame.top-mapFrame.oy)/mapFrame.s];}
function zoomAt(mx,my,f){const nk=Math.max(1,Math.min(60,T.k*f)); T.x=mx-(mx-T.x)*(nk/T.k); T.y=my-(my-T.y)*(nk/T.k); T.k=nk; if(T.k<=1.001){T.k=1;T.x=0;T.y=0;} animate();}
svg.addEventListener("wheel",e=>{e.preventDefault();const [mx,my]=svgPt(e.clientX,e.clientY);let dy=e.deltaY;if(e.deltaMode===1)dy*=16;else if(e.deltaMode===2)dy*=100;dy=Math.max(-140,Math.min(140,dy));tip.style.opacity=0;zoomAt(mx,my,Math.exp(-dy*0.0019));},{passive:false});
document.getElementById("zin").onclick=()=>zoomAt(W/2,H/2,1.5);
document.getElementById("zout").onclick=()=>zoomAt(W/2,H/2,1/1.5);
document.getElementById("zreset").onclick=()=>{T={k:1,x:0,y:0};animate();};
let drag=null,moved=false,dragRaf=null,dragEvent=null;
function moveDrag(){dragRaf=null;if(!drag||!dragEvent)return;const e=dragEvent;dragEvent=null;const dx=e.clientX-drag.cx,dy=e.clientY-drag.cy;if(!moved){if(!dragExceededThreshold(dx,dy))return;moved=true;beginRasterMotion();svg.classList.add("drag");}T.x=Z.x=drag.ox+dx/drag.s;T.y=Z.y=drag.oy+dy/drag.s;applyZoom();tip.style.opacity=0;}
svg.addEventListener("mousedown",e=>{if(e.button!==0)return;if(raf){cancelAnimationFrame(raf);raf=null;}Z.k=T.k;Z.x=T.x;Z.y=T.y;endRasterMotion();drag={cx:e.clientX,cy:e.clientY,ox:T.x,oy:T.y,s:mapFrame.s};dragEvent=null;moved=false;});
window.addEventListener("mousemove",e=>{if(!drag)return;dragEvent=e;if(!dragRaf)dragRaf=requestAnimationFrame(moveDrag);});
window.addEventListener("mouseup",()=>{if(!drag)return;if(dragRaf){cancelAnimationFrame(dragRaf);dragRaf=null;moveDrag();}const didMove=moved;drag=null;dragEvent=null;svg.classList.remove("drag");if(didMove)endRasterMotion();});
svg.addEventListener("click",e=>{if(moved)return;const t=e.target.closest("path.z");if(t)showProviders(t.getAttribute("data-k"));});

// hover tooltip
const tip=document.getElementById("tip");
svg.addEventListener("mousemove",(e)=>{if(drag)return;const t=e.target.closest("path.z");if(!t){tip.style.opacity=0;return;}
 const k=t.getAttribute("data-k");const v=val(k);tip.style.opacity=1;tip.style.left=(e.clientX+14)+"px";tip.style.top=(e.clientY+14)+"px";
 const title=gran==="county"?(k+" County"):k;const sub=gran==="zip"&&CTY[k]?CTY[k]+" County":"";
 if(!v||(v.ah===0&&v.oh===0)){tip.innerHTML='<span class="zh">'+title+'</span> <span class="cty">'+sub+'</span><div class="lead">No AdventHealth or Orlando Health providers</div>';return;}
 const lead=v.ah===v.oh?"Even":(v.ah>v.oh?("AdventHealth +"+(v.ah-v.oh)):("Orlando Health +"+(v.oh-v.ah)));
 tip.innerHTML='<span class="zh">'+title+'</span> <span class="cty">'+sub+'</span><div class="r"><span class="ah">AdventHealth</span><b>'+v.ah+'</b></div><div class="r"><span class="oh">Orlando Health</span><b>'+v.oh+'</b></div><div class="lead">'+lead+'</div>';});
svg.addEventListener("mouseleave",()=>{tip.style.opacity=0;});

// Single-system build: strip the comparison chrome. "Lead" and the diverging
// view only mean something with two systems to compare, and a total for a
// system with no data reads as that system having none rather than as absent.
if(SOLO){
 const gone=["v-diff","leadcap"];
 for(const k of ["ah","oh"]) if(k!==SOLO) gone.push("v-"+k,"tot-"+k);
 for(const id of gone){
  const el=document.getElementById(id); if(!el) continue;
  (id.startsWith("tot-")?el.parentElement:el).remove();
 }
 const grp=document.getElementById("v-"+SOLO); if(grp&&grp.parentElement)grp.parentElement.remove();
 const div=document.querySelector(".tdiv"); if(div)div.remove();
 document.title=SYS[SOLO]+" Provider Map";
}
drawLayer();syncMapFrame();
if(typeof ResizeObserver==="function")new ResizeObserver(syncMapFrame).observe(svg);else window.addEventListener("resize",syncMapFrame);
</script>`;

function main() { const r = render(); console.log(`wrote public/provider-map.html — ${r.counties} counties + ${r.zips} ZIPs, ${(r.bytes / 1e6).toFixed(2)} MB`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
