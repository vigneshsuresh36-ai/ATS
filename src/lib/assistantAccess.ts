import type { AppUser, Candidate, Requisition } from "./types";
import { permittedAutomationRequests } from "./automationAccess";
import { canViewScopedRequisition } from "./requisitionScope";

export function assistantRequisitions(user: AppUser, requisitions: Requisition[], users: AppUser[]): Requisition[] {
  if (user.role === "Admin" || user.role === "Recruiter") return permittedAutomationRequests(user, requisitions, users);
  if (user.role === "HiringManager" || user.role === "DepartmentHead") return requisitions.filter((r) => canViewScopedRequisition(user, r));
  return [];
}

/** Call only after restricting candidates to requisitions the user can access. */
export function canIncludePendingOffer(user: AppUser, candidate: Candidate): boolean {
  return candidate.offerApprovalStatus === "Pending" && (user.role === "Admin" || user.role === "DepartmentHead" || user.role === "HiringManager" || (user.role === "Recruiter" && candidate.offerRequestedBy === user.email));
}
