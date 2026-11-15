import { ApiError, errResponse, json } from "@/lib/auth";
import { addAudit, getCandidate, getRequisition, updateCandidate } from "@/lib/db";
import { readDecisionToken } from "@/lib/decisionLink";
import type { CandidateStage } from "@/lib/types";

type Ctx = { params: Promise<{ token: string }> };

async function load(token: string) {
  const id = readDecisionToken(token);
  if (!id) throw new ApiError(404, "This approval link is invalid or has expired. Ask the recruiter for a new one.");
  const candidate = await getCandidate(id);
  if (!candidate) throw new ApiError(404, "Candidate not found.");
  const requisition = await getRequisition(candidate.reqId);
  if (!requisition) throw new ApiError(404, "Requisition not found.");
  return { candidate, requisition };
}

/** Summary for the hiring manager. It leaves out contact details on purpose. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const { candidate, requisition } = await load(token);
    return json({
      pending: candidate.stage === "PendingHMApproval",
      outcome: candidate.stage === "PendingHMApproval" ? null : candidate.stage === "Rejected" ? "rejected" : "approved",
      candidate: {
        name: candidate.name,
        location: candidate.location,
        experienceYears: candidate.experienceYears,
        notice: candidate.notice,
        expectedCtc: candidate.expectedCtc,
        currentCtc: candidate.currentCtc,
        skills: candidate.skills || [],
        source: candidate.source,
      },
      role: { title: requisition.title, department: requisition.department, location: requisition.location },
    });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const { candidate, requisition } = await load(token);
    if (candidate.stage !== "PendingHMApproval") throw new ApiError(400, "A decision has already been recorded for this candidate.");
    const body = await req.json().catch(() => ({}));
    const approve = body.decision === "approve";
    if (!approve && body.decision !== "reject") throw new ApiError(400, "Choose approve or reject.");
    const reason = approve ? undefined : (typeof body.reason === "string" && body.reason.trim().slice(0, 500)) || "Rejected by hiring manager";
    const actor = `${requisition.raisedByEmail} (approval link)`;
    const to: CandidateStage = approve ? "HMApproved" : "Rejected";
    await updateCandidate(candidate.id, { stage: to, hmDecisionBy: actor, hmDecisionAt: new Date().toISOString(), hmRejectReason: reason }, { byEmail: actor, from: candidate.stage, to });
    await addAudit({ action: approve ? "candidate.hm_approve" : "candidate.hm_reject", actorEmail: actor, entityType: "candidate", entityId: candidate.id, detail: reason });
    return json({ ok: true, outcome: approve ? "approved" : "rejected" });
  } catch (error) {
    return errResponse(error);
  }
}
