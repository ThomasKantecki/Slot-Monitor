import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boundsIntersect, dragExceededThreshold, escapeScriptJson, motionRasterTransform, providerAvailabilityTotals, providerHeadline } from "../src/render.js";

// Guards the literal-space trap: the U+2028/U+2029 search args must not rewrite
// spaces, or every SVG path coordinate separator would be corrupted.
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
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /class="panel lpanel"|id="legend"|id="legtitle"/);
  assert.match(src, /id="map-key"/);
  assert.match(src, />Orlando Health<\/span>/);
  assert.match(src, />AdventHealth<\/span>/);
});

test("map color key keeps all three comparison labels on one row", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /\.map-key\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(3,max-content\)[^}]*white-space:nowrap/);
  assert.match(src, /id="key-tie"[^>]*>[\s\S]*?<span>Equal<\/span>/);
});

test("company view filters and refreshes the provider index", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /if\(view!=="diff"\) list=list\.filter\(x=>x\.y===view\)/);
  assert.match(src, /VISIBLE_SYSTEMS\(\)\.map/);
  assert.match(src, /paint\(\);if\(selected\)showProviders\(selected\);else resetPanel\(\)/);
});

test("nonzero ties use a red-and-blue striped map fill", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /id="tie-stripes"/);
  assert.match(src, /const TIE_FILL="url\(#tie-stripes\)"/);
  assert.match(src, /if\(d===0\) return TIE_FILL/);
  assert.match(src, /red and blue striped areas are equal/);
});

test("selected ZIP and county borders override their base stroke widths", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /#lay-zip path\.z\.sel,#lay-county path\.z\.sel\{stroke:#000;stroke-width:2\.8\}/);
  assert.match(src, /#lay-zip path\.z:hover,#lay-county path\.z:hover\{stroke:#000;stroke-width:1\.8\}/);
});

test("desktop filters compact into one row when the map panel is wide enough", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /container-type:inline-size/);
  assert.match(src, /@container \(min-width:680px\) and \(max-width:819px\)\{\.controls\{flex-wrap:nowrap\}/);
  assert.match(src, /@container \(min-width:820px\)\{\.controls\{flex-wrap:nowrap\}\}/);
  assert.match(src, /\.pill-logo\{[^}]*width:52px;height:16px/);
  assert.match(src, /select\.control\{[^}]*width:104px;max-width:104px/);
});

test("statewide zoom uses a raster motion layer and avoids per-move layout reads", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /id="map-raster"/);
  assert.match(src, /id="map-raster-detail"/);
  assert.match(src, /function beginRasterMotion\(\)/);
  assert.match(src, /raster\.style\.transform=/);
  assert.match(src, /requestAnimationFrame\(moveDrag\)/);
  const moveDrag = src.match(/function moveDrag\(\)\{[^\n]+/)?.[0] ?? "";
  assert.doesNotMatch(moveDrag, /getBoundingClientRect/);
});

test("drag rendering uses a cached base raster and clipped sharp detail raster", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /const BASE_RASTER_DPR=3,DETAIL_RASTER_DPR=2,BASE_ZOOM_LIMIT=2\.5/);
  assert.match(src, /function drawBaseRaster\(\)/);
  assert.match(src, /function applyBaseRasterZoom\(\)/);
  assert.match(src, /const cssW=Math\.ceil\(mapFrame\.w\+pad\*2\),cssH=Math\.ceil\(mapFrame\.h\+pad\*2\)/);
  assert.match(src, /boundsIntersect\(entry\.b,bounds\)/);
  assert.match(src, /ctx\.lineWidth=\(gran==="zip"\?\.4:\.9\)\/scale/);
  assert.match(src, /function rasterRefreshNeeded\(t\)/);
  assert.match(src, /if\(rasterRefreshNeeded\(t\)\)\{drawDetailRaster\(\);return;\}/);
  assert.match(src, /if\(detailRaster\.width!==pixelW\)detailRaster\.width=pixelW/);
  assert.doesNotMatch(src, /shape-rendering:optimizeSpeed/);
});

test("motion raster transform tracks pan and zoom without repainting each frame", () => {
  const frame = { s: 0.5, ox: 10, oy: 20 };
  const snapshot = { k: 2, x: -220, y: -90, pad: 200 };
  assert.deepEqual(motionRasterTransform({ k: 2, x: -200, y: -100 }, snapshot, frame), {
    scale: 1,
    x: 10,
    y: -5,
  });
  assert.deepEqual(motionRasterTransform({ k: 4, x: -300, y: -150 }, { ...snapshot, x: -100, y: -50 }, frame), {
    scale: 2,
    x: -260,
    y: -245,
  });
});

test("detail raster bounds include visible overlaps and exclude distant geometry", () => {
  assert.equal(boundsIntersect([0, 0, 10, 10], [5, 5, 15, 15]), true);
  assert.equal(boundsIntersect([0, 0, 10, 10], [10, 10, 20, 20]), true);
  assert.equal(boundsIntersect([0, 0, 10, 10], [11, 0, 20, 10]), false);
});

test("a county click does not enter drag mode until real pointer movement", () => {
  assert.equal(dragExceededThreshold(0, 0), false);
  assert.equal(dragExceededThreshold(3, 4), false);
  assert.equal(dragExceededThreshold(4, 4), true);

  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
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
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
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
