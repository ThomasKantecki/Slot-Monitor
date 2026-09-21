// The live GitHub Pages site must serve exactly what public/ holds: every page, both slot summaries and every day
// file byte-identical, nothing missing. Run after a push once the Pages deploy has finished (no browser needed).
// Usage: node scripts/audit-live.mjs [--base https://.../Slot-Monitor/]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SPECIALTIES } from "../src/shared/specialties.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseIndex = process.argv.indexOf("--base");
const BASE = baseIndex >= 0 ? process.argv[baseIndex + 1] : "https://thomaskantecki.github.io/Slot-Monitor/";
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

const files = ["index.html", "market-opportunities.html", "provider-map.html", "slot-times.html"];
for (const specialty of SPECIALTIES) {
  const folder = specialty.folder || "";
  if (folder) for (const page of ["index.html", "market-opportunities.html", "provider-map.html"]) files.push(folder + page);
  if (!existsSync(join(ROOT, "public", "data", specialty.id, "slot-times-summary.json"))) continue;
  files.push(`data/${specialty.id}/slot-times-summary.json`);
  for (const day of readdirSync(join(ROOT, "public", "data", specialty.id, "slots"))) files.push(`data/${specialty.id}/slots/${day}`);
}
const present = files.filter((file) => existsSync(join(ROOT, "public", file)));
let same = 0; const differ = [], missing = [];
let cursor = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (cursor < present.length) {
    const file = present[cursor++];
    try {
      const response = await fetch(`${BASE}${file}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) { missing.push(`${file} (${response.status})`); continue; }
      if (sha(Buffer.from(await response.arrayBuffer())) === sha(readFileSync(join(ROOT, "public", file)))) same += 1; else differ.push(file);
    } catch (error) { missing.push(`${file} (${error.message})`); }
  }
}));
console.log(`${same} of ${present.length} published files are byte-identical on ${BASE}`);
if (missing.length) console.log(`missing or failed: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` (+${missing.length - 10})` : ""}`);
if (differ.length) console.log(`different from the local build: ${differ.slice(0, 10).join(", ")}${differ.length > 10 ? ` (+${differ.length - 10})` : ""}`);
process.exit(missing.length || differ.length ? 1 : 0);
