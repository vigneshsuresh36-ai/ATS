import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, createCandidate, findCandidateProfilesByContact, listAllFeedback, listCandidates, listInterviews, listRequisitions, listStageEvents, listUsers } from "@/lib/db";
import { isTalentPoolEligible, scoreCandidate, UNASSIGNED_TALENT_POOL_REQ_ID } from "@/lib/talentPool";
import type { InterviewFeedback } from "@/lib/types";
import { adminStorage } from "@/lib/firebaseAdmin";

const OPEN_STATUSES = new Set(["Approved", "Position Reopened", "Partially Fulfilled"]);

async function visibleRequisitions(user: Awaited<ReturnType<typeof requireUser>>) {
  if (user.role === "Recruiter") {
    return (await listRequisitions()).filter((req) => isAssignedRecruiter(req, user.email));
  }
  const requisitions = await listRequisitions();
  if (user.role !== "Admin") return [];
  const teamEmails = new Set((await listUsers())
    .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
    .map((member) => member.email));
  return requisitions.filter((req) => !req.recruiterEmail || teamEmails.has(req.recruiterEmail));
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can access the Talent Pool.");
    }
    const params = new URL(req.url).searchParams;
    if (params.get("scope") === "unassigned") {
      const [candidates, events] = await Promise.all([listCandidates(), listStageEvents()]);
      return json({ candidates: candidates
        .filter((candidate) => candidate.reqId === UNASSIGNED_TALENT_POOL_REQ_ID && isTalentPoolEligible(candidate, events))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)) });
    }
    const reqId = params.get("reqId") || "";
    const includeAll = params.get("scope") === "all";
    if (!reqId && !includeAll) throw new ApiError(400, "Select an open position.");

    const requisitions = await visibleRequisitions(user);
    const target = requisitions.find((item) => item.id === reqId);
    if (reqId && !target) throw new ApiError(403, "This position is not assigned to you.");
    if (target && !OPEN_STATUSES.has(target.status)) throw new ApiError(400, "Select an opened position.");

    const visibleIds = new Set(requisitions.map((item) => item.id));
    const [candidates, events, interviews, feedback, allRequisitions] = await Promise.all([
      listCandidates(),
      listStageEvents(),
      listInterviews(),
      listAllFeedback(),
      listRequisitions(),
    ]);
    const reqTitles = new Map(allRequisitions.map((item) => [item.id, item.title]));
    const results = candidates
      .filter((candidate) => isTalentPoolEligible(candidate, events))
      .map((candidate) => {
        const candidateInterviews = interviews
          .filter((interview) => interview.candidateId === candidate.id)
          .sort((left, right) => right.datetime.localeCompare(left.datetime));
        const candidateFeedback = feedback.filter((item) => item.candidateId === candidate.id);
        const linkedFeedbackIds = new Set(candidateInterviews.map((interview) => interview.id));
        const history: {
          reqId: string;
          reqTitle: string;
          roundName: string;
          datetime: string;
          status: string;
          interviewers: string[];
          feedback: InterviewFeedback[];
        }[] = candidateInterviews.map((interview) => ({
          reqId: interview.reqId,
          reqTitle: reqTitles.get(interview.reqId) || interview.reqId,
          roundName: interview.roundName || interview.stage || `Round ${interview.roundIndex || 1}`,
          datetime: interview.datetime,
          status: interview.status,
          interviewers: interview.interviewerEmails || [],
          feedback: candidateFeedback.filter((item) => item.interviewId === interview.id),
        }));
        history.push(...candidateFeedback
          .filter((item) => !item.interviewId || !linkedFeedbackIds.has(item.interviewId))
          .map((item) => ({
            reqId: item.reqId,
            reqTitle: reqTitles.get(item.reqId) || item.reqId,
            roundName: item.stage || "Interview feedback",
            datetime: item.createdAt,
            status: "Feedback recorded",
            interviewers: [item.interviewer],
            feedback: [item],
          })));
        return {
          candidate,
          canViewDetails: visibleIds.has(candidate.reqId),
          alreadyAssigned: !!reqId && candidate.reqId === reqId,
          history,
          ...(target ? scoreCandidate(candidate, target) : { score: 0, matchedSkills: [], requiredSkills: [] }),
        };
      })
      .sort((left, right) => target
        ? right.score - left.score || left.candidate.name.localeCompare(right.candidate.name)
        : right.candidate.createdAt.localeCompare(left.candidate.createdAt));

    return json({
      candidates: results,
      requisition: target || null,
      totalCandidates: candidates.length,
      activeInPool: results.length,
    });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin" && user.role !== "Recruiter") {
      throw new ApiError(403, "Only Admins and Recruiters can add resumes to the Talent Pool.");
    }

    const body = await req.json();
    const fileName = String(body.fileName || "").trim();
    const base64 = String(body.base64 || "");
    const name = String(body.name || "").trim() || "Unnamed candidate";
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const sourceDetail = String(body.sourceDetail || "").trim();
    if (!fileName || !base64) throw new ApiError(400, "Select a resume file.");
    const currentCtc = String(body.currentCtc || "").trim();
    const expectedCtc = String(body.expectedCtc || "").trim();
    if ([currentCtc, expectedCtc].some((value) => value && !/^\d+$/.test(value))) throw new ApiError(400, "CTC values must contain numbers only.");
    const safeFileName = fileName.replace(/[^\w.\- ()]+/g, "_");
    if (!/\.(pdf|doc|docx|txt)$/i.test(safeFileName)) {
      throw new ApiError(400, "Upload a PDF, DOC, DOCX, or text resume.");
    }
    const resumeBuffer = Buffer.from(base64, "base64");
    if (!resumeBuffer.length || resumeBuffer.length > 8 * 1024 * 1024) {
      throw new ApiError(400, "Each resume must be smaller than 8 MB.");
    }
    const candidateProfileId = String(body.candidateProfileId || "");
    const profileMatches = await findCandidateProfilesByContact(email, phone);
    if (profileMatches.length) {
      const candidates = await listCandidates();
      const visibleReqIds = new Set((await visibleRequisitions(user)).map((item) => item.id));
      const visibleProfileIds = new Set(candidates.filter((candidate) => candidate.reqId === UNASSIGNED_TALENT_POOL_REQ_ID || visibleReqIds.has(candidate.reqId)).map((candidate) => candidate.profileId).filter(Boolean));
      const visibleMatches = profileMatches.filter((profile) => visibleProfileIds.has(profile.id));
      if (visibleMatches.length !== profileMatches.length) {
        return json({ error: "A possible match exists outside your candidate access. Ask an Admin to review it.", code: "CANDIDATE_MATCH_REVIEW" }, 409);
      }
      if (candidateProfileId && !visibleMatches.some((profile) => profile.id === candidateProfileId)) {
        throw new ApiError(400, "Select a matching existing candidate profile.");
      }
      if (!candidateProfileId) {
        return json({
          error: "A candidate with this email or phone already exists. Select the existing profile to add it to the Talent Pool without creating a duplicate.",
          code: "CANDIDATE_PROFILE_MATCH",
          matches: visibleMatches.map((profile) => ({ profileId: profile.id, candidateId: profile.candidateId, name: profile.name })),
        }, 409);
      }
    } else if (candidateProfileId) {
      throw new ApiError(400, "Select a matching existing candidate profile.");
    }

    const bucket = adminStorage()?.bucket();
    if (!bucket) throw new ApiError(503, "File storage is not configured.");
    const cvPath = `cvs/talent-pool/${randomUUID()}_${safeFileName}`;
    await bucket.file(cvPath).save(resumeBuffer, {
      metadata: { contentType: String(body.mime || "application/octet-stream") },
    });

    const candidate = await createCandidate({
      candidateProfileId: candidateProfileId || undefined,
      reqId: UNASSIGNED_TALENT_POOL_REQ_ID,
      name,
      email,
      phone,
      location: String(body.location || "").trim(),
      stage: "New",
      skills: Array.isArray(body.skills) ? body.skills.map((skill: unknown) => String(skill).trim()).filter(Boolean) : [],
      experienceYears: Number.isInteger(Number(body.experienceYears)) && body.experienceYears !== "" ? Number(body.experienceYears) : undefined,
      source: "Talent Pool",
      sourceDetail,
      currentCtc: currentCtc || undefined,
      currentFixedCtc: currentCtc || undefined,
      expectedCtc: expectedCtc || undefined,
      remarks: String(body.remarks || "").trim() || undefined,
      cvPath,
      cvFileName: safeFileName,
      consentCaptured: body.consentCaptured === true,
      consentCapturedAt: body.consentCaptured === true ? new Date().toISOString() : undefined,
      consentCapturedBy: body.consentCaptured === true ? user.email : undefined,
      extractedFromResume: true,
      extractedName: String(body.extractedName || body.name || "").trim() || undefined,
      extractedEmail: String(body.extractedEmail || email).trim(),
      extractedPhone: String(body.extractedPhone || phone).replace(/\D/g, ""),
    });
    await addAudit({
      action: "talent_pool.resume_saved",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "candidate",
      entityId: candidate.id,
      detail: sourceDetail,
    });
    return json({ candidate }, 201);
  } catch (error) {
    return errResponse(error);
  }
}
