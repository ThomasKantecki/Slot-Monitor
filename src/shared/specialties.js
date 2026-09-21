// The specialties the dashboards can show, read from specialties.json so the Python extractor and the
// Node scripts share one list. Cardiology is published at the site root; every other specialty lives in
// its own folder (public/<id>/) with the same three page names and its data under public/data/<id>/.
// A specialty whose data is not published yet still gets its pages, as placeholders
// (src/shared/specialty-placeholders.js), so the header's specialty menu always works.
//
// Per entry: `catalog` = the Epic anonymous-scheduling specialty names each system's extractor pulls
// (extractors/cardiology/catalog_probe.py lists what a catalog offers); `roster` = the directory labels
// the Provider Index counts together under `group` (src/provider-index-people.js).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const SPECIALTIES = JSON.parse(readFileSync(join(HERE, "specialties.json"), "utf8"))
  .map((entry) => ({ ...entry, dataDir: `data/${entry.id}` }));

export function specialtyOf(id) {
  const specialty = SPECIALTIES.find((candidate) => candidate.id === id);
  if (!specialty) throw new Error(`Unknown specialty: ${id}`);
  return specialty;
}

// `--specialty <id>` on a build script's command line; cardiology when absent.
export function specialtyFromArgv(argv = process.argv) {
  const index = argv.indexOf("--specialty");
  return specialtyOf(index > 0 ? argv[index + 1] : "cardiology");
}

// The relative address of `file` under specialty `to`, from a page under specialty `from`. The
// site is one folder deep: the root for Cardiology, one folder for everything else.
export function specialtyHref(from, to, file) {
  if (from.id === to.id) return `./${file}`;
  if (!from.folder) return `./${to.folder}${file}`;
  return to.folder ? `../${to.folder}${file}` : `../${file}`;
}

// Every path a specialty's pipeline reads or writes, relative to the repository root. `partitionBase`
// is the page-relative address of the per-day slot files, from that specialty's own pages.
export function specialtyPaths(specialty) {
  const { id, folder } = specialty;
  const depth = folder.split("/").filter(Boolean).length;
  return {
    extractions: `data/${id}/extractions`,
    runs: `data/${id}/runs`,
    current: `data/${id}/current`,
    export: `data/${id}/current/${id}-physical-slots.json`,
    exportCsv: `data/${id}/current/${id}-physical-slots.csv`,
    model: `data/${id}/current/slot-times-model.json`,
    manifest: `data/${id}/current/manifest.json`,
    publicData: `public/data/${id}`,
    summary: `public/data/${id}/slot-times-summary.json`,
    slots: `public/data/${id}/slots`,
    pages: `public/${folder}`,
    partitionBase: `${"../".repeat(depth)}data/${id}/slots`,
  };
}

// Page copy that differs by specialty and that the Python side never needs.
export const COPY = {
  cardiology: {
    newPatientTip: "Keeps only the visit types a new patient can book: New Patient and New Cardiology Patient visits, and ED follow-up visits for new patients. Both systems also publish visits for existing patients, so use this to compare new-patient access.",
    rosterNote: "counting general, interventional, electrophysiology, heart failure and imaging cardiology together. Pediatric cardiology and cardiac surgery are not shown.",
  },
  orthopedics: {
    newPatientTip: "Keeps only the visit types a new patient can book. Both systems also publish visits for existing patients, so use this to compare new-patient access.",
    rosterNote: "counting orthopedic surgery and its spine, hand, foot and joint sub-specialties, non-surgical orthopedics and sports medicine together. Pediatric orthopedics, podiatry, neurosurgery, pain management and physical medicine are not shown unless the directory also lists the clinician under an orthopedic label.",
  },
};
export const copyOf = (specialty) => COPY[specialty.id] ?? COPY.cardiology;
