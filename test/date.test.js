import { test } from "node:test";
import assert from "node:assert/strict";
import "../src/shared/date.js";

test("shared dashboard date uses the viewer's local calendar date", () => {
  const lateLocalTime = new Date(2026, 8, 5, 23, 59, 59);
  assert.equal(globalThis.SUITE_DATE.today(lateLocalTime), "2026-09-05");
});
