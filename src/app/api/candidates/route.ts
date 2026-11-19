import { canViewScopedRequisition, scopeDepartments } from "@/lib/requisitionScope";
import { indianCityLabel } from "@/lib/indianCities";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  createCandidate,
  getRequisition,
  getOrg,
  listCandidates,
  findCandidateProfilesByContact,
  listRequisitions,
  listUsers,
  listVendorSpendRecords,
  saveCandidateApplicationSource,
} from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { adminStorage } from "@/lib/firebaseAdmin";
import type { JobBoardSubscription, RecruitmentConsultant } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const reqId = new URL(req.url).searchParams.get("reqId") || undefined;
    let candidates = await listCandidates(reqId);
    if (reqId) {
      const r = await getRequisition(reqId);
      if (!r) throw new ApiError(404, "Requisition not found.");
      if (!canViewScopedRequisition(user, r)) {
        throw new ApiError(403, "This requisition is outside your access scope.");
      }
      if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) {
        throw new ApiError(403, "This requisition is not assigned to you.");
      }
      if (user.role === "Admin") {
        const teamEmails = new Set((await listUsers())
          .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
          .map((member) => member.email));
        if (r.recruiterEmail && !teamEmails.has(r.recruiterEmail)) {
          throw new ApiError(403, "This requisition is outside your managed team.");
        }
      }
    } else {
      const requisitions = await listRequisitions(
        user.role === "Admin" || user.role === "Recruiter"
          ? undefined
          : user.role === "HiringManager"
          ? { raisedByEmail: user.email }
          : user.role === "DepartmentHead"
            ? { departments: scopeDepartments(user) }
            : undefined
      );
      const teamEmails = user.role === "Admin"
        ? new Set((await listUsers())
            .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
            .map((member) => member.email))
        : new Set<string>();
      const visibleReqs = user.role === "Recruiter"
        ? requisitions.filter((r) => isAssignedRecruiter(r, user.email))
        : user.role === "Admin"
          ? requisitions.filter((r) => !r.recruiterEmail || teamEmails.has(r.recruiterEmail))
          : requisitions.filter((request) => canViewScopedRequisition(user, request));
      const visibleIds = new Set(visibleReqs.map((r) => r.id));
      candidates = candidates.filter((candidate) => visibleIds.has(candidate.reqId));
    }
    return json({ candidates });
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && !canRecruit(user.role)) {
      throw new ApiError(403, "Only Admins and Recruiters can add candidates.");
    }
    const body = await req.json();
    const reqId = String(body.reqId || "");
    if (!reqId) throw new ApiError(400, "reqId required.");
    const r = await getRequisition(reqId);
    if (!r) throw new ApiError(404, "Requisition not found.");
    if (user.role === "Admin" && r.recruiterEmail) {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      if (!teamEmails.has(r.recruiterEmail)) {
        throw new ApiError(403, "This requisition is outside your managed team.");
      }
    }
    if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (
      r.status !== "Approved" &&
      r.status !== "Position Reopened" &&
      r.status !== "Partially Fulfilled"
    ) {
      throw new ApiError(403, "Wait until the requisition is approved.");
    }

    const resumeText = body.resumeText ? String(body.resumeText).trim() : "";
    const consentCaptured = body.consentCaptured === true || body.consentCaptured === "true";
    const extractedName = body.extractedName ? String(body.extractedName).trim() : "";
    const extractedEmail = body.extractedEmail ? String(body.extractedEmail).trim() : "";
    const extractedPhone = body.extractedPhone ? String(body.extractedPhone).trim() : "";

    const name = String(body.name || extractedName || "").trim();
    const email = String(body.email || extractedEmail || "").trim();
    const phone = String(body.phone || extractedPhone || "").trim();
    const location = indianCityLabel(body.location);
    if (!location) throw new ApiError(400, "Choose an Indian city from the location suggestions.");
    const currentCtc = String(body.currentCtc || "").trim();
    const currentFixedCtc = String(body.currentFixedCtc || currentCtc).trim();
    const currentVariableCtc = String(body.currentVariableCtc || "").trim();
    const presentEsops = String(body.presentEsops || "").trim();
    const expectedCtc = String(body.expectedCtc || "").trim();
    const notice = String(body.notice || "").trim();
    const configuredFields = (await getOrg()).candidateCustomFields || [];
    const suppliedFields = body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields) ? body.customFields as Record<string, unknown> : {};
    const customFields = configuredFields.filter((field) => field.enabled).map((field) => {
      const raw = suppliedFields[field.id];
      if (raw !== undefined && typeof raw !== "string") throw new ApiError(400, `Enter a valid value for ${field.label}.`);
      const value = typeof raw === "string" ? raw.trim() : "";
      if (value.length > 500) throw new ApiError(400, `${field.label} must be 500 characters or fewer.`);
      if (field.required && !value) throw new ApiError(400, `${field.label} is required.`);
      return { id: field.id, label: field.label, value };
    }).filter((field) => field.value);
    if (!name || !email) {
      throw new ApiError(400, "Name and email are required.");
    }
    if (!phone || !location || !currentFixedCtc || !currentVariableCtc || !presentEsops || !expectedCtc || !notice) {
      throw new ApiError(
        400,
        "Phone, location, fixed CTC, variable CTC, present ESOPs, expected CTC, and notice period are required."
      );
    }
    if (![currentFixedCtc, currentVariableCtc, presentEsops, expectedCtc].every((value) => /^\d+$/.test(value))) {
      throw new ApiError(400, "CTC and ESOP fields must contain numbers only.");
    }
    if (!/^\d{1,2}$/.test(notice)) {
      throw new ApiError(400, "Notice period must be a number up to 2 digits.");
    }
    if (!body.cvBase64 || !body.cvFileName) {
      throw new ApiError(400, "Resume upload is required.");
    }

    const candidateProfileId = String(body.candidateProfileId || "");
    const profileMatches = await findCandidateProfilesByContact(email, phone);
    if (profileMatches.length) {
      const allCandidates = await listCandidates();
      const requisitions = await listRequisitions();
      const managedRecruiters = user.role === "Admin"
        ? new Set((await listUsers()).filter((member) => member.role === "Recruiter" && member.managerEmail === user.email).map((member) => member.email))
        : new Set<string>();
      const visibleReqIds = new Set(requisitions.filter((requisition) => user.role === "Admin"
        ? !requisition.recruiterEmail || managedRecruiters.has(requisition.recruiterEmail)
        : isAssignedRecruiter(requisition, user.email)).map((requisition) => requisition.id));
      const visibleProfileIds = new Set(allCandidates.filter((candidate) => candidate.reqId === "TALENT_POOL" || visibleReqIds.has(candidate.reqId)).map((candidate) => candidate.profileId).filter(Boolean));
      const visibleMatches = profileMatches.filter((profile) => visibleProfileIds.has(profile.id));
      if (visibleMatches.length !== profileMatches.length) {
        return json({ error: "A possible match exists outside your candidate access. Ask an Admin to review it.", code: "CANDIDATE_MATCH_REVIEW" }, 409);
      }
      if (candidateProfileId && !visibleMatches.some((profile) => profile.id === candidateProfileId)) {
        throw new ApiError(400, "Select a matching existing candidate profile.");
      }
      if (!candidateProfileId) {
        return json({
          error: "A candidate with this email or phone already exists. Select the existing profile to create another application without duplicating the candidate.",
          code: "CANDIDATE_PROFILE_MATCH",
          matches: visibleMatches.map((profile) => ({ profileId: profile.id, candidateId: profile.candidateId, name: profile.name })),
        }, 409);
      }
    } else if (candidateProfileId) {
      throw new ApiError(400, "Select a matching existing candidate profile.");
    }
    if (resumeText && !consentCaptured) {
      throw new ApiError(400, "Please confirm recruiter consent before saving resume-extracted candidate details.");
    }

    let cvPath: string | undefined;
    let cvFileName: string | undefined;
    if (body.cvBase64 && body.cvFileName) {
      cvFileName = String(body.cvFileName);
      cvPath = `cvs/${reqId}/${Date.now()}_${cvFileName}`;
      const bucket = adminStorage()?.bucket();
      if (bucket) {
        const buf = Buffer.from(String(body.cvBase64), "base64");
        await bucket.file(cvPath).save(buf, {
          metadata: { contentType: body.cvMime || "application/pdf" },
        });
      }
    }

    const source = body.source ? String(body.source).trim() : undefined;
    let sourceDetail = body.sourceDetail
      ? String(body.sourceDetail).trim()
      : undefined;
    let referrerEmail: string | undefined;
    const sourceVendorId = String(body.sourceVendorId || "").trim();
    const sourceSubscriptionId = String(body.sourceSubscriptionId || "").trim();
    const sourceNotes = String(body.sourceNotes || "").trim();
    if (source) {
      const allowed = new Set([
        "Job Board",
        "Employee Referral",
        "Consultant",
        "Direct / Inbound",
        "Walk-in",
        "Career Page",
        "Social Media",
        "Campus Hiring",
        "Other",
      ]);
      if (!allowed.has(source)) {
        throw new ApiError(400, "Invalid candidate source.");
      }
      if (source === "Job Board" && !sourceDetail && !sourceSubscriptionId) {
        throw new ApiError(400, "Select a job board.");
      }
      if (source === "Employee Referral" && !sourceDetail) {
        throw new ApiError(400, "Employee code is required for referrals.");
      }
      if (source === "Employee Referral") {
        const employee = (await listUsers()).find((member) => member.active !== false && member.employeeCode?.trim().toLowerCase() === sourceDetail?.toLowerCase());
        if (!employee?.employeeCode) throw new ApiError(400, "Choose an active employee code from Teams & Access.");
        sourceDetail = employee.employeeCode.trim();
        referrerEmail = employee.email.toLowerCase();
      }
      if (source === "Consultant" && !sourceDetail && !sourceVendorId) {
        throw new ApiError(400, "Select a consultant.");
      }
      if (["Social Media", "Other"].includes(source) && !sourceDetail) {
        throw new ApiError(400, "Enter a source description.");
      }
      const vendorsEnabled = (await getOrg()).vendorsSpendEnabled === true;
      if (vendorsEnabled && source === "Consultant") {
        if (!sourceVendorId) throw new ApiError(400, "Select a managed recruitment consultant.");
        const consultant = (await listVendorSpendRecords<RecruitmentConsultant>("consultants"))
          .find((item) => item.id === sourceVendorId && item.status === "Active");
        if (!consultant) throw new ApiError(400, "Choose an active managed recruitment consultant.");
        sourceDetail = consultant.name;
      }
      if (vendorsEnabled && source === "Job Board") {
        if (!sourceSubscriptionId) throw new ApiError(400, "Select an active managed job board subscription.");
        const subscription = (await listVendorSpendRecords<JobBoardSubscription>("subscriptions"))
          .find((item) => item.id === sourceSubscriptionId && item.status === "Active");
        if (!subscription) throw new ApiError(400, "Choose an active managed job board subscription.");
        sourceDetail = subscription.platformName;
      }
    }

    const cand = await createCandidate({
      customFields,
      reqId,
      name,
      email,
      phone,
      location,
      stage: "New",
      source,
      sourceDetail,
      candidateProfileId: candidateProfileId || undefined,
      referrerEmail,
      sourceVendorId: sourceVendorId || undefined,
      sourceSubscriptionId: sourceSubscriptionId || undefined,
      sourceNotes: sourceNotes || undefined,
      cvPath,
      cvFileName,
      consentCaptured: resumeText ? consentCaptured : undefined,
      consentCapturedAt: resumeText && consentCaptured ? new Date().toISOString() : undefined,
      consentCapturedBy: resumeText && consentCaptured ? user.email : undefined,
      extractedFromResume: !!resumeText,
      extractedName: resumeText ? extractedName || name : undefined,
      extractedPhone: resumeText ? extractedPhone || String(body.phone || "") : undefined,
      extractedEmail: resumeText ? extractedEmail || email : undefined,
    });
    await saveCandidateApplicationSource({
      candidateId: cand.id,
      requisitionId: reqId,
      source: source || "Unknown",
      ...(source === "Consultant" && sourceVendorId ? { consultantId: sourceVendorId } : {}),
      ...(source === "Job Board" && sourceSubscriptionId ? { subscriptionId: sourceSubscriptionId } : {}),
      ...(sourceNotes ? { sourceNotes } : {}),
      submittedAt: cand.createdAt,
      submittedBy: user.email,
    });
    await addAudit({
      action: "candidate.create",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "candidate",
      entityId: cand.id,
      detail: reqId,
    });
    return json({ candidate: cand }, 201);
  } catch (e) {
    return errResponse(e);
  }
}
