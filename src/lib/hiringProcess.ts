import type { ApprovalStatus, CandidateStage } from "./types";

const candidateSteps: Partial<Record<CandidateStage, number>> = {
  "Social CV": 2, "Social CV Reject": 2, New: 2, Screened: 2, Shortlist: 2,
  PendingHMApproval: 3, HMApproved: 3,
  Interview: 4, "Interview Scheduled": 4, Debrief: 4, Selected: 4,
  OfferApprovalPending: 5, OfferApproved: 5, Offered: 6, Onboarded: 6,
};

export function hiringProcessStep(status: ApprovalStatus, stages: CandidateStage[], hasInterviews: boolean): number {
  const candidateProgress = Math.max(-1, ...stages.map((stage) => candidateSteps[stage] ?? -1));
  if (candidateProgress >= 0) return Math.max(candidateProgress, hasInterviews ? 4 : 0);
  if (hasInterviews) return 4;
  if (["Closed", "Position Closed", "Position Fulfilled"].includes(status)) return 6;
  if (["Approved", "Position Reopened", "Partially Fulfilled"].includes(status)) return 2;
  return status === "PendingApproval" || status === "Rejected" ? 1 : 0;
}
