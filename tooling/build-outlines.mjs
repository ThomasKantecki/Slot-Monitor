// Derive a clean state outline from a layer's OWN geometry so the coast border
// traces exactly what's drawn (no clip-over/miss from a mismatched source).
// Input: a mapshaper-dissolved geojson of the layer. Output: outer rings only
// (interior holes — lakes, the Everglades — dropped so the border stays the coast).
import { readFileSync, writeFileSync } from "node:fs";

const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };

function outerOnly(inPath, outPath, minArea = 0.00003) {
  const g = JSON.parse(readFileSync(inPath, "utf8"));
  const geoms = [];
  const walk = (o) => {
    if (!o) return;
    if (o.type === "FeatureCollection") o.features.forEach(walk);
    else if (o.type === "Feature") walk(o.geometry);
    else if (o.type === "GeometryCollection") o.geometries.forEach(walk);
    else if (o.type === "Polygon" || o.type === "MultiPolygon") geoms.push(o);
  };
  walk(g);
  const rings = [];
  for (const geom of geoms) {
    const parts = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
    for (const poly of parts) { const outer = poly[0]; if (outer && ringArea(outer) > minArea) rings.push([outer]); }
  }
  writeFileSync(outPath, JSON.stringify({ type: "GeometryCollection", geometries: rings.map((r) => ({ type: "Polygon", coordinates: r })) }));
  console.log(`${outPath} -> ${rings.length} outer rings`);
}

outerOnly(process.argv[2], process.argv[3]);
