import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { escapeScriptJson, providerAvailabilityTotals, providerHeadline } from "../src/render.js";

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
  assert.match(src, /Redder: Orlando Health/);
  assert.match(src, /Bluer: AdventHealth/);
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
  assert.match(src, /Striped: equal/);
});

test("desktop filters compact into one row when the map panel is wide enough", () => {
  const src = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  assert.match(src, /container-type:inline-size/);
  assert.match(src, /@container \(min-width:680px\) and \(max-width:819px\)\{\.controls\{flex-wrap:nowrap\}/);
  assert.match(src, /@container \(min-width:820px\)\{\.controls\{flex-wrap:nowrap\}\}/);
  assert.match(src, /\.pill-logo\{[^}]*width:52px;height:16px/);
  assert.match(src, /select\.control\{[^}]*width:104px;max-width:104px/);
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
