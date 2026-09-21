// `npm run build`: builds every specialty that has data, cardiology first. A specialty counts as published when
// its slot export, its local slot model or its published summary exists; the rest are left to
// pages/shared/specialty-placeholders.js, which `npm run build` runs right after this script. Each step is run
// once per specialty with `--specialty <id>`, so the individual npm scripts keep working unchanged.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, SPECIALTIES, specialtyPaths } from "../pages/shared/specialties.js";

const STEPS = [
  "scripts/build-slot-times-data.mjs",
  "scripts/build-slot-partitions.mjs",
  "pages/provider-index/render.js",
  "pages/slot-availability/render.js",
  "pages/market-opportunities/render.js",
];

export const isPublished = (specialty) => {
  const paths = specialtyPaths(specialty);
  return [paths.export, paths.model, paths.summary].some((path) => existsSync(join(ROOT, path)));
};

export function buildSpecialties(specialties = SPECIALTIES) {
  const built = [];
  for (const specialty of specialties) {
    if (!isPublished(specialty)) { console.log(`${specialty.label}: no data published yet; placeholder pages only`); continue; }
    for (const step of STEPS) {
      const result = spawnSync(process.execPath, [step, "--specialty", specialty.id], { cwd: ROOT, stdio: "inherit" });
      if (result.status !== 0) throw new Error(`${step} failed for ${specialty.id} (exit ${result.status ?? "signal"})`);
    }
    built.push(specialty.id);
  }
  return built;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { buildSpecialties(); } catch (error) { console.error(error.message); process.exit(1); }
}
