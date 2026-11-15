import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { ApiError, requireUser } from "@/lib/auth";
import { getCandidate, getOrg, getRequisition, listRequisitions, listUsers } from "@/lib/db";
import type { AppUser, Candidate, Requisition } from "@/lib/types";

export async function requireOfferJoiningUser(request: Request): Promise<AppUser> {
  const user = await requireUser(request);
  if (user.role !== "Admin" && user.role !== "Recruiter") {
    throw new ApiError(403, "Offer & Joining is available to Admins and Recruiters.");
  }
  if (!(await getOrg()).offerJoiningEnabled) {
    throw new ApiError(404, "Offer & Joining is not enabled for this organization.");
  }
  return user;
}

export async function listAccessibleJoiningRequisitions(user: AppUser): Promise<Requisition[]> {
  const requisitions = await listRequisitions();
  if (user.role === "Recruiter") {
    return requisitions.filter((requisition) => isAssignedRecruiter(requisition, user.email));
  }
  const teamEmails = new Set((await listUsers())
    .filter((member) => member.role === "Recruiter" && member.managerEmail?.toLowerCase() === user.email.toLowerCase())
    .map((member) => member.email.toLowerCase()));
  return requisitions.filter((requisition) =>
    !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail.toLowerCase())
  );
}

export async function requireAccessibleJoiningCandidate(
  user: AppUser,
  candidateId: string,
  requisitions?: Requisition[],
): Promise<{ candidate: Candidate; requisition: Requisition }> {
  const candidate = await getCandidate(candidateId);
  if (!candidate || candidate.archived) throw new ApiError(404, "Candidate not found.");
  const requisition = await getRequisition(candidate.reqId);
  if (!requisition) throw new ApiError(404, "Requisition not found.");
  const accessible = requisitions || await listAccessibleJoiningRequisitions(user);
  if (!accessible.some((item) => item.id === requisition.id)) {
    throw new ApiError(403, "This candidate is outside your joining-management access.");
  }
  if (!(["Offered", "Onboarded"].includes(candidate.stage) || candidate.joiningStatus || candidate.initialDoj || candidate.currentDoj)) {
    throw new ApiError(404, "This candidate is not eligible for Offer & Joining.");
  }
  return { candidate, requisition };
}