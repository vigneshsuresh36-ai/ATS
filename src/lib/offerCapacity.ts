import type { Candidate } from "./types";

/** An approved offer occupies one opening until the application is withdrawn or rejected. */
export function occupiesOfferOpening(candidate: Pick<Candidate, "stage" | "offerApprovalStatus">) {
  if (["Candidate Backed Out", "Rejected", "Social CV Reject"].includes(candidate.stage)) return false;
  return candidate.offerApprovalStatus === "Approved" || ["OfferApproved", "Offered", "Onboarded"].includes(candidate.stage);
}

export function remainingOfferOpenings(openings: number, candidates: Pick<Candidate, "stage" | "offerApprovalStatus">[]) {
  return Math.max(0, Math.max(0, openings || 0) - candidates.filter(occupiesOfferOpening).length);
}
