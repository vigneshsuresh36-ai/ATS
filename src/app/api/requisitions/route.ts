import { canViewScopedRequisition, scopeDepartments, coversRequisitionScope, departmentOptions, requiresSubDepartment } from "@/lib/requisitionScope";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { systemStatusAudit } from "@/lib/statusAudit";
import { requestStatusAudit } from "@/lib/requestStatusAudit";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  createNotifications,
  createRequisition,
  getOrg,
  listCandidates,
  listRequisitions,
  listUsers,
  updateRequisition,
} from "@/lib/db";
import {
  canRaiseReq,
  DEPARTMENTS,
} from "@/lib/roles";
import { hidePriorityForRole } from "@/lib/requisitionPriorityAccess";
import { requisitionApproverRecipients } from "@/lib/requisitionNotificationRecipients";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const mine = searchParams.get("mine") === "1";

    let requisitions;
    if (user.role === "HiringManager" || mine) {
      requisitions = await listRequisitions({
        raisedByEmail: user.email,
      });
    } else if (user.role === "Admin") {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      requisitions = (await listRequisitions()).filter((requisition) =>
        !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail)
      );
    } else if (user.role === "Recruiter") {
      requisitions = (await listRequisitions()).filter((r) => isAssignedRecruiter(r, user.email));
    } else if (user.role === "DepartmentHead") {
      requisitions = scopeDepartments(user).length ? await listRequisitions({ departments: scopeDepartments(user) }) : [];
    } else {
      requisitions = await listRequisitions();
    }

    requisitions = requisitions.filter((request) => canViewScopedRequisition(user, request));
    const allCandidates = await listCandidates(undefined, true);
    const cands = allCandidates.filter((candidate) => !candidate.archived);
    const reqIds = new Set(requisitions.map((r) => r.id));
    const candidateCount: Record<string, number> = {};
    const stageBreakdown: Record<string, Record<string, number>> = {};
    const requisitionsWithEmployeeReferrals = new Set(
      allCandidates.filter((candidate) => candidate.source === "Employee Referral").map((candidate) => candidate.reqId)
    );
    for (const c of cands) {
      if (!reqIds.has(c.reqId)) continue;
      candidateCount[c.reqId] = (candidateCount[c.reqId] || 0) + 1;
      if (!stageBreakdown[c.reqId]) stageBreakdown[c.reqId] = {};
      stageBreakdown[c.reqId]![c.stage] =
        (stageBreakdown[c.reqId]![c.stage] || 0) + 1;
    }

    const reservedStages = new Set([
      "OfferApprovalPending",
      "OfferApproved",
      "Offered",
      "Onboarded",
    ]);
    const syncedRequisitions = await Promise.all(
      requisitions.map(async (r) => {
        if (
          r.status !== "Approved" &&
          r.status !== "Position Reopened" &&
          r.status !== "Partially Fulfilled"
        ) {
          return r;
        }
        const reservedCount = cands.filter(
          (candidate) =>
            candidate.reqId === r.id &&
            (candidate.offerApprovalStatus === "Pending" ||
              candidate.offerApprovalStatus === "Approved" ||
              reservedStages.has(candidate.stage))
        ).length;
        if (reservedCount === 0) return r;
        const status =
          reservedCount >= Math.max(1, r.openings)
            ? "Position Fulfilled"
            : "Partially Fulfilled";
        if (r.status === status) return r;
        return (await updateRequisition(r.id, { status }, systemStatusAudit("Reconciled requisition status against reserved offers and open headcount."), r)) || r;
      })
    );

    return json({
      requisitions: syncedRequisitions.map((r) => ({
        ...hidePriorityForRole(r, user.role),
        candidateCount: candidateCount[r.id] || 0,
        stageBreakdown: stageBreakdown[r.id] || {},
        hasEmployeeReferrals: requisitionsWithEmployeeReferrals.has(r.id),
      })),
    });
  } catch (e) {
    return errResponse(e);
  }
}


export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canRaiseReq(user.role)) {
      throw new ApiError(403, "Only Hiring Managers (or Admin) can raise requisitions.");
    }
    const body = await req.json();
    const title = String(body.title || "").trim();
    const department = String(body.department || "").trim();
    const org = await getOrg();
    const businessUnit = String(body.lob || "").trim();
    const subDepartment = String(body.subDepartment || "").trim();
    const requisitionType = String(body.requisitionType || "").trim();
    if (!title) throw new ApiError(400, "Title is required.");
    if (org.requisitionDepartmentRequired !== false && !department) throw new ApiError(400, "Department is required.");
    if ((org.requisitionBusinessUnitRequired === true || org.businessUnits?.length) && !businessUnit) throw new ApiError(400, "Business unit is required.");
    if (department && ![...DEPARTMENTS, ...(org.customDepartments || [])].includes(department)) throw new ApiError(400, "Select a valid department.");
    if (subDepartment && !(org.subDepartments || []).some((item) => item.department === department && item.name === subDepartment)) throw new ApiError(400, "Select a valid sub-department for the chosen department.");
    if (businessUnit && !(org.businessUnits || []).includes(businessUnit)) throw new ApiError(400, "Select a valid business unit.");
    const accessScoped = !!org.businessUnits?.length;
    const scope = { department, lob: businessUnit, subDepartment, accessScoped };
    if (accessScoped && (!department || !departmentOptions(org, businessUnit).includes(department))) {
      throw new ApiError(400, "Choose a department for the selected business unit.");
    }
    if (requiresSubDepartment(department, org) && !subDepartment) throw new ApiError(400, "Choose a Finance sub-department.");
    if (requisitionType !== "New" && requisitionType !== "Replacement") {
      throw new ApiError(400, "Select whether the requisition is new or a replacement.");
    }
    const businessJustification = String(body.businessJustification || "").trim();
    const replacementEmployeeCode = String(body.replacementEmployeeCode || "").trim();
    const replacementCodeCount = new Set(
      replacementEmployeeCode.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean)
    ).size;
    if (requisitionType === "New" && !businessJustification) {
      throw new ApiError(400, "Business justification is required for a new requisition.");
    }
    if (requisitionType === "Replacement" && !replacementEmployeeCode) {
      throw new ApiError(400, "Employee code is required for a replacement requisition.");
    }
    const requestedOpenings = Math.max(1, Number(body.openings) || 1);
    if (requisitionType === "Replacement" && requestedOpenings > replacementCodeCount) {
      throw new ApiError(400, "Openings cannot exceed the number of employee codes entered.");
    }
    const salaryMin = Number(body.salaryMin);
    const salaryMax = Number(body.salaryMax);
    if (
      !Number.isSafeInteger(salaryMin) ||
      !Number.isSafeInteger(salaryMax) ||
      salaryMin <= 0 ||
      salaryMax < salaryMin
    ) {
      throw new ApiError(400, "Enter a valid annual salary range.");
    }
    if (user.role === "HiringManager" && (department || accessScoped) && !coversRequisitionScope(user, scope)) {
      throw new ApiError(403, "This hiring request is outside your access scope.");
    }

    const users = await listUsers();
    const heads = users.filter((member) => member.active && (department
      ? member.role === "DepartmentHead" && coversRequisitionScope(member, scope)
      : member.role === "Admin"));
    if (!heads.length) {
      throw new ApiError(400, department
        ? "No Department Head is assigned to this combination. Ask an Admin to assign an approver."
        : "No active Admin is available to approve this request.");
    }

    const jdText = String(body.jdText || "").trim();
    if (!jdText) throw new ApiError(400, "Job description is required.");
    if (jdText.length > 20000) throw new ApiError(400, "Job description must be 20,000 characters or fewer.");

    const locations = Array.isArray(body.locations)
      ? (body.locations as string[]).map((s) => String(s).trim()).filter(Boolean)
      : String(body.location || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const audit = await requestStatusAudit(user, "Requisition submitted for approval.", "System");
    const reqn = await createRequisition({
      title,
      department,
      subDepartment: subDepartment || undefined,
      requisitionType,
      businessJustification: requisitionType === "New" ? businessJustification : undefined,
      replacementEmployeeCode:
        requisitionType === "Replacement" ? replacementEmployeeCode : undefined,
      lob: businessUnit,
      ...(accessScoped ? { accessScoped: true } : {}),
      location: locations.join(", "),
      employment: String(body.employment || "Full-time"),
      level: String(body.level || ""),
      salaryMin,
      salaryMax,
      priority: String(body.priority || ""),
      openings: requestedOpenings,
      notes: String(body.notes || ""),
      jdText,
      raisedByEmail: user.email,
      raisedByName: user.name,
      status: "PendingApproval",
    }, audit);
    const recipients = requisitionApproverRecipients(users, reqn, user.email);
    await createNotifications(recipients.map((recipientEmail) => ({
      recipientEmail,
      type: "requisition-submitted" as const,
      requisitionId: reqn.id,
      title: "Requisition awaiting approval",
      message: `${reqn.title} (${reqn.id}) was submitted by ${reqn.raisedByName} for ${department} and needs approval.`,
    })));
    return json({ requisition: hidePriorityForRole(reqn, user.role), departmentHeads: heads.map((h) => h.email) }, 201);
  } catch (e) {
    return errResponse(e);
  }
}
