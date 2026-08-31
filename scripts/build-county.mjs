// Build data/zip-county.json = { "<zip5>": "<County Name>" } for Florida, from the
// Census 2020 ZCTA-to-county relationship file. For ZCTAs spanning counties, pick
// the county holding the largest land area of the ZCTA.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const lines = readFileSync(join(ROOT, "data", "raw", "zcta-county.txt"), "utf8").split("\n");
const header = lines[0].replace(/^﻿/, "").split("|");
const iZip = header.indexOf("GEOID_ZCTA5_20");
const iCty = header.indexOf("GEOID_COUNTY_20");
const iName = header.indexOf("NAMELSAD_COUNTY_20");
const iArea = header.indexOf("AREALAND_PART");

const best = new Map(); // zip -> { county, area }
for (let i = 1; i < lines.length; i += 1) {
  const c = lines[i].split("|");
  if (c.length < header.length) continue;
  if (!String(c[iCty]).startsWith("12")) continue; // Florida county FIPS
  const zip = c[iZip];
  const county = String(c[iName]).replace(/ County$/, "");
  const area = Number(c[iArea]) || 0;
  const cur = best.get(zip);
  if (!cur || area > cur.area) best.set(zip, { county, area });
}
const out = {};
for (const [zip, v] of [...best.entries()].sort()) out[zip] = v.county;
writeFileSync(join(ROOT, "data", "zip-county.json"), JSON.stringify(out));
const counties = [...new Set(Object.values(out))].sort();
console.log(`wrote data/zip-county.json — ${Object.keys(out).length} FL ZIPs, ${counties.length} counties`);
console.log("counties:", counties.join(", "));
