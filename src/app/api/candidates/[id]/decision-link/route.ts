import { NextRequest } from "next/server";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { getCandidate, getRequisition } from "@/lib/db";
import { createDecisionToken } from "@/lib/decisionLink";

type Ctx = { params: Promise<{ id: string }> };

/** Creates a one-tap approval link a recruiter can send to the hiring manager. */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Only recruiters can create approval links.");
    const candidate = await getCandidate(id);
    if (!candidate) throw new ApiError(404, "Candidate not found.");
    const requisition = await getRequisition(candidate.reqId);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
    if (candidate.stage !== "PendingHMApproval") throw new ApiError(400, "This candidate is not waiting for hiring manager approval.");
    const url = `${req.nextUrl.origin}/decide/${createDecisionToken(candidate.id)}`;
    return json({ url, managerEmail: requisition.raisedByEmail, expiresInDays: 7 });
  } catch (error) {
    return errResponse(error);
  }
}
