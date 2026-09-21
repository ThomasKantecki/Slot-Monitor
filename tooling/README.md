# tooling/

Rarely-run helpers and the Python launcher. None of these are part of a normal refresh.

| Command | File | What it does |
|---|---|---|
| `npm run geometry` | `build-geometry.sh` | Downloads the Census ZIP shapes, simplifies them, clips them to the state and writes `data/geography/` (needs the network and `npx mapshaper`). `fl-county.geojson` is a committed input it does not rewrite. |
| (called by geometry) | `build-county.mjs` | Builds `data/geography/zip-county.json` from the Census ZIP-to-county file. |
| (called by geometry) | `build-outlines.mjs` | Extracts the coast outline (outer rings) from a dissolved shape. |
| `npm run fonts` | `embed-fonts.mjs` | Downloads the two web fonts and writes them base64-embedded into `assets/fonts.css`. |
| (used by every Python command) | `run-python.mjs` | Finds a Python 3 interpreter (`SLOT_MONITOR_PYTHON`, then `.venv/`, then `python3` on the PATH) and runs an `extractor/` script with it. |
