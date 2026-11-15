import type { ApprovalStatus } from "@/lib/types";

export const CLOSED_REQUISITION_STATUSES = new Set<ApprovalStatus>([
  "Position Closed",
  "Position Fulfilled",
  "Closed",
]);

export function isRequisitionClosed(status: ApprovalStatus) {
  return CLOSED_REQUISITION_STATUSES.has(status);
}

export function isRequisitionOpenForRecruiting(status: ApprovalStatus) {
  return status === "Approved" || status === "Position Reopened" || status === "Partially Fulfilled";
}

export function canEditRequisitionPriority(status: ApprovalStatus) {
  return isRequisitionOpenForRecruiting(status);
}