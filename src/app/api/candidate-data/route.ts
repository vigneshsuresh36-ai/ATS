import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { addAudit, getCandidate, getRequisition, listCandidates, listRequisitions, listUsers, updateCandidate } from "@/lib/db";

const terminal = new Set(["Rejected", "Social CV Reject", "Candidate Backed Out", "Onboarded"]);
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role !== "Admin") throw new ApiError(403, "Admin only.");
    const [candidates, requisitions, users] = await Promise.all([listCandidates(undefined, true), listRequisitions(), listUsers()]);
    const managed = new Set(users.filter((member) => member.role === "Recruiter" && member.managerEmail === user.email).map((member) => member.email));
    const visible = new Map(requisitions.filter((req) => !req.recruiterEmail || managed.has(req.recruiterEmail)).map((req) => [req.id, req]));
    return json({ candidates: candidates.filter((candidate) => visible.has(candidate.reqId) && (candidate.archived || terminal.has(candidate.stage))).map((candidate) => ({ id: candidate.id, name: candidate.name, stage: candidate.stage, archived: candidate.archived, updatedAt: candidate.updatedAt, role: visible.get(candidate.reqId)?.title || "" })).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)) });
  } catch (error) { return errResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role !== "Admin") throw new ApiError(403, "Admin only.");
    const body = await request.json();
    if (typeof body.id !== "string" || typeof body.archived !== "boolean") throw new ApiError(400, "Choose a candidate and action.");
    const candidate = await getCandidate(body.id);
    if (!candidate) throw new ApiError(404, "Candidate not found.");
    const requisition = await getRequisition(candidate.reqId);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (body.archived && !terminal.has(candidate.stage)) throw new ApiError(400, "Only completed or closed profiles can be archived here.");
    await updateCandidate(candidate.id, { archived: body.archived });
    await addAudit({ action: body.archived ? "candidate.archive" : "candidate.restore", actorEmail: user.email, actingAdminEmail: user.actingAdminEmail, entityType: "candidate", entityId: candidate.id, detail: candidate.stage });
    return json({ ok: true });
  } catch (error) { return errResponse(error); }
}
