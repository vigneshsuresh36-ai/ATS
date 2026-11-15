import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { addAudit, getOrCreateSocialLink, getRequisition, getSocialLinkForRecruiter } from "@/lib/db";
import type { Requisition } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const OPEN_STATUSES = new Set<Requisition["status"]>([
  "Approved", "Position Reopened", "Partially Fulfilled",
]);

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can access social application links.");
    }
    const { id } = await ctx.params;
    const requisition = await getRequisition(id);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (!OPEN_STATUSES.has(requisition.status)) throw new ApiError(400, "The position is not open.");
    const link = requisition.recruiterEmail
      ? await getSocialLinkForRecruiter(id, requisition.recruiterEmail)
      : null;
    return json({ token: link?.token || null });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can create social application links.");
    }
    const { id } = await ctx.params;
    const requisition = await getRequisition(id);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (!OPEN_STATUSES.has(requisition.status)) {
      throw new ApiError(400, "The position must be open before creating a social application link.");
    }
    if (!requisition.recruiterEmail) {
      throw new ApiError(400, "Assign a recruiter to this position before creating its social link.");
    }

    const link = await getOrCreateSocialLink(id, requisition.recruiterEmail, user.email);
    await addAudit({
      action: "requisition.social_link.create",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "requisition",
      entityId: id,
      detail: `Social application link for ${link.recruiterEmail}`,
    });
    return json({ token: link.token, recruiterEmail: link.recruiterEmail });
  } catch (error) {
    return errResponse(error);
  }
}