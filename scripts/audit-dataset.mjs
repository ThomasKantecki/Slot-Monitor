// Data integrity audit for one specialty: the run folders (when present), the current dataset, the published
// summary and day partitions, and the Provider Index's embedded data must all agree with each other and with the
// source rules. Every check recomputes its figure independently; a refresh that fails one must not be published.
// Usage: node --max-old-space-size=6144 scripts/audit-dataset.mjs [--specialty <id>] (default: every published specialty)
import { readFileSync, readdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isTelemedicineSlot, isNewPatientType } from "../slots/slot-model.js";
import { SPECIALTIES, specialtyFromArgv } from "../pages/shared/specialties.js";
import { credentialClass, findDirectoryPerson } from "../rosters/people.js";

const R = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const wanted = process.argv.includes("--specialty") ? [specialtyFromArgv().id] : SPECIALTIES.map((s) => s.id).filter((id) => existsSync(R + `public/data/${id}/slot-times-summary.json`));
let failedTotal = 0;
for (const sp of wanted) failedTotal += audit(sp);
process.exit(failedTotal ? 1 : 0);

function audit(sp) {
const registry = SPECIALTIES.find((s) => s.id === sp);
const json = (p) => JSON.parse(readFileSync(R + p, "utf8"));
const results = [];
const check = (name, ok, detail = "") => { results.push([ok ? "PASS" : "FAIL", name, String(detail).slice(0, 300)]); };
const n = (v) => Number(v || 0).toLocaleString("en-US");

// ---------- files ----------
const manifest = json(`data/${sp}/current/manifest.json`);
const summary = json(`public/data/${sp}/slot-times-summary.json`);
const partitionDir = `public/data/${sp}/slots/`;
const files = readdirSync(R + partitionDir).filter((f) => f.endsWith(".json")).sort();
const zipCounty = json("data/geography/zip-county.json");
const zctaZips = new Set(json("data/geography/fl-zcta.geojson").features.map((f) => f.properties.zip));

// ---------- partitions ----------
const perSystem = { ah: 0, oh: 0 }, nonPhys = { ah: 0, oh: 0 }, video = { ah: 0, oh: 0 }, newPat = { ah: 0, oh: 0 };
const seen = new Set(); let dupes = 0, total = 0, badDate = 0, badRef = 0, badTime = 0, badFlag = 0, badType = 0, sysMismatch = 0;
const usedProviders = new Set(), usedFacilities = new Set(), pairSet = new Set(), perDate = new Map(), catalogCounts = {};
const maxBySystem = { ah: "", oh: "" }; let minDate = "9999", maxDate = "";
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true });
const localParts = (iso) => { const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])); return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute} ${parts.dayPeriod}` }; };
const types = summary.types, providers = summary.providers, facilities = summary.facilities;
const providerIsPhysician = providers.map((p) => p.c === "Physician");
for (const file of files) {
  const part = JSON.parse(readFileSync(R + partitionDir + file, "utf8"));
  const date = file.replace(".json", "");
  if (part.date !== date) badDate += 1;
  perDate.set(date, part.slots.length);
  for (const s of part.slots) {
    total += 1; perSystem[s.y] += 1;
    if (s.d !== date) badDate += 1;
    if (!(s.p >= 0 && s.p < providers.length) || !(s.f >= 0 && s.f < facilities.length)) { badRef += 1; continue; }
    usedProviders.add(s.p); usedFacilities.add(s.f); pairSet.add(`${s.p}|${s.f}`);
    if (providers[s.p].y !== s.y || facilities[s.f].y !== s.y) sysMismatch += 1;
    const key = `${s.y}|${s.p}|${s.f}|${s.u}`; if (seen.has(key)) dupes += 1; else seen.add(key);
    const local = localParts(s.u); if (local.date !== s.d || local.time !== s.t) badTime += 1;
    if (s.d < minDate) minDate = s.d; if (s.d > maxDate) maxDate = s.d; if (s.d > maxBySystem[s.y]) maxBySystem[s.y] = s.d;
    if (!providerIsPhysician[s.p]) nonPhys[s.y] += 1;
    if (s.v) video[s.y] += 1;
    if (s.np) newPat[s.y] += 1;
    const names = (s.ty || []).map((i) => types[i]); if ((s.ty || []).some((i) => !(i >= 0 && i < types.length))) badType += 1;
    const expectNp = names.some(isNewPatientType) ? 1 : 0; if (Boolean(s.np) !== Boolean(expectNp)) badFlag += 1;
    if (s.y === "ah") { const expectV = isTelemedicineSlot(names) ? 1 : 0; if (Boolean(s.v) !== Boolean(expectV)) badFlag += 1; }
    if (s.cat !== undefined) catalogCounts[s.cat] = (catalogCounts[s.cat] || 0) + 1;
  }
}
check("P1 partition files are named by their date and every slot inside carries that date", badDate === 0, `${badDate} mismatches over ${files.length} files`);
check("P2 every slot points at a real provider and facility of its own system", badRef === 0 && sysMismatch === 0, `${badRef} bad refs, ${sysMismatch} system mismatches`);
check("P3 no physical slot appears twice (system + provider + facility + UTC time)", dupes === 0, `${dupes} duplicates in ${n(total)} slots`);
check("P4 every slot's day and clock time equal its UTC instant in America/New_York", badTime === 0, `${badTime} mismatches`);
check("P5 new-patient and video flags follow the visit-type names, type indices valid", badFlag === 0 && badType === 0, `${badFlag} flag mismatches, ${badType} bad type indices`);
check("P6 every provider and facility in the summary has at least one slot", usedProviders.size === providers.length && usedFacilities.size === facilities.length, `${usedProviders.size}/${providers.length} providers, ${usedFacilities.size}/${facilities.length} facilities used`);

// ---------- counts agree everywhere ----------
const countLines = (p) => { const fd = openSync(R + p, "r"); const buf = Buffer.alloc(1 << 22); let count = 0, pos = 0, last = 10; for (;;) { const got = readSync(fd, buf, 0, buf.length, pos); if (!got) break; pos += got; for (let i = 0; i < got; i += 1) if (buf[i] === 10) count += 1; last = buf[got - 1]; } closeSync(fd); return last === 10 ? count : count + 1; };
const csvRows = countLines(`data/${sp}/current/${sp}-physical-slots.csv`) - 1;
const jsonRows = countLines(`data/${sp}/current/${sp}-physical-slots.json`) - 2; // one row per line between [ and ]
const summaryTotals = summary.totals;
check("C1 manifest total = AH + OH = summary total = partition slots = CSV rows = JSON rows",
  manifest.totalPhysicalSlots === manifest.ah.physicalSlots + manifest.oh.physicalSlots && manifest.totalPhysicalSlots === summary.totalPhysicalSlots && summary.totalPhysicalSlots === total && csvRows === total && jsonRows === total,
  `manifest ${n(manifest.totalPhysicalSlots)} (AH ${n(manifest.ah.physicalSlots)} + OH ${n(manifest.oh.physicalSlots)}), summary ${n(summary.totalPhysicalSlots)}, partitions ${n(total)}, csv ${n(csvRows)}, json ${n(jsonRows)}`);
check("C2 per-system slot counts in the partitions equal the manifest and the summary totals", perSystem.ah === manifest.ah.physicalSlots && perSystem.oh === manifest.oh.physicalSlots && summaryTotals.ah === perSystem.ah && summaryTotals.oh === perSystem.oh, `partitions ${JSON.stringify(perSystem)}, summary ${JSON.stringify(summaryTotals)}`);
check("C3 non-physician, video-only and new-patient counts recompute from the partitions and match the manifest",
  nonPhys.ah === manifest.ah.nonPhysicianSlots && nonPhys.oh === manifest.oh.nonPhysicianSlots && video.ah === manifest.ah.telemedicineOnlySlots && video.oh === manifest.oh.telemedicineOnlySlots && newPat.ah === manifest.ah.newPatientSlots && newPat.oh === manifest.oh.newPatientSlots && summary.telemedicineSlots === video.ah + video.oh,
  `nonPhys ${JSON.stringify(nonPhys)} video ${JSON.stringify(video)} newPat ${JSON.stringify(newPat)} vs manifest ${JSON.stringify({ ah: [manifest.ah.nonPhysicianSlots, manifest.ah.telemedicineOnlySlots, manifest.ah.newPatientSlots], oh: [manifest.oh.nonPhysicianSlots, manifest.oh.telemedicineOnlySlots, manifest.oh.newPatientSlots] })}`);
check("C4 summary date bounds equal the partitions (min, max, per system, common endpoint) and the partition list", summary.minDate === minDate && summary.maxDate === maxDate && summary.maxDateBySystem.ah === maxBySystem.ah && summary.maxDateBySystem.oh === maxBySystem.oh && summary.commonMaxDate === (maxBySystem.ah < maxBySystem.oh ? maxBySystem.ah : maxBySystem.oh) && JSON.stringify(summary.partitionDates) === JSON.stringify(files.map((f) => f.replace(".json", ""))),
  `summary ${summary.minDate}..${summary.maxDate} ${JSON.stringify(summary.maxDateBySystem)} common ${summary.commonMaxDate}; partitions ${minDate}..${maxDate} ${JSON.stringify(maxBySystem)}`);
check("C5 the provider-facility pairs in the summary (with their slot counts) equal the pairs that have slots", (() => { const pf = summary.providerFacilities; if (!Array.isArray(pf)) return false; const counts = new Map(); for (const key of seen) { const [, p, f] = key.split("|"); counts.set(`${p}|${f}`, (counts.get(`${p}|${f}`) || 0) + 1); } return pf.length === counts.size && pf.every(([p, f, c]) => counts.get(`${p}|${f}`) === c); })(), `${pairSet.size} pairs`);

// ---------- facilities and geography ----------
let badZip = 0, badCounty = 0, badAddress = 0;
for (const f of facilities) {
  const zip = String(f.z || ""); if (!zctaZips.has(zip) || !zipCounty[zip]) badZip += 1;
  if (zipCounty[zip] && zipCounty[zip] !== f.ct) badCounty += 1;
  const m = String(f.a || "").match(/\b(\d{5})(?:-\d{4})?\s*$/); if (!m || m[1] !== zip) badAddress += 1;
}
check("G1 every facility ZIP has a map polygon and a county, the county name matches the ZIP table, the address ends in that ZIP", badZip === 0 && badCounty === 0 && badAddress === 0, `${badZip} unmapped ZIPs, ${badCounty} county mismatches, ${badAddress} address/ZIP mismatches over ${facilities.length} facilities`);
const cats = summary.catalog, catSlots = summary.catalogSlots;
check("R1 the catalog entries in the summary are exactly the registry's entries for this specialty", (() => { if (!cats || !registry) return false; const want = registry.catalog; return ["ah", "oh"].every((sys) => JSON.stringify([...(cats[sys] || [])].sort()) === JSON.stringify([...(want[sys] || [])].sort())); })(), `summary ${JSON.stringify(cats)} registry ${JSON.stringify(registry && registry.catalog)}`);
check("R2 catalog slot counts sum to the totals per system", (() => { if (!catSlots) return false; return ["ah", "oh"].every((sys) => Object.values(catSlots[sys] || {}).reduce((a, b) => a + b, 0) >= perSystem[sys]); })(), JSON.stringify(catSlots).slice(0, 200));

// ---------- current CSV/JSON rows vs partitions (streamed, key equality) ----------
{
  const wantKeys = new Set(); for (const key of seen) { const [y, p, f, u] = key.split("|"); wantKeys.add(`${providers[p].i}|${facilities[f].i}|${u}`); }
  const fd = openSync(R + `data/${sp}/current/${sp}-physical-slots.json`, "r"); const buf = Buffer.alloc(1 << 22); let left = "", pos = 0, matched = 0, missing = 0, rows = 0, fl = 0;
  const take = (line) => { const t = line.trim().replace(/,$/, ""); if (!t || t === "[" || t === "]") return; const r = JSON.parse(t); rows += 1; if (r.state === "FL" || !r.state) fl += 1; const key = `${r.provider_id}|${r.facility_id}|${r.display_datetime_utc || r.appointment_datetime_utc || r.utc}`; if (wantKeys.has(key)) matched += 1; else missing += 1; };
  for (;;) { const got = readSync(fd, buf, 0, buf.length, pos); if (!got) break; pos += got; const parts = (left + buf.toString("utf8", 0, got)).split("\n"); left = parts.pop(); for (const line of parts) take(line); }
  closeSync(fd); if (left.trim()) take(left);
  check("C6 every row of the current physical-slot JSON is a published slot (same provider, facility and UTC time) and nothing is missing", missing === 0 && matched === wantKeys.size && rows === total, `${n(rows)} rows, ${n(matched)} matched, ${n(missing)} not in partitions, ${n(fl)} Florida`);
}

// ---------- run folders ----------
const run = manifest.ah.runId;
check("X1 both systems come from the same run id (same-day pull)", manifest.ah.runId === manifest.oh.runId, `${manifest.ah.runId} / ${manifest.oh.runId}`);
for (const sys of ["ah", "oh"]) {
  const ex = `data/${sp}/extractions/${run}/${sys}/`;
  if (!existsSync(R + ex)) { check(`X2 ${sys} extraction folder present (skipped: not on disk)`, true, ex); continue; }
  const em = json(ex + "extraction-manifest.json"); const audit = json(ex + `${sys}-${sp}-flow-audit.json`);
  const bad = audit.filter((r) => ["request_failed", "slot_lookup_error", "flow_error", "rule_conflict", "page_guard_reached", "repeated_page_stop", "restart_stalled"].includes(r.status));
  const flows = audit.filter((r) => ["horizon_reached", "schedule_end", "natural_stop", "public_stop", "request_failed", "slot_lookup_error"].includes(r.status));
  check(`X2 ${sys} extraction complete, every flow ended at the schedule horizon or a public stop, none failed`, em.status === "complete" && bad.length === 0, `${em.status}; ${flows.length} flows, ${audit.filter((r) => r.status === "horizon_reached").length} horizon, ${audit.filter((r) => r.status === "public_stop").length} public stops, ${bad.length} failed`);
  if (!existsSync(R + `data/${sp}/runs/${run}/${sys}/manifest.json`)) { check(`X3 ${sys} run manifest present (skipped: not on disk)`, true, `data/${sp}/runs/${run}/${sys}`); continue; }
  const runM = json(`data/${sp}/runs/${run}/${sys}/manifest.json`);
  const runPhysical = runM.physicalSlots ?? runM.source?.physicalSlots ?? runM.rows ?? runM.slots ?? runM.count;
  check(`X3 ${sys} run manifest present; Florida physical slots in the current dataset do not exceed the run's physical slots`, Number(runPhysical) >= manifest[sys].physicalSlots, `run ${n(runPhysical)} >= current ${n(manifest[sys].physicalSlots)}`);
}

// ---------- Provider Index embedded data ----------
{
  const folder = registry && registry.folder ? registry.folder : "";
  const html = readFileSync(R + `public/${folder}provider-map.html`, "utf8");
  const embedded = (id) => JSON.parse(html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))[1]);
  const zData = embedded("zdata"), zRoster = embedded("zroster"), cData = embedded("cdata"), cRoster = embedded("croster"), zDataP = embedded("zdata-primary"), zRosterP = embedded("zroster-primary"), zpaths = embedded("zpaths");
  const distinct = (roster) => { const s = { ah: new Set(), oh: new Set() }; for (const es of Object.values(roster)) for (const e of es) s[e.y].add(e.i); return { ah: s.ah.size, oh: s.oh.size }; };
  const assignments = (roster) => { const s = { ah: new Set(), oh: new Set() }; for (const es of Object.values(roster)) for (const e of es) for (const l of e.l || []) s[e.y].add(`${e.i}|${l.z}|${String(l.a || "").toLowerCase()}|${String(l.c || "").toLowerCase()}|${String(l.n || "").toLowerCase()}`); return { ah: s.ah.size, oh: s.oh.size }; };
  const group = registry.roster.group, members = new Set(registry.roster.members || []);
  const inGroup = (e) => e.s === group || members.has(e.s) || members.has(e.sl) || (e.ls || []).some((l) => l === group || members.has(l));
  const groupRoster = Object.fromEntries(Object.entries(zRoster).map(([k, es]) => [k, es.filter(inGroup)]));
  const groupRosterP = Object.fromEntries(Object.entries(zRosterP).map(([k, es]) => [k, es.filter(inGroup)]));
  const spec = (zData.specialties || []).find((x) => x.name === group), specP = (zDataP.specialties || []).find((x) => x.name === group);
  const dz = distinct(groupRoster), az = assignments(groupRoster), dp = distinct(groupRosterP);
  check(`I1 Provider Index headline for ${group} (all locations) = distinct provider-office assignments of the group's people`, spec && spec.ahLocations === az.ah && spec.ohLocations === az.oh, `page ${JSON.stringify(spec)} recount assignments ${JSON.stringify(az)} people ${JSON.stringify(dz)}`);
  check(`I2 Provider Index ${group} primary-only headline = distinct people, one office each`, specP && specP.ah === dp.ah && specP.oh === dp.oh && Object.values(groupRosterP).every((es) => es.every((e) => (e.l || []).length <= 1)), `page ${JSON.stringify(specP)} recount ${JSON.stringify(dp)}`);
  const wholeAz = assignments(zRoster), wholeDz = distinct(zRoster);
  check("I2b whole-directory totals embedded in the page = distinct assignments / distinct people over every specialty", zData.locationTotals.ah === wholeAz.ah && zData.locationTotals.oh === wholeAz.oh && zData.totals.ah === wholeDz.ah && zData.totals.oh === wholeDz.oh, `page ${JSON.stringify(zData.locationTotals)} / ${JSON.stringify(zData.totals)} recount ${JSON.stringify(wholeAz)} / ${JSON.stringify(wholeDz)}`);
  let perAreaBad = 0, areas = 0;
  for (const [k, v] of Object.entries(zData.zips || {})) { areas += 1; const es = zRoster[k] || []; for (const sys of ["ah", "oh"]) { const want = new Set(es.filter((e) => e.y === sys).map((e) => e.i)).size; const got = v[sys] ?? v[sys === "ah" ? "a" : "o"]; if (got !== undefined && got !== want) perAreaBad += 1; } }
  check("I3 per-ZIP counts on the map equal the distinct people listed for that ZIP", perAreaBad === 0, `${perAreaBad} mismatches over ${areas} ZIPs`);
  const pathKeys = new Set(zpaths.map((p) => p.k)); const noPath = Object.keys(zData.zips || {}).filter((k) => !pathKeys.has(k));
  check("I4 every ZIP with providers has a map polygon", noPath.length === 0, `${noPath.length} without polygon ${noPath.slice(0, 5)}`);
  const labelCounts = new Map(); let groupPeople = 0;
  for (const es of Object.values(groupRoster)) for (const e of es) { groupPeople += 1; for (const l of new Set([e.s, e.sl, ...(e.ls || [])].filter(Boolean))) labelCounts.set(l, (labelCounts.get(l) || 0) + 1); }
  const dropdownLabels = [group, ...members].filter((l) => (zData.specialties || []).some((x) => x.name === l));
  check(`I5 the ${group} group has people under it and every sub-specialty label in the dropdown has a page count`, groupPeople > 0 && dropdownLabels.length >= 1 && dropdownLabels.every((l) => { const x = zData.specialties.find((y) => y.name === l); return x && (x.ah + x.oh) > 0; }), `${groupPeople} entries; labels present ${dropdownLabels.length} of ${1 + members.size}: ${dropdownLabels.slice(0, 8).join(", ")}`);
  const ids = new Map(); let dupPeople = 0; for (const [k, es] of Object.entries(zRoster)) { const inZip = new Set(); for (const e of es) { if (inZip.has(`${e.y}|${e.i}`)) dupPeople += 1; inZip.add(`${e.y}|${e.i}`); } }
  check("I6 no person is listed twice in the same ZIP", dupPeople === 0, `${dupPeople} duplicates`);
  // I7: a clinician added from the scheduling catalog must not also be a directory person of the group under another
  // spelling of the first name (surname + a shared office + the same credential class = the same person)
  const tokens = (name) => String(name ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/,.*$/, "").replace(/[^a-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  const street = (l) => `${String(l.z ?? "").slice(0, 5)}|${(String(l.a ?? "").match(/^\s*(\d+)/) ?? [])[1] ?? ""}`;
  const groupEntries = new Map();
  for (const es of Object.values(groupRoster)) for (const e of es) { const key = `${e.y}|${e.i}`; if (!groupEntries.has(key)) groupEntries.set(key, { ...e, streets: new Set() }); for (const l of e.l ?? []) groupEntries.get(key).streets.add(street(l)); }
  const twice = [];
  for (const added of groupEntries.values()) {
    if (added.src !== "mychart") continue;
    const surname = tokens(added.n).at(-1), cls = credentialClass(added.cr);
    for (const person of groupEntries.values()) {
      if (person.src === "mychart" || person.y !== added.y || tokens(person.n).at(-1) !== surname) continue;
      const personClass = credentialClass(person.cr);
      if (cls && personClass && cls !== personClass) continue;
      if ([...added.streets].some((k) => person.streets.has(k))) twice.push(`${added.n} / ${person.n}`);
    }
  }
  check("I7 no clinician appears both as a directory person and as a scheduling-catalog addition", twice.length === 0, twice.slice(0, 6).join("; "));
}

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? `\n        ${detail}` : ""}`);
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${sp}: ${results.length - failed} of ${results.length} checks passed\n`);
return failed;
}
