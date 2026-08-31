// Point-in-polygon lookup against the map's own geometry.
//
// Orlando Health's directory carries both a ZIP and a geocode for every
// location, and they do not always agree — one Tampa clinic is published as
// 32618 (Archer, in Alachua County) when its coordinates are plainly Tampa,
// a transposition of 33618. The geocode is the more reliable of the two, so
// derive the ZIP and county from it and treat the published ZIP as a check.

import { readFileSync } from "node:fs";

// Ray casting. Rings are [lng, lat] pairs, GeoJSON order.
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A polygon's first ring is its outline; the rest are holes.
function inPolygon(lng, lat, rings) {
  if (!inRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) if (inRing(lng, lat, rings[i])) return false;
  return true;
}

function bbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Bounding boxes first: without the prefilter this is ~1,000 polygons per point.
export function buildIndex(geojson, keyProp) {
  return geojson.features.map((f) => ({ key: f.properties[keyProp], bb: bbox(f.geometry), geometry: f.geometry }));
}

export function locate(index, lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  for (const e of index) {
    const [minX, minY, maxX, maxY] = e.bb;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    const polys = e.geometry.type === "MultiPolygon" ? e.geometry.coordinates : [e.geometry.coordinates];
    for (const rings of polys) if (inPolygon(lng, lat, rings)) return e.key;
  }
  return null;
}

export function loadGeoIndexes(root) {
  return {
    zip: buildIndex(JSON.parse(readFileSync(`${root}/data/fl-zcta.geojson`, "utf8")), "zip"),
    county: buildIndex(JSON.parse(readFileSync(`${root}/data/fl-county.geojson`, "utf8")), "name"),
  };
}

// ── Resolving a location's ZIP ──────────────────────────────────────────────
// Orlando Health publishes a ZIP, a city and a geocode per location, and any
// one of the three can be wrong. Measured across 5,213 Florida locations:
// 202 published ZIPs disagree with their own geocode, but most of that is
// boundary noise (ZCTAs are census approximations, so a clinic near a line
// falls either side) and the genuine errors run in both directions — one Tampa
// clinic is published as 32618 when it is 33618, while two others are published
// correctly and geocoded 100 miles away.
//
// So no single field is authoritative. Resolution, in order:
//   1. Clinic consensus. The same physical clinic is listed for many doctors,
//      so a minority ZIP at a clinic is a typo. This is the strongest signal.
//   2. No ZCTA for the published ZIP. Some real USPS ZIPs (PO boxes, newer
//      ones) have no census polygon, so the map would silently drop them —
//      take the geocode's ZCTA instead.
//   3. Far apart with no consensus. Use the city as the tiebreaker: whichever
//      ZIP's area actually contains clinics in that city wins.
//   4. Otherwise keep what they published.

const normSite = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function milesBetween(a, b) {
  const R = 3958.8, t = Math.PI / 180;
  const dLat = (b[1] - a[1]) * t, dLon = (b[0] - a[0]) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function buildLocationResolver({ zipIndex, zctaGeojson, allLocations }) {
  const centroid = new Map();
  for (const f of zctaGeojson.features) {
    const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    let sx = 0, sy = 0, n = 0;
    for (const p of polys) for (const [x, y] of p[0]) { sx += x; sy += y; n += 1; }
    centroid.set(f.properties.zip, [sx / n, sy / n]);
  }
  // consensus ZIP per physical clinic, and which cities sit in each ZCTA
  const site = new Map(), cityOf = new Map();
  for (const l of allLocations) {
    const k = `${normSite(l.name)}|${normSite(l.addr ?? l.address1)}`;
    if (!site.has(k)) site.set(k, new Map());
    const z = String(l.zip ?? l.zipCode ?? "").slice(0, 5);
    site.get(k).set(z, (site.get(k).get(z) ?? 0) + 1);
    const geo = locate(zipIndex, l.lon, l.lat);
    if (geo && l.city) {
      if (!cityOf.has(geo)) cityOf.set(geo, new Set());
      cityOf.get(geo).add(normSite(l.city));
    }
  }
  const consensus = new Map();
  for (const [k, m] of site) {
    const [zip, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    consensus.set(k, { zip, n, total: [...m.values()].reduce((a, b) => a + b, 0) });
  }

  return function resolve(loc) {
    const published = String(loc.zip ?? "").slice(0, 5);
    const geo = locate(zipIndex, loc.lon, loc.lat);
    const key = `${normSite(loc.name)}|${normSite(loc.addr)}`;
    const con = consensus.get(key);

    if (con && con.total > 1 && con.zip && con.zip !== published) return { zip: con.zip, why: "clinic consensus" };
    if (!centroid.has(published) && geo) return { zip: geo, why: "published ZIP has no polygon" };
    if (geo && geo !== published && centroid.has(published)) {
      const d = milesBetween(centroid.get(published), [loc.lon, loc.lat]);
      if (d > 25) {
        const city = normSite(loc.city);
        const pubHasCity = cityOf.get(published)?.has(city);
        const geoHasCity = cityOf.get(geo)?.has(city);
        if (geoHasCity && !pubHasCity) return { zip: geo, why: `published ZIP is ${d.toFixed(0)}mi away and the city matches the geocode` };
      }
    }
    return { zip: published, why: null };
  };
}
