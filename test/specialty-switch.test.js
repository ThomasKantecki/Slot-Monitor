// The specialty menu in the header, and the placeholder pages for a specialty without data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPECIALTIES, specialtyHref, specialtyOf } from "../src/shared/specialties.js";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, suiteTitle } from "../src/shared/suite-navigation.js";
import { renderSpecialtyPlaceholder } from "../src/shared/specialty-placeholders.js";

test("the title box offers every specialty and links each one to the same view", () => {
  assert.deepEqual(SPECIALTIES.map((specialty) => specialty.id), ["cardiology", "orthopedics"]);
  const cardio = suiteTitle("slot-times");
  assert.match(cardio, /<select class="specialty-select" aria-label="Specialty">/);
  assert.match(cardio, /<option value="cardiology" data-href="\.\/index\.html" selected>Cardiology<\/option>/);
  assert.match(cardio, /<option value="orthopedics" data-href="\.\/orthopedics\/index\.html">Orthopedics<\/option>/);
  assert.match(cardio, /class="pixel-heart"/);
  assert.doesNotMatch(cardio, /pixel-bone/);
  const ortho = suiteTitle("provider-map", "orthopedics");
  assert.match(ortho, /<span class="specialty-sizer" aria-hidden="true">Orthopedics<\/span>/);
  assert.match(ortho, /<option value="cardiology" data-href="\.\.\/provider-map\.html">Cardiology<\/option>/);
  assert.match(ortho, /<option value="orthopedics" data-href="\.\/provider-map\.html" selected>Orthopedics<\/option>/);
  assert.match(ortho, /<b>Provider Index<\/b><\/span><span class="pixel-bone" aria-hidden="true">/);
  assert.doesNotMatch(ortho, /pixel-heart/);
  assert.throws(() => suiteTitle("slot-times", "dermatology"), /Unknown specialty/);
  assert.equal(specialtyHref(specialtyOf("orthopedics"), specialtyOf("cardiology"), "index.html"), "../index.html");
});

test("choosing a specialty navigates to that specialty's copy of the view", () => {
  assert.match(SUITE_INFO_SCRIPT, /querySelector\("\.specialty-select"\)[\s\S]*addEventListener\("change"[\s\S]*dataset\.href[\s\S]*location\.href = href/);
  assert.match(SUITE_NAV_STYLES, /\.specialty-select\{position:absolute;inset:0;width:100%;height:100%[^}]*appearance:none/);
  assert.match(SUITE_NAV_STYLES, /\.specialty-sizer\{display:inline-block;visibility:hidden/);
});

test("a specialty without published data gets placeholder pages that carry the shared header", () => {
  for (const [page, view, name] of [["slot-times", "Slot Availability", "Slot Availability"], ["opportunities", "AH Market Opportunities", "Market Opportunities"], ["provider-map", "Provider Index", "Provider Index"]]) {
    const html = renderSpecialtyPlaceholder("orthopedics", page);
    assert.match(html, new RegExp(`<title>Orthopedics ${name}</title>`));
    assert.match(html, /<option value="orthopedics"[^>]*selected>Orthopedics<\/option>/);
    assert.match(html, new RegExp(`<b>${view}</b></span><span class="pixel-bone"`));
    assert.match(html, /Orthopedics data is coming soon\./);
    assert.match(html, /<nav class="suite-switcher" aria-label="Dashboard views">/);
    assert.match(html, /id="dataset-info-button"/);
    assert.match(html, /<li class="warn"><span class="check-mark">!<\/span><span>Orthopedics slot data has not been published yet/);
    assert.match(html, /--ah-logo-img:url\(data:image\/png;base64,/);
    assert.doesNotMatch(html, /__[A-Z_]+__/);
  }
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /node src\/shared\/specialty-placeholders\.js$/);
  assert.match(pkg.scripts.all, /node src\/shared\/specialty-placeholders\.js$/);
});
