import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { addAudit, getRequisition, getUserByEmail, updateRequisition } from "@/lib/db";
import { canApprove, canRecruit, userCoversDepartment } from "@/lib/roles";
import type { Requisition } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const r = await getRequisition(id);
    if (!r) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, r);
    if (
      user.role === "HiringManager" &&
      r.raisedByEmail !== user.email
    ) {
      throw new ApiError(403, "You can only view requisitions you raised.");
    }
    if (
      user.role === "DepartmentHead" &&
      !userCoversDepartment(user.departments, r.department)
    ) {
      throw new ApiError(403, "Not your department.");
    }
    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    const approver = r.approvedBy
      ? await getUserByEmail(r.approvedBy)
      : null;
    return json({
      requisition: {
        ...r,
        approvedByName: r.approvedByName || approver?.name,
      },
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const r = await getRequisition(id);
    if (!r) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, r);
    const body = await req.json();

    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }

    if (body.recruiterEmail !== undefined) {
      if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can assign a recruiter.");
      const recruiterEmail = String(body.recruiterEmail || "").trim().toLowerCase();
      if (recruiterEmail) {
        const recruiter = await getUserByEmail(recruiterEmail);
        if (!recruiter || !recruiter.active || recruiter.role !== "Recruiter" || recruiter.managerEmail !== user.email) {
          throw new ApiError(400, "Choose an active recruiter on your managed team.");
        }
      }
      const updated = await updateRequisition(id, { recruiterEmail });
      await addAudit({
        action: "requisition.recruiter.assign",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "requisition",
        entityId: id,
        detail: recruiterEmail || "Unassigned",
      });
      return json({ requisition: updated });
    }

    if (body.status !== undefined) {
      if (user.role !== "Admin" && !canRecruit(user.role)) {
        throw new ApiError(403, "Only Admin or an assigned Recruiter can update requisition status.");
      }
      const status = String(body.status);
      const transitions: Record<string, string[]> = {
        Approved: ["On Hold", "Position Closed"],
        "On Hold": ["Position Reopened", "Position Closed"],
        "Position Reopened": ["On Hold", "Position Closed"],
      };
      if (!transitions[r.status]?.includes(status)) {
        throw new ApiError(400, "Invalid requisition status.");
      }
      const updated = await updateRequisition(id, {
        status: status as Requisition["status"],
      });
      await addAudit({
        action: "requisition.status.update",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "requisition",
        entityId: id,
        detail: `${r.status} -> ${status}`,
      });
      return json({ requisition: updated });
    }

    if (body.action === "approve" || body.action === "reject") {
      if (!canApprove(user.role)) {
        throw new ApiError(403, "Not a department head.");
      }
      if (
        user.role === "DepartmentHead" &&
        !userCoversDepartment(user.departments, r.department)
      ) {
        throw new ApiError(403, "This requisition is not in your department.");
      }
      if (r.status !== "PendingApproval") {
        throw new ApiError(400, "Requisition is not pending approval.");
      }
      if (body.action === "approve") {
        const updated = await updateRequisition(id, {
          status: "Approved",
          approvedAt: new Date().toISOString(),
          approvedBy: user.email,
          approvedByName: user.name,
        });
        await addAudit({
          action: "requisition.approve",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: id,
        });
        return json({ requisition: updated });
      }
      const reason = String(body.reason || "").trim();
      if (!reason) throw new ApiError(400, "A rejection reason is required.");
      const updated = await updateRequisition(id, {
        status: "Rejected",
        rejectionReason: reason,
        approvedBy: user.email,
        approvedByName: user.name,
        approvedAt: new Date().toISOString(),
      });
      await addAudit({
        action: "requisition.reject",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "requisition",
        entityId: id,
        detail: reason,
      });
      return json({ requisition: updated });
    }

    const canEdit =
      user.role === "Admin" ||
      canRecruit(user.role) ||
      (user.role === "HiringManager" &&
        r.raisedByEmail === user.email &&
        r.status === "PendingApproval");
    if (!canEdit) throw new ApiError(403, "Cannot edit this requisition.");

    const patch: Record<string, unknown> = {};
    for (const k of [
      "title",
      "department",
      "requisitionType",
      "businessJustification",
      "replacementEmployeeCode",
      "lob",
      "location",
      "employment",
      "level",
      "salaryMin",
      "salaryMax",
      "priority",
      "openings",
      "notes",
      "jdText",
    ]) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const updated = await updateRequisition(id, patch);
    return json({ requisition: updated });
  } catch (e) {
    return errResponse(e);
  }
}
