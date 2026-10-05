import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  createCandidate,
  getRequisition,
  listCandidates,
  listRequisitions,
  listUsers,
} from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { adminStorage } from "@/lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const reqId = new URL(req.url).searchParams.get("reqId") || undefined;
    let candidates = await listCandidates(reqId);
    if (reqId) {
      const r = await getRequisition(reqId);
      if (!r) throw new ApiError(404, "Requisition not found.");
      if (user.role === "HiringManager" && r.raisedByEmail !== user.email) {
        throw new ApiError(403, "Not your requisition.");
      }
      if (user.role === "DepartmentHead" && !user.departments.some((department) => department.toLowerCase() === r.department.toLowerCase())) {
        throw new ApiError(403, "Not your department.");
      }
      if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
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
            ? { departments: user.departments || [] }
            : undefined
      );
      const teamEmails = user.role === "Admin"
        ? new Set((await listUsers())
            .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
            .map((member) => member.email))
        : new Set<string>();
      const visibleReqs = user.role === "Recruiter"
        ? requisitions.filter((r) => r.recruiterEmail === user.email)
        : user.role === "Admin"
          ? requisitions.filter((r) => !r.recruiterEmail || teamEmails.has(r.recruiterEmail))
          : requisitions;
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
    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
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
    const location = String(body.location || "").trim();
    const currentCtc = String(body.currentCtc || "").trim();
    const currentFixedCtc = String(body.currentFixedCtc || currentCtc).trim();
    const currentVariableCtc = String(body.currentVariableCtc || "").trim();
    const presentEsops = String(body.presentEsops || "").trim();
    const expectedCtc = String(body.expectedCtc || "").trim();
    const notice = String(body.notice || "").trim();
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

    const normalizedEmail = email.toLowerCase();
    const normalizedPhone = phone.replace(/\D/g, "");
    const duplicate = (await listCandidates()).find((candidate) => {
      const sameEmail = candidate.email?.trim().toLowerCase() === normalizedEmail;
      const candidatePhone = candidate.phone?.replace(/\D/g, "") || "";
      return sameEmail || (normalizedPhone && candidatePhone === normalizedPhone);
    });
    if (duplicate) {
      throw new ApiError(
        409,
        `Duplicate candidate detected: ${duplicate.name} already exists for requisition ${duplicate.reqId}.`
      );
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
    const sourceDetail = body.sourceDetail
      ? String(body.sourceDetail).trim()
      : undefined;
    if (source) {
      const allowed = new Set([
        "Job Board",
        "Employee Referral",
        "Consultant",
      ]);
      if (!allowed.has(source)) {
        throw new ApiError(400, "Invalid candidate source.");
      }
      if (source === "Job Board" && !sourceDetail) {
        throw new ApiError(400, "Select a job board.");
      }
      if (source === "Employee Referral" && !sourceDetail) {
        throw new ApiError(400, "Employee code is required for referrals.");
      }
      if (source === "Consultant" && !sourceDetail) {
        throw new ApiError(400, "Select a consultant.");
      }
    }

    const cand = await createCandidate({
      reqId,
      name,
      email,
      phone,
      location,
      stage: "PendingHMApproval",
      currentCtc: currentFixedCtc,
      currentFixedCtc,
      currentVariableCtc,
      presentEsops,
      expectedCtc,
      notice,
      remarks: body.remarks ? String(body.remarks) : undefined,
      source,
      sourceDetail,
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
