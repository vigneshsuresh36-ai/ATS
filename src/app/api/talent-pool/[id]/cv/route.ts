import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, requireUser } from "@/lib/auth";
import { getCandidate, getRequisition, listUsers } from "@/lib/db";
import { UNASSIGNED_TALENT_POOL_REQ_ID } from "@/lib/talentPool";
import { adminStorage } from "@/lib/firebaseAdmin";

type Ctx = { params: Promise<{ id: string }> };
const OPEN_STATUSES = new Set(["Approved", "Position Reopened", "Partially Fulfilled"]);

function contentTypeForName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can access Talent Pool resumes.");
    }
    const { id } = await ctx.params;
    const candidate = await getCandidate(id);
    if (!candidate) throw new ApiError(404, "Candidate not found.");

    if (candidate.reqId !== UNASSIGNED_TALENT_POOL_REQ_ID) {
      const params = new URL(req.url).searchParams;
      const reqId = params.get("reqId") || candidate.reqId;
      const requisition = reqId ? await getRequisition(reqId) : null;
      if (!requisition) throw new ApiError(404, "Candidate requisition not found.");
      if (params.has("reqId") && !OPEN_STATUSES.has(requisition.status)) {
        throw new ApiError(400, "Select an open position before downloading a resume.");
      }
      if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) {
        throw new ApiError(403, "This position is not assigned to you.");
      }
      if (user.role === "Admin" && requisition.recruiterEmail) {
        const teamEmails = new Set((await listUsers())
          .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
          .map((member) => member.email));
        if (!teamEmails.has(requisition.recruiterEmail)) {
          throw new ApiError(403, "This position is outside your managed team.");
        }
      }
    }
    if (!candidate.cvPath) throw new ApiError(404, "No CV attached to this candidate.");

    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "File storage is not configured.");
    const file = bucket.file(candidate.cvPath);
    const [exists] = await file.exists();
    if (!exists) throw new ApiError(404, "CV file is missing in storage.");

    const [buffer] = await file.download();
    const name = (candidate.cvFileName || "cv.pdf").replace(/[^\w.\- ()]+/g, "_");
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentTypeForName(name),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return errResponse(error);
  }
}