// The comparability rules behind the Comparison filters. Every published Florida slot stays in the
// data and is shown by default; each filter narrows both systems the same way.
//
// 1. Physicians only. AdventHealth opens nurse practitioners, physician assistants, nurse and
//    medical-assistant visit templates and pharmacists to online booking; Orlando Health opens
//    physicians only.
// 2. In-person only. AdventHealth publishes video visits online; Orlando Health publishes none
//    without a login. A slot bookable only as a video visit is hidden; one bookable in person and by
//    video stays, as an in-person slot.
// 3. New patients only. Both systems publish new-patient and existing-patient visit types; this cut
//    keeps the visit types a new patient can book, on both sides.
//
// Decided with Thomas on 2026-09-15 (defaults: everything shown). The data check on every page
// reports the mix these act on.
import { isNewPatientType, isTelemedicineSlot } from "./slot-times/data.js";

export const COUNTED_CREDENTIALS = new Set(["Physician"]);
export const FILTER_DEFAULTS = { physiciansOnly: false, inPersonOnly: false, newPatientOnly: false };

export function isPhysicianSlot(row) {
  return COUNTED_CREDENTIALS.has(String(row?.provider_credentials ?? "").trim());
}

// The visit types a row can be booked under, whichever pipeline field carries them.
export function visitTypesOf(row) {
  const raw = row?.appointment_types ?? row?.booking_categories ?? row?.matching_visit_types ?? row?.visit_types ?? "";
  return String(raw).split("|").map((type) => type.trim()).filter(Boolean);
}

export function isTelemedicineOnlySlot(row) {
  return isTelemedicineSlot(visitTypesOf(row));
}

export function isNewPatientSlot(row) {
  return visitTypesOf(row).some(isNewPatientType);
}

// The strictest like-for-like cut: physicians, in person (what the filters give when both are on).
export function isComparableSlot(row) {
  return isPhysicianSlot(row) && !isTelemedicineOnlySlot(row);
}
