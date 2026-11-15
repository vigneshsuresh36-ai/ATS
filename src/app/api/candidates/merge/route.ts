import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, getCandidateProfile, listCandidates, listRequisitions, listUsers, mergeCandidateProfiles } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (user.role !== "Admin") throw new ApiError(403, "Only Admins can merge candidate profiles.");
    const body = await req.json();
    const primaryId = String(body.primaryProfileId || "").trim();
    const duplicateId = String(body.duplicateProfileId || "").trim();
    if (!primaryId || !duplicateId || primaryId === duplicateId) throw new ApiError(400, "Choose two different candidate profiles.");

    const [primary, duplicate, requisitions, users, candidates] = await Promise.all([
      getCandidateProfile(primaryId),
      getCandidateProfile(duplicateId),
      listRequisitions(),
      listUsers(),
      listCandidates(),
    ]);
    if (!primary || !duplicate) throw new ApiError(404, "Candidate profile not found.");
    const managedRecruiters = new Set(users
      .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
      .map((member) => member.email));
    const visibleRequisitions = new Set(requisitions
      .filter((requisition) => !requisition.recruiterEmail || managedRecruiters.has(requisition.recruiterEmail))
      .map((requisition) => requisition.id));
    const inaccessibleApplication = candidates.find((candidate) =>
      (candidate.profileId === primaryId || candidate.profileId === duplicateId) &&
      candidate.reqId !== "TALENT_POOL" && !visibleRequisitions.has(candidate.reqId)
    );
    if (inaccessibleApplication) throw new ApiError(403, "Both profiles must be within your managed candidate access to merge them.");

    const merged = await mergeCandidateProfiles(primaryId, duplicateId);
    await addAudit({
      action: "candidate.profile.merge",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "candidate",
      entityId: primaryId,
      detail: `${duplicate.candidateId} merged into ${primary.candidateId}`,
    });
    return json({ profileId: merged.id, candidateId: merged.candidateId, candidateIdAliases: merged.candidateIdAliases });
  } catch (error) {
    return errResponse(error);
  }
}
