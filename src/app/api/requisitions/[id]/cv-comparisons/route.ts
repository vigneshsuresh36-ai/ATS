import { createHash } from "node:crypto";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { assistantRequisitions } from "@/lib/assistantAccess";
import { getRequisition, listCandidates, listUsers } from "@/lib/db";
import { requireAdminDb } from "@/lib/firebaseAdmin";

type Context = { params: Promise<{ id: string }> };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    if (!["Admin", "Recruiter", "HiringManager", "DepartmentHead"].includes(user.role)) throw new ApiError(403, "Comparison results are unavailable for this role.");
    const { id } = await context.params;
    const [requisition, users, candidates] = await Promise.all([getRequisition(id), listUsers(), listCandidates(id)]);
    if (!requisition || !assistantRequisitions(user, [requisition], users).length) throw new ApiError(404, "This position is unavailable in your workspace.");
    const snapshot = await requireAdminDb().collection("requisitions").doc(id).collection("cv_comparisons").get();
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const results = snapshot.docs.flatMap((doc) => {
      const candidate = candidateById.get(doc.id);
      if (!candidate) return [];
      const record = doc.data();
      const stale = record.jdHash !== digest(requisition.jdText || "") || record.cvHash !== digest(candidate.cvPath || "");
      return [{ id: candidate.id, cvPath: candidate.cvPath || "", requisitionJdText: requisition.jdText || "", stale, status: record.status, message: record.message, score: record.score ?? null, items: record.items ?? [] }];
    });
    return json({ results });
  } catch (error) { return errResponse(error); }
}
