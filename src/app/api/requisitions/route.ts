import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  createRequisition,
  listCandidates,
  listRequisitions,
  listUsers,
  updateRequisition,
} from "@/lib/db";
import {
  canRaiseReq,
  userCoversDepartment,
} from "@/lib/roles";
import { adminStorage } from "@/lib/firebaseAdmin";

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
      requisitions = (await listRequisitions()).filter((r) => r.recruiterEmail === user.email);
    } else if (user.role === "DepartmentHead") {
      requisitions = await listRequisitions({
        departments: user.departments || [],
      });
    } else {
      requisitions = await listRequisitions();
    }

    const cands = await listCandidates();
    const reqIds = new Set(requisitions.map((r) => r.id));
    const candidateCount: Record<string, number> = {};
    const stageBreakdown: Record<string, Record<string, number>> = {};
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
        return (await updateRequisition(r.id, { status })) || r;
      })
    );

    return json({
      requisitions: syncedRequisitions.map((r) => ({
        ...r,
        candidateCount: candidateCount[r.id] || 0,
        stageBreakdown: stageBreakdown[r.id] || {},
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
    const requisitionType = String(body.requisitionType || "").trim();
    if (!title || !department) {
      throw new ApiError(400, "Title and department are required.");
    }
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
    if (
      user.role === "HiringManager" &&
      !userCoversDepartment(user.departments, department)
    ) {
      throw new ApiError(
        403,
        `You are not assigned to department “${department}”. Ask an Admin to add it on your profile.`
      );
    }

    const heads = (await listUsers()).filter(
      (u) =>
        u.role === "DepartmentHead" &&
        userCoversDepartment(u.departments, department)
    );
    if (heads.length === 0) {
      throw new ApiError(
        400,
        `No Department Head is assigned to “${department}”. Ask an Admin to add one before raising this req.`
      );
    }

    const jdBase64 = String(body.jdBase64 || "").trim();
    const jdFileName = String(body.jdFileName || "").trim();
    if (!jdBase64 || !jdFileName) {
      throw new ApiError(400, "A JD PDF is required.");
    }
    if (!jdFileName.toLowerCase().endsWith(".pdf")) {
      throw new ApiError(400, "JD must be a PDF file.");
    }
    const bucket = adminStorage()?.bucket();
    if (!bucket) {
      throw new ApiError(
        503,
        "File storage is not configured. Enable Firebase Storage, then re-upload the JD."
      );
    }
    const jdPath = `jds/${Date.now()}_${jdFileName.replace(/[^\w.\-]+/g, "_")}`;
    const buf = Buffer.from(jdBase64, "base64");
    await bucket.file(jdPath).save(buf, {
      metadata: { contentType: "application/pdf" },
    });

    const locations = Array.isArray(body.locations)
      ? (body.locations as string[]).map((s) => String(s).trim()).filter(Boolean)
      : String(body.location || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

    const reqn = await createRequisition({
      title,
      department,
      requisitionType,
      businessJustification: requisitionType === "New" ? businessJustification : undefined,
      replacementEmployeeCode:
        requisitionType === "Replacement" ? replacementEmployeeCode : undefined,
      lob: String(body.lob || department || "GEN"),
      location: locations.join(", "),
      employment: String(body.employment || "Full-time"),
      level: String(body.level || ""),
      salaryMin,
      salaryMax,
      priority: String(body.priority || ""),
      openings: requestedOpenings,
      notes: String(body.notes || ""),
      jdText: String(body.jdText || ""),
      jdPath,
      jdFileName,
      raisedByEmail: user.email,
      raisedByName: user.name,
      status: "PendingApproval",
    });
    await addAudit({
      action: "requisition.create",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "requisition",
      entityId: reqn.id,
      detail: `Pending approval for ${department} (${heads.map((h) => h.email).join(", ")})`,
    });
    return json({ requisition: reqn, departmentHeads: heads.map((h) => h.email) }, 201);
  } catch (e) {
    return errResponse(e);
  }
}
