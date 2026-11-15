import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { getCandidate, getRequisition } from "@/lib/db";
import { requireAdminDb } from "@/lib/firebaseAdmin";

async function access(req: NextRequest, id: string) {
  const user = await requireUser(req);
  const candidate = await getCandidate(id);
  if (!candidate) throw new ApiError(404, "Candidate not found.");
  const requisition = await getRequisition(candidate.reqId);
  if (!requisition) throw new ApiError(404, "Requisition not found.");
  await requireManagedRequisitionAccess(user, requisition);
  if (user.role === "HiringManager" && requisition.raisedByEmail !== user.email) throw new ApiError(403, "Not your requisition.");
  if (user.role === "DepartmentHead" && !user.departments.some((department) => department.toLowerCase() === requisition.department.toLowerCase())) throw new ApiError(403, "Not your department.");
  if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
  return user;
}
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params;
    await access(req, id);
    const snapshot = await requireAdminDb().collection("candidates").doc(id).collection("comments").orderBy("createdAt", "desc").get();
    return Response.json({ comments: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errResponse(error); }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const user = await access(req, id);
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 3000) throw new ApiError(400, "Enter a comment of up to 3,000 characters.");
    const ref = requireAdminDb().collection("candidates").doc(id).collection("comments").doc();
    const comment = { text, author: user.email, createdAt: new Date().toISOString() };
    await ref.set(comment);
    return Response.json({ comment: { id: ref.id, ...comment } }, { status: 201 });
  } catch (error) { return errResponse(error); }
}
