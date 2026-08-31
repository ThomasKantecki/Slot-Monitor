// One clinical vocabulary for both systems. Each directory names the same
// medicine differently (AH "OBGYN" vs OH "Obstetrics and Gynecology"; AH
// "Cardiovascular Disease" vs OH "Cardiology") and OH's own list carries
// internal duplicates ("Surgery - General" vs "General Surgery"), so the
// specialty filter would show each side as having nobody in the other's
// column. Canonical names below are the OH spelling wherever a pair exists.
// Merges are same-medicine only: hospital-based variants are NOT collapsed
// into clinic specialties, and Orthopedics (non-surgical) stays distinct
// from Orthopedic Surgery.
const VARIANTS = new Map(Object.entries({
  "Obstetrics and Gynecology": ["OBGYN", "Obstetrics & Gynecology"],
  "Gastroenterology (GI)": ["Gastroenterology"],
  "Cardiology": ["Cardiovascular Disease"],
  "Endocrinology, Diabetes and Metabolism": ["Endocrinology"],
  "Cardiothoracic Surgery": ["Cardiovascular and Thoracic Surgery"],
  "Pediatrics": ["Pediatric Medicine"],
  "Cardiology - Interventional": ["Interventional Cardiology"],
  "Cancer - Radiation Oncology": ["Radiation Oncology"],
  "Ear Nose and Throat (ENT - Otolaryngology)": ["Otolaryngology", "Otolaryngology (ENT)"],
  "Gynecology (GYN)": ["Gynecology"],
  "Plastic and Reconstructive Surgery": ["Plastic Surgery"],
  "Bariatric Surgery (Weight Loss Surgery)": ["Bariatric Surgery", "Surgery - Weight Loss (Bariatrics)"],
  "Maternal-Fetal Medicine": ["Maternal Fetal Medicine"],
  "Palliative and Supportive Care": ["Palliative Care"],
  "Pulmonology": ["Pulmonary Disease"],
  "Nephrology (Kidney)": ["Nephrology"],
  "Hepatology (Liver)": ["Hepatology"],
  "Pediatric Gastroenterology (GI)": ["Pediatric Gastroenterology"],
  "Pediatric Endocrinology, Diabetes and Metabolism": ["Pediatric Endocrinology"],
  "Pediatric Ear Nose and Throat (ENT)": ["Pediatric Otolaryngology"],
  "General Surgery": ["Surgery - General"],
  "Breast Surgery": ["Surgery - Breast"],
  "Infectious Diseases": ["Infectious Disease"],
  "Nurse Midwife": ["Certified Nurse Midwife"],
  "Neurosurgery": ["Neurological Surgery"],
  "Cancer - Gynecologic": ["Gynecologic Oncology"],
  "Cardiology - Electrophysiology": ["Clinical Cardiac Electrophysiology"],
  "Cardiology - Advanced Heart Failure": ["Advanced Heart Failure and Transplant Cardiology"],
  "Cancer - Surgery": ["Surgery - Cancer", "Surgical Oncology"],
  "Pediatric and Adolescent Psychiatry": ["Pediatric Psychiatry"],
  "Obesity Medicine": ["Weight Management"],
}));
const LOOKUP = new Map();
for (const [canon, aliases] of VARIANTS) for (const a of aliases) LOOKUP.set(a.toLowerCase(), canon);

export const canonicalSpecialty = (name) => {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  return LOOKUP.get(s.toLowerCase()) ?? s;
};

// The map's population: clinicians a patient can actually book. Both
// directories list clinic-facing care (including audiology, behavioral
// health, midwives, clinic NPs/PAs); only Orlando Health's also lists its
// hospital machinery — anesthesia teams, hospitalists, reading-room
// radiology, PT/nutrition support, surgical assists — which AdventHealth's
// consumer directory omits entirely. Counting those on one side only would
// distort every per-area comparison, so ONE rule excludes them from both.
const NONBOOKABLE = new Set([
  "Physical Therapy", "Speech Language Pathology", "Dietitian", "Nutrition",
  "Pediatric Nutrition", "Nurse Anesthetist", "Anesthesiologist Assistant",
  "Nuclear Medicine", "Neuroradiology", "Cardiovascular Imaging",
  "Not Specified",
]);
export const isBookable = (name) => {
  const s = String(name ?? "");
  if (/\(Hospital-Based\)/i.test(s)) return false;
  if (/^(Pediatric )?Radiology\b/.test(s)) return false;
  if (/^Pathology\b/.test(s)) return false;
  return !NONBOOKABLE.has(s);
};
