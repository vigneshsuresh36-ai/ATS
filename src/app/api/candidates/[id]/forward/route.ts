import { indianCityLabel } from "@/lib/indianCities";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, createCandidate, findCandidateProfilesByContact, getCandidate, getOrg, listRequisitions, listStageEvents, listUsers, listVendorSpendRecords, saveCandidateApplicationSource } from "@/lib/db";
import { isTalentPoolEligible } from "@/lib/talentPool";
import { adminStorage } from "@/lib/firebaseAdmin";
import type { JobBoardSubscription, RecruitmentConsultant } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };
const OPEN_STATUSES = new Set(["Approved", "Position Reopened", "Partially Fulfilled"]);

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can forward candidates.");
    }
    const { id } = await ctx.params;
    const candidate = await getCandidate(id);
    if (!candidate) throw new ApiError(404, "Candidate not found.");
    const body = await req.json();
    const enabledFields = ((await getOrg()).candidateCustomFields || []).filter((field) => field.enabled);
    const supplied = body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields) ? body.customFields as Record<string, unknown> : {};
    const customFields = [...(candidate.customFields || []).filter((field) => !enabledFields.some((active) => active.id === field.id)), ...enabledFields.map((field) => {
      const raw = supplied[field.id];
      if (raw !== undefined && typeof raw !== "string") throw new ApiError(400, `Enter a valid value for ${field.label}.`);
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value.length > 500 || (field.required && !value)) throw new ApiError(400, `Enter a valid value for ${field.label}.`);
      return { id: field.id, label: field.label, value };
    }).filter((field) => field.value)];
    const targetReqId = String(body.reqId || "");
    if (!targetReqId || targetReqId === candidate.reqId) {
      throw new ApiError(400, "Select a different open position.");
    }

    let visibleRequisitions = await listRequisitions();
    if (user.role === "Recruiter") {
      visibleRequisitions = visibleRequisitions.filter((item) => isAssignedRecruiter(item, user.email));
    } else {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      visibleRequisitions = visibleRequisitions.filter((item) => !item.recruiterEmail || teamEmails.has(item.recruiterEmail));
    }
    const target = visibleRequisitions.find((item) => item.id === targetReqId);
    if (!target) throw new ApiError(403, "This position is not assigned to you.");
    if (!OPEN_STATUSES.has(target.status)) throw new ApiError(400, "The selected position is not open.");

    const events = await listStageEvents();
    if (!isTalentPoolEligible(candidate, events)) {
      throw new ApiError(409, "This candidate is no longer eligible for the Talent Pool.");
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const location = indianCityLabel(body.location);
    if (!location) throw new ApiError(400, "Choose an Indian city from the location suggestions.");
    const currentFixedCtc = String(body.currentFixedCtc || body.currentCtc || "").trim();
    const currentVariableCtc = String(body.currentVariableCtc || "").trim();
    const presentEsops = String(body.presentEsops ?? "").trim();
    const expectedCtc = String(body.expectedCtc || "").trim();
    const notice = String(body.notice || "").trim();
    const source = String(body.source || "").trim();
    let sourceDetail = String(body.sourceDetail || (source === "Social CV" ? candidate.sourceDetail : "")).trim();
    let referrerEmail = "";
    const sourceVendorId = String(body.sourceVendorId || "").trim();
    const sourceSubscriptionId = String(body.sourceSubscriptionId || "").trim();
    const sourceNotes = String(body.sourceNotes || "").trim();
    const remarks = String(body.remarks || "").trim();
    const skills = Array.isArray(body.skills)
      ? body.skills.map((skill: unknown) => String(skill).trim()).filter(Boolean)
      : [];
    const experienceYears = body.experienceYears === "" || body.experienceYears === undefined
      ? undefined
      : Number(body.experienceYears);
    if (!name || !email || !location || !source) {
      throw new ApiError(400, "Name, email, location, and source are required.");
    }
    if (!/^\d{10}$/.test(phone)) throw new ApiError(400, "Phone must contain exactly 10 digits.");
    const normalizedEmail = email.toLowerCase();
    if (!candidate.profileId) throw new ApiError(409, "Run the candidate profile backfill before forwarding legacy candidates.");
    const matchingProfiles = await findCandidateProfilesByContact(normalizedEmail, phone);
    if (matchingProfiles.some((profile) => profile.id !== candidate.profileId)) {
      throw new ApiError(409, "This email or phone also matches another candidate profile. Ask an Admin to review the possible duplicate.");
    }
    if (![currentFixedCtc, currentVariableCtc, presentEsops, expectedCtc].every((value) => /^\d+$/.test(value))) {
      throw new ApiError(400, "Fixed, variable, ESOP, and expected CTC values must contain numbers only.");
    }
    if (!/^\d{1,2}$/.test(notice)) throw new ApiError(400, "Notice period must be a number up to 2 digits.");
    if (experienceYears !== undefined && (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60)) {
      throw new ApiError(400, "Experience must be a whole number from 0 to 60 years.");
    }
    if (!["Job Board", "Employee Referral", "Consultant", "Direct / Inbound", "Walk-in", "Social CV", "Talent Pool", "Career Page", "Social Media", "Campus Hiring", "Other"].includes(source)) {
      throw new ApiError(400, "Select a valid candidate source.");
    }
    if (source === "Employee Referral") {
      const employee = (await listUsers()).find((member) => member.active !== false && member.employeeCode?.trim().toLowerCase() === sourceDetail.toLowerCase());
      if (!employee?.employeeCode) throw new ApiError(400, "Choose an active employee code from Teams & Access.");
      sourceDetail = employee.employeeCode.trim();
      referrerEmail = employee.email.toLowerCase();
    }
    const vendorsEnabled = (await getOrg()).vendorsSpendEnabled === true;
    if (source === "Consultant" && vendorsEnabled) {
      const consultant = (await listVendorSpendRecords<RecruitmentConsultant>("consultants"))
        .find((item) => item.id === sourceVendorId && item.status === "Active");
      if (!consultant) throw new ApiError(400, "Choose an active managed recruitment consultant.");
      sourceDetail = consultant.name;
    }
    if (source === "Job Board" && vendorsEnabled) {
      const subscription = (await listVendorSpendRecords<JobBoardSubscription>("subscriptions"))
        .find((item) => item.id === sourceSubscriptionId && item.status === "Active");
      if (!subscription) throw new ApiError(400, "Choose an active managed job board subscription.");
      sourceDetail = subscription.platformName;
    }
    if (source !== "Direct / Inbound" && source !== "Walk-in" && source !== "Social CV" && source !== "Career Page" && !sourceDetail) {
      throw new ApiError(400, "Select or enter the required source details.");
    }

    let replacementCvPath: string | undefined;
    let replacementCvName: string | undefined;
    if (body.cvBase64 || body.cvFileName) {
      if (!body.cvBase64 || !body.cvFileName) throw new ApiError(400, "Select a valid replacement resume.");
      const bucket = adminStorage()?.bucket();
      if (!bucket) throw new ApiError(503, "File storage is not configured.");
      replacementCvName = String(body.cvFileName).replace(/[^\w.\- ()]+/g, "_");
      replacementCvPath = `cvs/${targetReqId}/${Date.now()}_${replacementCvName}`;
      await bucket.file(replacementCvPath).save(Buffer.from(String(body.cvBase64), "base64"), {
        metadata: { contentType: String(body.cvMime || "application/octet-stream") },
      });
    }

    const forwarded = await createCandidate({
      candidateProfileId: candidate.profileId,
      reqId: targetReqId,
      stage: "PendingHMApproval",
      customFields,
      name,
      email,
      phone,
      location,
      currentCtc: currentFixedCtc,
      currentFixedCtc,
      currentVariableCtc,
      presentEsops,
      expectedCtc,
      notice,
      skills,
      ...(experienceYears !== undefined ? { experienceYears } : {}),
      source,
      sourceDetail,
      referrerEmail,
      sourceNotes,
      remarks,
      cvPath: replacementCvPath || candidate.cvPath,
      cvFileName: replacementCvName || candidate.cvFileName,
    });

    await saveCandidateApplicationSource({
      candidateId: forwarded.id,
      requisitionId: targetReqId,
      source,
      ...(source === "Consultant" && vendorsEnabled && sourceVendorId ? { consultantId: sourceVendorId } : {}),
      ...(source === "Job Board" && vendorsEnabled && sourceSubscriptionId ? { subscriptionId: sourceSubscriptionId } : {}),
      ...(sourceNotes ? { sourceNotes } : {}),
      submittedAt: new Date().toISOString(),
      submittedBy: user.email,
    });

    await addAudit({
      action: "candidate.forward_to_requisition",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "candidate",
      entityId: forwarded.id,
      detail: `${candidate.reqId} -> ${targetReqId}`,
    });
    return json({ candidate: forwarded, previousReqId: candidate.reqId, requisition: target });
  } catch (error) {
    return errResponse(error);
  }
}
