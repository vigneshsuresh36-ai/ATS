import { coversRequisitionScope, departmentOptions, requiresSubDepartment } from "@/lib/requisitionScope";
import { jobDescriptionMark } from "@/lib/jobDescriptionFormatting";
import { recruiterCollaborators } from "@/lib/recruiterAssignment";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { requestStatusAudit } from "@/lib/requestStatusAudit";
import { readRecordActivity } from "@/lib/statusAudit";
import { requireAdminDb } from "@/lib/firebaseAdmin";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { addAudit, createNotifications, getOrg, getRequisition, getSocialLinkForRecruiter, getUserByEmail, listCandidates, listUsers, updateRequisition } from "@/lib/db";
import { canApprove, canRecruit } from "@/lib/roles";
import { canEditRequisitionPriority, isRequisitionClosed } from "@/lib/requisitionStatus";
import type { Requisition } from "@/lib/types";
import { hidePriorityForRole } from "@/lib/requisitionPriorityAccess";
import { requisitionDecisionRecipients } from "@/lib/requisitionNotificationRecipients";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const r = await getRequisition(id);
    if (!r) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, r);
    if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }


    if (req.nextUrl.searchParams.get("activity") === "1") {
      return json({ activity: await readRecordActivity(requireAdminDb(), "requisition", r.id) });
    }

    const approver = r.approvedBy
      ? await getUserByEmail(r.approvedBy)
      : null;
    return json({
      requisition: {
        ...hidePriorityForRole(r, user.role),
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
    if (isRequisitionClosed(r.status)) {
      throw new ApiError(400, "Closed positions cannot be changed.");
    }
    const body = await req.json();

    if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }

    async function organizationChanges() {
      if (body.department === undefined && body.lob === undefined && body.subDepartment === undefined) return {};
      const org = await getOrg();
      const department = typeof body.department === "string" ? body.department.trim() : r!.department;
      const lob = typeof body.lob === "string" ? body.lob.trim() : r!.lob;
      const subDepartment = typeof body.subDepartment === "string" ? body.subDepartment.trim() : department === r!.department ? r!.subDepartment ?? "" : "";
      const changed = department !== r!.department || lob !== r!.lob || subDepartment !== (r!.subDepartment ?? "");
      if (!changed && (r!.accessScoped || !lob || user.role !== "Admin" || !org.businessUnits?.length)) return {};
      const accessScoped = !!r!.accessScoped || !!org.businessUnits?.length;
      if (accessScoped && user.role === "Recruiter") throw new ApiError(403, "Ask an Admin to change the organization scope.");
      if (accessScoped && (!lob || !org.businessUnits?.includes(lob) || !department)) throw new ApiError(400, "Choose a business unit and department.");
      if (department && !departmentOptions(org, lob || "").includes(department)) throw new ApiError(400, "Choose a department for the selected business unit.");
      if (requiresSubDepartment(department, org) && !subDepartment) throw new ApiError(400, "Choose a Finance sub-department.");
      if (subDepartment && !org.subDepartments?.some((item) => item.department === department && item.name === subDepartment)) throw new ApiError(400, "Choose a sub-department within the selected department.");
      const scope = { department, lob, subDepartment, accessScoped };
      if (user.role === "HiringManager" && !coversRequisitionScope(user, scope)) throw new ApiError(403, "This combination is outside your access scope.");
      if (accessScoped && r!.status === "PendingApproval" && !(await listUsers()).some((member) => member.active && member.role === "DepartmentHead" && coversRequisitionScope(member, scope))) {
        throw new ApiError(400, "Assign a Department Head for this combination before saving.");
      }
      return scope;
    }

    if (body.action === "updateRoleSummary") {
      const canEditSummary = user.role === "Admin" || canRecruit(user.role) ||
        (user.role === "HiringManager" && r.raisedByEmail === user.email && r.status === "PendingApproval");
      if (!canEditSummary) throw new ApiError(403, "Cannot edit this requisition.");
      const fields = ["department", "location", "employment", "level", "priority"] as const;
      for (const field of fields) {
        if (typeof body[field] !== "string" || !body[field].trim() || body[field].trim().length > 300) throw new ApiError(400, `Enter a valid ${field}.`);
      }
      const { salaryMin, salaryMax, openings } = body;
      if (![salaryMin, salaryMax, openings].every(Number.isSafeInteger) || salaryMin < 0 || salaryMax < salaryMin || openings < 1) throw new ApiError(400, "Enter a valid salary range and a positive number of openings.");
      const replacementCount = new Set((r.replacementEmployeeCode || "").split(/[\s,]+/).filter(Boolean)).size;
      if (r.requisitionType === "Replacement" && openings > replacementCount) throw new ApiError(400, "Openings cannot exceed the number of replacement employee codes.");
      const updated = await updateRequisition(id, { ...await organizationChanges(), location: body.location.trim(), employment: body.employment.trim(), level: body.level.trim(), priority: body.priority.trim(), salaryMin, salaryMax, openings }, undefined, r);
      await addAudit({ action: "requisition.summary.update", actorEmail: user.email, actingAdminEmail: user.actingAdminEmail, entityType: "requisition", entityId: id, detail: "Role summary updated" });
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.action === "setCareersVisibility") {
      if (user.role !== "Admin" && !canRecruit(user.role)) throw new ApiError(403, "Only an Admin or assigned Recruiter can manage careers visibility.");
      if (typeof body.published !== "boolean") throw new ApiError(400, "Choose whether to list this role publicly.");
      if (body.published) {
        if (!["Approved", "Position Reopened", "Partially Fulfilled"].includes(r.status) || !r.recruiterEmail) throw new ApiError(400, "The role must be open and assigned to a recruiter before it can be listed.");
        if (!(await getSocialLinkForRecruiter(id, r.recruiterEmail))) throw new ApiError(400, "Generate an application link before listing this role on the careers page.");
      }
      const updated = await updateRequisition(id, { careersPublished: body.published });
      await addAudit({ action: "requisition.careers.visibility", actorEmail: user.email, actingAdminEmail: user.actingAdminEmail, entityType: "requisition", entityId: id, detail: body.published ? "Listed on careers page" : "Removed from careers page" });
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.referralBonus !== undefined || body.referralInterviewBonus !== undefined || body.employeeReferralEnabled !== undefined) {
      if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can set a referral bonus.");
      if (body.employeeReferralEnabled !== undefined && typeof body.employeeReferralEnabled !== "boolean") {
        throw new ApiError(400, "Choose whether this position is available for employee referrals.");
      }
      const referralBonus = body.referralBonus === undefined
        ? Number(r.referralBonus || 0)
        : Number(body.referralBonus);
      const referralInterviewBonus = body.referralInterviewBonus === undefined
        ? Number(r.referralInterviewBonus || 0)
        : Number(body.referralInterviewBonus);
      if (!Number.isSafeInteger(referralBonus) || referralBonus < 0 || referralBonus > 100_000_000) {
        throw new ApiError(400, "Enter a whole-number referral bonus from 0 to 100,000,000.");
      }
      if (!Number.isSafeInteger(referralInterviewBonus) || referralInterviewBonus < 0 || referralInterviewBonus > 100_000_000) {
        throw new ApiError(400, "Enter a whole-number per-interview bonus from 0 to 100,000,000.");
      }
      const employeeReferralEnabled = body.employeeReferralEnabled === undefined
        ? r.employeeReferralEnabled === true
        : body.employeeReferralEnabled;
      const hasEmployeeReferrals = (await listCandidates(id, true)).some(
        (candidate) => candidate.source === "Employee Referral"
      );
      if (hasEmployeeReferrals && (
        (body.referralBonus !== undefined && referralBonus !== Number(r.referralBonus || 0)) ||
        (body.referralInterviewBonus !== undefined && referralInterviewBonus !== Number(r.referralInterviewBonus || 0))
      )) {
        throw new ApiError(409, "Referral bonuses cannot be changed after an employee has referred a candidate. You can still disable referrals for this position.");
      }
      if (employeeReferralEnabled && referralBonus <= 0) {
        throw new ApiError(400, "Set a referral bonus greater than 0 before making this position available to employees.");
      }
      const patch: Partial<Requisition> = {};
      if (body.referralBonus !== undefined) patch.referralBonus = referralBonus;
      if (body.referralInterviewBonus !== undefined) patch.referralInterviewBonus = referralInterviewBonus;
      if (body.employeeReferralEnabled !== undefined) patch.employeeReferralEnabled = employeeReferralEnabled;
      const updated = await updateRequisition(id, patch);
      if (body.referralBonus !== undefined) {
        await addAudit({
          action: "requisition.referral_bonus.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: id,
          detail: String(referralBonus),
        });
      }
      if (body.employeeReferralEnabled !== undefined) {
        await addAudit({
          action: "requisition.employee_referral.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: id,
          detail: employeeReferralEnabled ? "Enabled" : "Disabled",
        });
      }
      if (body.referralInterviewBonus !== undefined) {
        await addAudit({
          action: "requisition.referral_interview_bonus.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: id,
          detail: String(referralInterviewBonus),
        });
      }
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.jdText !== undefined) {
      if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Only an Admin or assigned Recruiter can edit the job description.");
      if (typeof body.jdText !== "string" || !body.jdText.trim()) {
        throw new ApiError(400, "Enter a job description before saving.");
      }
      const jdText = body.jdText.trim();
      const formatting = jobDescriptionMark.array().max(jdText.length).safeParse(body.jdFormatting ?? []);
      if (!formatting.success || formatting.data.some((mark, index, marks) =>
        mark.start >= mark.end || mark.end > jdText.length || (index > 0 && mark.start < marks[index - 1].end)
      )) {
        throw new ApiError(400, "Invalid job description formatting.");
      }
      const updated = await updateRequisition(id, { jdText, jdFormatting: formatting.data });
      await addAudit({
        action: "requisition.jd.update",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "requisition",
        entityId: id,
        detail: "Job description updated",
      });
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.recruiterEmail !== undefined || body.recruiterCollaboratorEmails !== undefined) {
      if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can assign a recruiter.");
      const recruiterEmail = String(body.recruiterEmail ?? r.recruiterEmail ?? "").trim().toLowerCase();
      const requested: unknown = body.recruiterCollaboratorEmails ?? r.recruiterCollaboratorEmails ?? [];
      if (!Array.isArray(requested) || requested.length > 50 || requested.some((email) => typeof email !== "string" || !email.trim())) {
        throw new ApiError(400, "Choose valid recruiter collaborators.");
      }
      const collaborators = recruiterCollaborators(requested).filter((email) => email !== recruiterEmail);
      if (!recruiterEmail && collaborators.length) throw new ApiError(400, "Choose a primary recruiter before adding collaborators.");
      const existing = recruiterCollaborators(r.recruiterCollaboratorEmails);
      const accountsToValidate = [recruiterEmail, ...collaborators].filter((email) => email && email !== r.recruiterEmail && !existing.includes(email));
      if (recruiterEmail && recruiterEmail !== r.recruiterEmail && !accountsToValidate.includes(recruiterEmail)) accountsToValidate.push(recruiterEmail);
      const accounts = await Promise.all(accountsToValidate.map(getUserByEmail));
      if (accounts.some((account) => !account?.active || account.role !== "Recruiter" || account.managerEmail !== user.email)) {
        throw new ApiError(400, "Choose active recruiters on your managed team.");
      }
      const patch: Partial<Requisition> = { recruiterEmail, recruiterCollaboratorEmails: collaborators };
      if (body.priorityLevel !== undefined) {
        const priorityLevel = String(body.priorityLevel);
        if (!canEditRequisitionPriority(r.status)) {
          throw new ApiError(400, "Priority can only be changed after a position is approved.");
        }
        if (!["P1", "P2", "P3", "P4"].includes(priorityLevel)) {
          throw new ApiError(400, "Choose a priority from P1 to P4.");
        }
        patch.priorityLevel = priorityLevel;
      }
      const currentRecruiter = (r.recruiterEmail || "").trim().toLowerCase();
      const primaryChanged = currentRecruiter !== recruiterEmail;
      const collaboratorsChanged = existing.join(",") !== collaborators.join(",");
      const reason = primaryChanged
        ? (currentRecruiter ? body.reason : "Recruiters assigned to an unassigned requisition.")
        : (body.reason ?? "Recruiter collaborators updated.");
      const audit = primaryChanged || collaboratorsChanged
        ? await requestStatusAudit(user, reason)
        : undefined;
      const updated = await updateRequisition(id, patch, audit, r);
      if (patch.priorityLevel) {
        await addAudit({
          action: "requisition.priority.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: id,
          detail: patch.priorityLevel,
        });
      }
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.priorityLevel !== undefined) {
      if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can update position priority.");
      if (!canEditRequisitionPriority(r.status)) {
        throw new ApiError(400, "Priority can only be changed after a position is approved.");
      }
      const priorityLevel = String(body.priorityLevel);
      if (!["P1", "P2", "P3", "P4"].includes(priorityLevel)) {
        throw new ApiError(400, "Choose a priority from P1 to P4.");
      }
      const updated = await updateRequisition(id, { priorityLevel });
      await addAudit({
        action: "requisition.priority.update",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "requisition",
        entityId: id,
        detail: priorityLevel,
      });
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
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
      }, await requestStatusAudit(user, body.reason), r);
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
    }

    if (body.action === "approve" || body.action === "reject") {
      if (!canApprove(user.role)) {
        throw new ApiError(403, "Not a department head.");
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
        }, await requestStatusAudit(user, body.reason), r);
        const recipients = requisitionDecisionRecipients(await listUsers(), r, r.raisedByEmail, user.email);
        await createNotifications(recipients.map((recipientEmail) => ({
          recipientEmail,
          type: "requisition-approved" as const,
          requisitionId: r.id,
          title: "Requisition approved",
          message: `${r.title} (${r.id}) was approved by ${user.name}.`,
        })));
        return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
      }
      const audit = await requestStatusAudit(user, body.reason);
      const reason = audit.reason;
      const updated = await updateRequisition(id, {
        status: "Rejected",
        rejectionReason: reason,
        approvedBy: user.email,
        approvedByName: user.name,
        approvedAt: new Date().toISOString(),
      }, audit, r);
      const recipients = requisitionDecisionRecipients(await listUsers(), r, r.raisedByEmail, user.email);
      await createNotifications(recipients.map((recipientEmail) => ({
        recipientEmail,
        type: "requisition-rejected" as const,
        requisitionId: r.id,
        title: "Requisition rejected",
        message: `${r.title} (${r.id}) was rejected by ${user.name}. Reason: ${reason}`,
      })));
      return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
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
      "requisitionType",
      "businessJustification",
      "replacementEmployeeCode",
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
    const updated = await updateRequisition(id, { ...patch, ...await organizationChanges() }, undefined, r);
    return json({ requisition: updated && hidePriorityForRole(updated, user.role) });
  } catch (e) {
    return errResponse(e);
  }
}
