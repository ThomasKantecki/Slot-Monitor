// Rosters -> the four artifacts src/render.js embeds. See the data contract
// comment above the reads in render.js for the exact shapes.
//
// Counting model, both systems: a per-area count is a FOOTPRINT (a clinician
// appears once in every area they work in) while statewide totals are distinct
// people. Published-location totals count distinct provider-office assignments,
// so that headline is invariant when the same locations are grouped by ZIP or
// county. Within one area the roster groups a person once and lists every
// published office in that area.

const titleCase = (s) => String(s ?? "").trim();
const SYSTEMS = ["ah", "oh"];
const cleanLocation = (l) => ({
  n: titleCase(l.name), a: titleCase(l.addr), c: titleCase(l.city), z: l.zip,
});
const locationKey = (l) => `${l.z}|${l.a.toLowerCase()}|${l.c.toLowerCase()}|${l.n.toLowerCase()}`;

export function aggregate({ rosters, zipCounty, source, locationMode = "all",
                            systemNames = { ah: "AdventHealth", oh: "Orlando Health" } }) {
  const blank = () => ({ ah: new Set(), oh: new Set() });
  const areas = { zip: new Map(), county: new Map() };
  const rosterOut = { zip: new Map(), county: new Map() };
  const total = blank();
  const specTotal = new Map();
  const locationTotal = blank();
  const specLocationTotal = new Map();

  const bump = (kind, key, spec, sys, uid) => {
    if (!key) return;
    if (!areas[kind].has(key)) areas[kind].set(key, { people: blank(), spec: new Map() });
    const a = areas[kind].get(key);
    a.people[sys].add(uid);
    if (!a.spec.has(spec)) a.spec.set(spec, blank());
    a.spec.get(spec)[sys].add(uid);
  };

  for (const sys of SYSTEMS) {
    for (const p of rosters[sys] ?? []) {
      const uid = p.npi ?? `${sys}:${p.slug ?? p.name}`;
      const rosterUid = `${sys}:${uid}`;
      const spec = p.specialty;
      total[sys].add(uid);
      if (!specTotal.has(spec)) specTotal.set(spec, blank());
      specTotal.get(spec)[sys].add(uid);
      if (!specLocationTotal.has(spec)) specLocationTotal.set(spec, blank());

      const addRoster = (kind, key, l) => {
        if (!key) return;
        if (!rosterOut[kind].has(key)) rosterOut[kind].set(key, new Map());
        const byProvider = rosterOut[kind].get(key);
        if (!byProvider.has(rosterUid)) byProvider.set(rosterUid, {
          i: uid, n: p.name, s: spec, y: sys, cr: p.cred ?? "",
          ph: p.photo ?? "", u: p.profile ?? "", l: [],
        });
        const entry = byProvider.get(rosterUid);
        const locKey = locationKey(l);
        if (!entry.l.some((x) => locationKey(x) === locKey)) entry.l.push(l);
      };
      const seenZip = new Set(), seenCounty = new Set(), seenLocations = new Set();
      for (const rawLocation of p.locations ?? []) {
        if (!rawLocation.zip) continue;
        const l = cleanLocation(rawLocation);
        const locKey = locationKey(l);
        if (seenLocations.has(locKey)) continue;
        seenLocations.add(locKey);
        const assignment = `${rosterUid}|${locKey}`;
        locationTotal[sys].add(assignment);
        specLocationTotal.get(spec)[sys].add(assignment);
        if (!seenZip.has(l.z)) {
          seenZip.add(l.z);
          bump("zip", l.z, spec, sys, uid);
        }
        addRoster("zip", l.z, l);
        const county = zipCounty[l.z];
        if (county) {
          if (!seenCounty.has(county)) {
            seenCounty.add(county);
            bump("county", county, spec, sys, uid);
          }
          addRoster("county", county, l);
        }
      }
    }
  }

  const specialties = [...specTotal.entries()]
    .map(([name, v]) => {
      const loc = specLocationTotal.get(name) ?? blank();
      return { name, label: name, ah: v.ah.size, oh: v.oh.size,
        ahLocations: loc.ah.size, ohLocations: loc.oh.size };
    })
    .sort((a, b) => (b.ah + b.oh) - (a.ah + a.oh));

  const pack = (kind) => ({
    generatedAt: new Date().toISOString(),
    source,
    locationMode,
    systems: systemNames,
    totals: { ah: total.ah.size, oh: total.oh.size,
      note: locationMode === "all"
        ? "Distinct employed clinicians in bookable clinic specialties. Statewide totals count each person once; ZIP and county footprints count them once in every published practice area."
        : "Distinct employed clinicians in bookable clinic specialties. Statewide totals count each person once; ZIP and county footprints use one primary or first-published practice location." },
    locationTotals: { ah: locationTotal.ah.size, oh: locationTotal.oh.size,
      note: "Distinct provider-office assignments across all published Florida practice locations. The total is unchanged when those same locations are grouped by ZIP or county." },
    specialties,
    zips: Object.fromEntries([...areas[kind]].map(([k, v]) => [k, {
      ah: v.people.ah.size, oh: v.people.oh.size,
      spec: Object.fromEntries([...v.spec].map(([s, ids]) => [s, { a: ids.ah.size, o: ids.oh.size }])),
    }])),
  });

  const sortRoster = (m) => Object.fromEntries([...m].map(([k, v]) => [k,
    [...v.values()]
      .map((p) => ({ ...p, l: p.l.sort((a, b) => `${a.c}|${a.a}`.localeCompare(`${b.c}|${b.a}`)) }))
      .sort((a, b) => a.n.localeCompare(b.n)),
  ]));

  return { byZip: pack("zip"), byCounty: pack("county"),
           rosterZip: sortRoster(rosterOut.zip), rosterCounty: sortRoster(rosterOut.county) };
}
