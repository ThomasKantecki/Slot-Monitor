// The specialties the dashboards can show. Cardiology is published at the site root; every other
// specialty lives in its own folder (public/<id>/) with the same three page names, and its data
// under public/data/<id>/. A specialty whose data is not published yet still gets its pages, as
// placeholders (src/shared/specialty-placeholders.js), so the header's specialty menu always works.
export const SPECIALTIES = [
  { id: "cardiology", label: "Cardiology", folder: "", dataDir: "data/cardiology", emblem: "heart" },
  { id: "orthopedics", label: "Orthopedics", folder: "orthopedics/", dataDir: "data/orthopedics", emblem: "bone" },
];

export function specialtyOf(id) {
  const specialty = SPECIALTIES.find((candidate) => candidate.id === id);
  if (!specialty) throw new Error(`Unknown specialty: ${id}`);
  return specialty;
}

// The relative address of `file` under specialty `to`, from a page under specialty `from`. The
// site is one folder deep: the root for Cardiology, one folder for everything else.
export function specialtyHref(from, to, file) {
  if (from.id === to.id) return `./${file}`;
  if (!from.folder) return `./${to.folder}${file}`;
  return to.folder ? `../${to.folder}${file}` : `../${file}`;
}
