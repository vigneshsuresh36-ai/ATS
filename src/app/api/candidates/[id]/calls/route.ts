import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { getCandidate, getRequisition } from "@/lib/db";
import { requireAdminDb } from "@/lib/firebaseAdmin";
import { outcomesFor, type ContactType } from "@/lib/callLog";

async function access(req: NextRequest, id: string) {
  const user = await requireUser(req);
  if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Only recruiters can log calls.");
  const candidate = await getCandidate(id);
  if (!candidate) throw new ApiError(404, "Candidate not found.");
  const requisition = await getRequisition(candidate.reqId);
  if (!requisition) throw new ApiError(404, "Requisition not found.");
  await requireManagedRequisitionAccess(user, requisition);
  if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
  return user;
}
type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params;
    await access(req, id);
    const snapshot = await requireAdminDb().collection("candidates").doc(id).collection("calls").orderBy("createdAt", "desc").limit(50).get();
    return Response.json({ calls: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errResponse(error); }
}

export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const user = await access(req, id);
    const body = await req.json();
    const type: ContactType = body.type === "email" ? "email" : "call";
    const outcome = typeof body.outcome === "string" ? body.outcome : "";
    if (!outcomesFor(type).includes(outcome)) throw new ApiError(400, type === "email" ? "Choose how the email went." : "Choose how the call went.");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 1000) throw new ApiError(400, "Keep the note under 1,000 characters.");
    const ref = requireAdminDb().collection("candidates").doc(id).collection("calls").doc();
    const call = { type, outcome, note, author: user.email, createdAt: new Date().toISOString() };
    await ref.set(call);
    return Response.json({ call: { id: ref.id, ...call } }, { status: 201 });
  } catch (error) { return errResponse(error); }
}
