import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUITE_NAV_STYLES, suiteNavigation } from "../src/shared/suite-navigation.js";
import { renderSlotTimes } from "../src/slot-times/render.js";

test("shared navigation marks exactly one current view", () => {
  const provider = suiteNavigation("provider-map");
  const slots = suiteNavigation("slot-times");
  assert.match(provider, /href="\.\/provider-map\.html" aria-current="page"/);
  assert.doesNotMatch(provider, /href="\.\/slot-times\.html" aria-current="page"/);
  assert.match(slots, /href="\.\/slot-times\.html" aria-current="page"/);
  assert.doesNotMatch(slots, /href="\.\/provider-map\.html" aria-current="page"/);
});

test("Provider Map and Slot Times use the same top-level switcher", () => {
  const providerSource = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
  const slots = renderSlotTimes();
  assert.match(providerSource, /suiteNavigation\("provider-map"\)/);
  assert.match(slots, /aria-label="Dashboard views"/);
  assert.match(slots, /id="slot-times-root" data-page="slot-times"/);
  assert.match(slots, /No slot-time data is connected yet\./);
});

test("both views keep the same stationary outer shell", () => {
  const slots = renderSlotTimes();
  assert.match(SUITE_NAV_STYLES, /\.brand-box\{width:324px;justify-content:space-between\}/);
  assert.match(SUITE_NAV_STYLES, /html\{scrollbar-gutter:stable\}/);
  assert.match(SUITE_NAV_STYLES, /@media \(min-width:881px\) and \(max-height:680px\)/);
  assert.match(SUITE_NAV_STYLES, /\.hdr-in\{min-height:52px;padding:6px 18px\}/);
  assert.match(SUITE_NAV_STYLES, /\.wrap\{padding:8px 16px 10px\}/);
  assert.match(SUITE_NAV_STYLES, /\.panel-band\{padding:5px 12px\}/);
  assert.match(slots, /html\{height:100%;overflow:hidden\}/);
  assert.match(slots, /padding:14px 22px 16px/);
  assert.match(slots, /\.panel-band\{background:var\(--chrome\);padding:8px 16px/);
  assert.ok(
    slots.indexOf("@media (min-width:881px) and (max-height:680px)") > slots.indexOf(".panel-band{background:var(--chrome)"),
    "compact shell rules must follow the normal box dimensions so they win the cascade",
  );
  assert.match(slots, /\.panel\{width:100%;min-height:0/);
  assert.match(slots, /@media \(max-width:880px\),\(max-height:520px\)/);
  assert.match(slots, /@media \(max-width:480px\)[\s\S]*\.wrap\{padding:10px\}/);
});
