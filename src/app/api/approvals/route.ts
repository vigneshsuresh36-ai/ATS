import { canViewScopedRequisition, scopeDepartments } from "@/lib/requisitionScope";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { getRequisition, listCandidates, listRequisitions, listUsers } from "@/lib/db";
import { canApprove } from "@/lib/roles";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role === "Recruiter") {
      const candidates = (await listCandidates()).filter(
        (candidate) => candidate.offerRequestedBy === user.email && !!candidate.offerApprovalStatus
      );
      const offerApprovals = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        requisition: await getRequisition(candidate.reqId),
      })));
      return json({ requisitions: [], offerApprovals });
    }
    if (user.role === "HiringManager") {
      const requisitions = (await listRequisitions({ raisedByEmail: user.email })).filter((request) => canViewScopedRequisition(user, request));
      const requisitionIds = new Set(requisitions.map((requisition) => requisition.id));
      const candidates = (await listCandidates()).filter(
        (candidate) => requisitionIds.has(candidate.reqId) && !!candidate.offerApprovalStatus
      );
      const offerApprovals = await Promise.all(candidates.map(async (candidate) => ({
        candidate,
        requisition: await getRequisition(candidate.reqId),
      })));
      return json({ requisitions, offerApprovals });
    }
    if (!canApprove(user.role)) {
      throw new ApiError(403, "Department Head role required.");
    }
    const pending = user.role === "Admin"
      ? await listRequisitions({ status: "PendingApproval" })
      : await listRequisitions({ departments: scopeDepartments(user), status: "PendingApproval" });
    const requisitions = pending.filter((request) => canViewScopedRequisition(user, request));
    let candidates = (await listCandidates()).filter((candidate) => candidate.offerApprovalStatus === "Pending");
    if (user.role === "Admin") {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      const allRequisitions = await listRequisitions();
      const visibleReqIds = new Set(allRequisitions
        .filter((requisition) => !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail))
        .map((requisition) => requisition.id));
      candidates = candidates.filter((candidate) => visibleReqIds.has(candidate.reqId));
    }
    const offerApprovals = (await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      requisition: await getRequisition(candidate.reqId),
    })))).filter(({ requisition }) =>
      user.role === "Admin" || !!requisition && canViewScopedRequisition(user, requisition)
    );
    return json({ requisitions, offerApprovals });
  } catch (e) {
    return errResponse(e);
  }
}
