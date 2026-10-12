import type { InquiryRow } from "./parse";

/** Where an inquiry stands in the funnel. */
export type LeadState = "served" | "noShow" | "cancelled" | "booked" | "lost" | "open";

export const LEAD_STATES: { key: LeadState; label: string; color: string }[] = [
  { key: "served", label: "Served", color: "var(--s1)" },
  { key: "booked", label: "Booked, not yet served", color: "var(--s2)" },
  { key: "noShow", label: "No-show", color: "var(--s3)" },
  { key: "cancelled", label: "Cancelled", color: "var(--s4)" },
  { key: "open", label: "Open lead (not booked)", color: "var(--neutral)" },
  { key: "lost", label: "Lost", color: "var(--neutral-soft)" },
];

const LOST = /NO FURTHER ACTION|CHOSE ANOTHER|ANOTHER (FACILITY|CLINIC|HOSPITAL)|TOO FAR|NOT INTERESTED|DECLINED|NO LONGER|LOST|UNREACHABLE|WRONG NUMBER/i;
const CANCELLED = /CANCEL/i;

export function leadState(row: InquiryRow): LeadState {
  const notes = `${row.action} ${row.remarks} ${row.status}`;
  if (row.served) return "served";
  if (row.noShow) return "noShow";
  if (row.booked) return CANCELLED.test(notes) ? "cancelled" : "booked";
  return LOST.test(notes) ? "lost" : "open";
}

/** Leads staff still need to contact: open leads, and no-shows to reschedule. */
export const needsFollowUp = (row: InquiryRow) => {
  const state = leadState(row);
  return state === "open" || state === "noShow";
};
