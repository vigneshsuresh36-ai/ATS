import { indianCityLabel } from "@/lib/indianCities";
import { ApiError, errResponse, json } from "@/lib/auth";
import {
  addAudit,
  createCandidate,
  findCandidateProfilesByContact,
  listCandidates,
  listStageEvents,
} from "@/lib/db";
import { adminStorage } from "@/lib/firebaseAdmin";
import { getActiveSocialApplication } from "@/lib/socialApplications";
import { isTalentPoolEligible } from "@/lib/talentPool";
import { applicationSourceForLink } from "@/lib/applicationSource";

type Ctx = { params: Promise<{ token: string }> };
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const RESUME_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".txt"]);

export async function POST(req: Request, ctx: Ctx) {
  let uploadedCvPath: string | undefined;
  let candidateSaved = false;
  try {
    const { token } = await ctx.params;
    const application = await getActiveSocialApplication(token);
    if (!application) throw new ApiError(404, "This application link is no longer available.");
    const { link, requisition } = application;
    const isEmployeeReferral = link.kind === "employee-referral";
    const body = await req.json();

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const location = indianCityLabel(body.location);
    if (!location) throw new ApiError(400, "Choose an Indian city from the location suggestions.");
    const currentFixedCtc = String(body.currentFixedCtc || "").trim();
    const currentVariableCtc = String(body.currentVariableCtc || "").trim();
    const presentEsops = String(body.presentEsops ?? "").trim();
    const expectedCtc = String(body.expectedCtc || "").trim();
    const notice = String(body.notice || "").trim();
    const remarks = String(body.remarks || "").trim();
    const skills = Array.isArray(body.skills)
      ? body.skills.map((skill: unknown) => String(skill).trim()).filter(Boolean).slice(0, 50)
      : String(body.skills || "").split(",").map((skill) => skill.trim()).filter(Boolean).slice(0, 50);
    const experienceYears = body.experienceYears === "" || body.experienceYears === undefined
      ? undefined
      : Number(body.experienceYears);
    const cvBase64 = String(body.cvBase64 || "").trim();
    const cvFileName = String(body.cvFileName || "").trim();
    const cvExtension = cvFileName.slice(cvFileName.lastIndexOf(".")).toLowerCase();

    if (!name || !email || !location) throw new ApiError(400, "Name, email, and location are required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
    if (!/^\d{10}$/.test(phone)) throw new ApiError(400, "Phone must contain exactly 10 digits.");
    if (![currentFixedCtc, currentVariableCtc, presentEsops, expectedCtc].every((value) => /^\d+$/.test(value))) {
      throw new ApiError(400, "Enter numbers only for fixed, variable, ESOP, and expected CTC.");
    }
    if (!/^\d{1,2}$/.test(notice)) throw new ApiError(400, "Notice period must be from 0 to 99 days.");
    if (experienceYears !== undefined && (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 60)) {
      throw new ApiError(400, "Experience must be a whole number from 0 to 60 years.");
    }
    if (remarks.length > 3000) throw new ApiError(400, "Remarks must be 3,000 characters or fewer.");
    if (!cvBase64 || !cvFileName || !RESUME_EXTENSIONS.has(cvExtension)) {
      throw new ApiError(400, "Upload a PDF, DOC, DOCX, or TXT resume.");
    }
    const resumeBuffer = Buffer.from(cvBase64, "base64");
    if (!resumeBuffer.length || resumeBuffer.length > MAX_RESUME_BYTES) {
      throw new ApiError(400, "Resume must be smaller than 10 MB.");
    }

    const profileMatches = await findCandidateProfilesByContact(email, phone);
    if (profileMatches.length > 1) {
      throw new ApiError(409, "We found more than one profile matching your contact details. Please contact the recruiter to continue.");
    }
    const existingProfile = profileMatches[0];
    if (existingProfile) {
      const existingApplication = (await listCandidates(requisition.id)).find((candidate) => candidate.profileId === existingProfile.id);
      if (existingApplication) {
        const history = await listStageEvents(existingApplication.id);
        if (!isTalentPoolEligible(existingApplication, history)) {
          throw new ApiError(409, "An application with this email or phone is already active for this position.");
        }
      }
    } else {
      const unbackfilledMatch = (await listCandidates()).find((candidate) =>
        !candidate.profileId && (candidate.email.trim().toLowerCase() === email || candidate.phone.replace(/\D/g, "") === phone)
      );
      if (unbackfilledMatch) {
        throw new ApiError(409, "This candidate record needs profile migration before another application can be linked. Please contact the recruiter.");
      }
    }

    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "Resume storage is not configured. Please contact the recruiter.");
    const safeFileName = cvFileName.replace(/[^\w.\- ()]+/g, "_");
    uploadedCvPath = `cvs/${requisition.id}/${Date.now()}_${safeFileName}`;
    await bucket.file(uploadedCvPath).save(resumeBuffer, {
      metadata: { contentType: String(body.cvMime || "application/octet-stream") },
    });

    const candidateFields = {
      name,
      email,
      phone,
      location,
      stage: isEmployeeReferral ? "New" as const : "Social CV" as const,
      currentCtc: currentFixedCtc,
      currentFixedCtc,
      currentVariableCtc,
      presentEsops,
      expectedCtc,
      experienceYears,
      skills,
      notice,
      remarks: remarks || undefined,
      source: applicationSourceForLink(link.kind),
      sourceDetail: isEmployeeReferral ? link.referrerEmail : link.recruiterEmail,
      employeeReferralBonus: isEmployeeReferral ? link.referralBonus || requisition.referralBonus || 0 : undefined,
      cvPath: uploadedCvPath,
      cvFileName: safeFileName,
    };

    const candidate = await createCandidate({
      ...(existingProfile ? { candidateProfileId: existingProfile.id } : {}),
      reqId: requisition.id,
      ...candidateFields,
    });
    candidateSaved = !!candidate;

    await addAudit({
      action: isEmployeeReferral ? "candidate.employee_referral_apply" : link.kind === "career" ? "candidate.careers_apply" : "candidate.social_apply",
      actorEmail: email,
      entityType: "candidate",
      entityId: candidate!.id,
      detail: isEmployeeReferral
        ? `${requisition.id}; referrer=${link.referrerEmail}; ${existingProfile ? "reused profile" : "new profile"}`
        : `${requisition.id}; recruiter=${link.recruiterEmail}; ${existingProfile ? "reused profile" : "new profile"}`,
    });
    return json({ submitted: true }, 201);
  } catch (error) {
    if (uploadedCvPath && !candidateSaved) {
      try {
        await adminStorage()?.bucket().file(uploadedCvPath).delete({ ignoreNotFound: true });
      } catch (cleanupError) {
        console.error("Could not clean up failed social application resume upload", cleanupError);
      }
    }
    return errResponse(error);
  }
}
