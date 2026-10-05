import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { getPlan, getRequisition, listUsers, savePlan } from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { userCoversDepartment } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const requisition = await getRequisition(id);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "Recruiter" && requisition.recruiterEmail !== user.email) throw new ApiError(403, "This requisition is not assigned to you.");
    if (user.role === "HiringManager" && requisition.raisedByEmail !== user.email) throw new ApiError(403, "Not your requisition.");
    if (user.role === "DepartmentHead" && !userCoversDepartment(user.departments, requisition.department)) throw new ApiError(403, "Not your department.");
    return json({ plan: await getPlan(id) });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    if (!canRecruit(user.role)) throw new ApiError(403, "Not allowed.");
    const { id } = await ctx.params;
    const r = await getRequisition(id);
    if (
      !r ||
      (r.status !== "Approved" &&
        r.status !== "Position Reopened" &&
        r.status !== "Partially Fulfilled")
    ) {
      throw new ApiError(403, "Requisition must be approved.");
    }
    await requireManagedRequisitionAccess(user, r);
    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (user.role === "Admin" && r.recruiterEmail) {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      if (!teamEmails.has(r.recruiterEmail)) {
        throw new ApiError(403, "This requisition is outside your managed team.");
      }
    }
    const body = await req.json();
    const raw = Array.isArray(body.rounds) ? body.rounds : [];
    if (raw.length === 0) {
      throw new ApiError(400, "Add at least one interview round.");
    }
    const rounds = raw.map(
      (
        row: { name?: string; type?: string; order?: number; competencies?: string[] },
        i: number
      ) => ({
        name: String(row.name || `Round ${i + 1}`).trim() || `Round ${i + 1}`,
        type: row.type ? String(row.type) : "interview",
        order: Number(row.order) || i + 1,
        competencies: Array.isArray(row.competencies) ? row.competencies : [],
      })
    );
    const plan = await savePlan({
      reqId: id,
      rounds,
      updatedAt: new Date().toISOString(),
      updatedBy: user.email,
    });
    return json({ plan });
  } catch (e) {
    return errResponse(e);
  }
}
