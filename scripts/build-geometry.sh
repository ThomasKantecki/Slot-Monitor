#!/usr/bin/env bash
# One-time: download Florida ZIP (ZCTA) boundaries and simplify to an embeddable
# GeoJSON. Re-run only when the Census geometry changes. Needs mapshaper (npx).
set -euo pipefail
cd "$(dirname "$0")/.."

curl -sL -o data/raw/fl-zips-raw.json \
  "https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/fl_florida_zip_codes_geo.min.json"

# -clean rebuilds topology and snaps coincident borders BEFORE simplifying, so
# adjacent ZIPs share exact edges and no sliver gaps open up between them. Without
# it, simplification pulls shared borders apart and the map fills with holes.
npx --yes mapshaper data/raw/fl-zips-raw.json \
  -clean \
  -simplify weighted 10% keep-shapes \
  -each 'zip=ZCTA5CE10' \
  -filter-fields zip \
  -o precision=0.0001 format=geojson data/geography/fl-zcta.geojson

echo "wrote data/geography/fl-zcta.geojson"

# County crosswalk (Census 2020 ZCTA->county relationship)
curl -sL -o data/raw/zcta-county.txt \
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
node scripts/build-county.mjs

# FL boundary = dissolved counties (solid silhouette; counties fill the interior
# lakes, so the coast has no excursion around the no-ZIP Lake Okeechobee /
# Everglades regions the way a dissolved-ZCTA outline would).
BOUNDARY="$(mktemp -d)/fl-boundary.geojson"
npx --yes mapshaper data/geography/fl-county.geojson -dissolve2 -o "$BOUNDARY"
# Clip ZIPs to that boundary so coastal ZIPs align to the true coast (no overhang
# past the border). Re-run safe: the simplify step above rewrites fl-zcta first.
npx --yes mapshaper data/geography/fl-zcta.geojson -clip "$BOUNDARY" -clean -o force data/geography/fl-zcta.geojson
# One coast outline (outer rings of the boundary) used for both layers.
node scripts/build-outlines.mjs "$BOUNDARY" data/geography/florida-outline.geojson
rm -rf "$(dirname "$BOUNDARY")"
