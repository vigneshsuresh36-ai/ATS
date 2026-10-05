import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import {
  addAudit,
  createFeedback,
  getCandidate,
  getInterview,
  getPlan,
  getRequisition,
  listCandidates,
  listFeedback,
  listInterviews,
  listStageEvents,
  updateCandidate,
  updateInterview,
  updateRequisition,
} from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { cancelInterviewCalendarEvent } from "@/lib/googleCalendar";
import type { CandidateStage } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const POST_HM_STAGES: CandidateStage[] = [
  "HMApproved",
  "Screened",
  "Shortlist",
  "Interview",
  "Interview Scheduled",
  "Selected",
  "Offered",
  "Onboarded",
  "On Hold",
  "Debrief",
];

function isHmOwner(
  role: string,
  raisedByEmail: string,
  userEmail: string
) {
  return role === "HiringManager" && raisedByEmail === userEmail;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const c = await getCandidate(id);
    if (!c) throw new ApiError(404, "Candidate not found.");
    const requisition = await getRequisition(c.reqId);
    if (!requisition) throw new ApiError(404, "Requisition not found.");
    await requireManagedRequisitionAccess(user, requisition);
    if (user.role === "HiringManager" && requisition.raisedByEmail !== user.email) throw new ApiError(403, "Not your requisition.");
    if (user.role === "DepartmentHead" && !user.departments.some((department) => department.toLowerCase() === requisition.department.toLowerCase())) throw new ApiError(403, "Not your department.");
    if (user.role === "Recruiter" && requisition.recruiterEmail !== user.email) throw new ApiError(403, "This requisition is not assigned to you.");
    const [events, feedback, interviews] = await Promise.all([
      listStageEvents(id),
      listFeedback(id),
      listInterviews({ candidateId: id }),
    ]);
    return json({ candidate: c, requisition: await getRequisition(c.reqId), events, feedback, interviews });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const c = await getCandidate(id);
    if (!c) throw new ApiError(404, "Candidate not found.");
    const r = await getRequisition(c.reqId);
    if (!r) throw new ApiError(404, "Requisition missing.");
    await requireManagedRequisitionAccess(user, r);
    if (user.role === "HiringManager" && r.raisedByEmail !== user.email) throw new ApiError(403, "Not your requisition.");
    if (user.role === "DepartmentHead" && !user.departments.some((department) => department.toLowerCase() === r.department.toLowerCase())) throw new ApiError(403, "Not your department.");
    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) throw new ApiError(403, "This requisition is not assigned to you.");
    if (
      r.status !== "Approved" &&
      r.status !== "Position Reopened" &&
      r.status !== "Partially Fulfilled" &&
      user.role !== "Admin"
    ) {
      throw new ApiError(403, "Requisition not approved.");
    }
    const body = await req.json();
    const isOfferDecision = body.action === "offerApprove" || body.action === "offerReject";
    const isFeedbackAction = body.action === "feedback";
    if (!canRecruit(user.role) && user.role !== "HiringManager" && !isOfferDecision && !isFeedbackAction) {
      throw new ApiError(403, "Not allowed.");
    }
    const hmOwner = isHmOwner(user.role, r.raisedByEmail, user.email);
    const canHmDecide = user.role === "Admin" || hmOwner;

    if (body.action === "candidateBackOut") {
      if (!canRecruit(user.role)) {
        throw new ApiError(403, "Only an Admin or Recruiter can mark a candidate as backed out.");
      }
      if (
        c.stage === "Candidate Backed Out" ||
        c.stage === "Rejected" ||
        c.stage === "Onboarded"
      ) {
        throw new ApiError(400, "This candidate is already in a terminal stage.");
      }
      if (c.offerApprovalStatus === "Pending" || c.offerApprovalStatus === "Approved") {
        throw new ApiError(400, "Resolve the pending offer before marking the candidate as backed out.");
      }

      const reason = String(body.reason || "").trim();
      const updated = await updateCandidate(
        id,
        {
          stage: "Candidate Backed Out",
          backedOutAt: new Date().toISOString(),
          backedOutBy: user.email,
          backOutReason: reason || undefined,
        },
        { byEmail: user.email, from: c.stage, to: "Candidate Backed Out" }
      );
      const interviews = await listInterviews({ candidateId: id });
      const activeInterviews = interviews.filter((interview) =>
        ["Scheduled", "Rescheduled", "Reschedule Requested"].includes(interview.status)
      );
      const calendarFailures: string[] = [];
      await Promise.all(activeInterviews.map(async (interview) => {
        if (interview.calendarEventId) {
          try {
            await cancelInterviewCalendarEvent(interview.calendarEventId);
          } catch (error) {
            calendarFailures.push(interview.id);
            console.error("Could not cancel interview calendar event", error);
          }
        }
        await updateInterview(interview.id, { status: "Cancelled" });
      }));
      await addAudit({
        action: "candidate.backed_out",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "candidate",
        entityId: id,
        detail: reason || `${activeInterviews.length} active interview(s) cancelled`,
      });
      return json({
        candidate: updated,
        cancelledInterviews: activeInterviews.length,
        calendarCancellationFailures: calendarFailures,
      });
    }

    if (body.action === "hmApprove" || body.action === "hmReject") {
      if (!canHmDecide) {
        throw new ApiError(403, "Only the hiring manager (or Admin) can decide.");
      }
      if (c.stage !== "PendingHMApproval") {
        throw new ApiError(400, "Candidate is not pending HM approval.");
      }
      const to: CandidateStage =
        body.action === "hmApprove" ? "HMApproved" : "Rejected";
      const reason =
        body.action === "hmReject"
          ? String(body.reason || "").trim() || "Rejected by hiring manager"
          : undefined;
      const updated = await updateCandidate(
        id,
        {
          stage: to,
          hmDecisionBy: user.email,
          hmDecisionAt: new Date().toISOString(),
          hmRejectReason: reason,
        },
        { byEmail: user.email, from: c.stage, to }
      );
      await addAudit({
        action:
          body.action === "hmApprove"
            ? "candidate.hm_approve"
            : "candidate.hm_reject",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "candidate",
        entityId: id,
        detail: reason,
      });
      return json({ candidate: updated });
    }

    if (body.action === "stage") {
      if (!canRecruit(user.role) && !hmOwner) {
        throw new ApiError(403, "Not allowed to change stage.");
      }
      const to = body.stage as CandidateStage;
      if (!to) throw new ApiError(400, "stage required.");
      // HM cannot freely move pending candidates — use hmApprove/hmReject
      if (
        user.role === "HiringManager" &&
        (c.stage === "PendingHMApproval" || to === "PendingHMApproval")
      ) {
        throw new ApiError(
          400,
          "Use Approve / Reject for candidates pending your approval."
        );
      }
      // Interview pipeline stages require HM approval first
      if (
        canRecruit(user.role) &&
        c.stage === "PendingHMApproval" &&
        POST_HM_STAGES.includes(to)
      ) {
        throw new ApiError(
          403,
          "Wait for hiring-manager approval before advancing this candidate."
        );
      }

      const interviews = await listInterviews({ candidateId: id });
      const maxRound = interviews
        .filter((iv) => iv.status !== "Cancelled")
        .reduce((m, iv) => Math.max(m, iv.roundIndex || 1), 0);
      const lastAdvanced = c.lastAdvancedRound ?? 0;
      const plan = await getPlan(c.reqId);
      const configuredRounds = getInterviewRounds(plan).length;
      const roundsComplete =
        configuredRounds > 0
          ? lastAdvanced >= configuredRounds
          : maxRound > 0 && lastAdvanced >= maxRound;

      const workflowLocked = new Set<CandidateStage>([
        "PendingHMApproval",
        "HMApproved",
        "Screened",
        "Shortlist",
        "Interview",
        "Interview Scheduled",
        "Debrief",
        "OfferApprovalPending",
        "OfferApproved",
      ]);
      if (
        workflowLocked.has(c.stage) ||
        (c.stage === "Selected" && !roundsComplete)
      ) {
        throw new ApiError(
          400,
          "Stage is managed by the interview workflow (schedule → feedback → debrief). Manual updates unlock after all rounds are complete."
        );
      }

      const allowedOutcomes: CandidateStage[] = [
        "Selected",
        "Offered",
        "Onboarded",
        "Rejected",
        "On Hold",
      ];
      if (!allowedOutcomes.includes(to)) {
        throw new ApiError(
          400,
          "After interviews, stage can only be Selected, Offered, Onboarded, Rejected, or On Hold."
        );
      }

      const updated = await updateCandidate(
        id,
        { stage: to },
        { byEmail: user.email, from: c.stage, to }
      );
      await addAudit({
        action: "candidate.stage",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "candidate",
        entityId: id,
        detail: `${c.stage} → ${to}`,
      });
      return json({ candidate: updated });
    }

    if (body.action === "archive") {
      if (!canRecruit(user.role)) throw new ApiError(403, "Not allowed.");
      const updated = await updateCandidate(id, { archived: true });
      return json({ candidate: updated });
    }

    if (body.action === "feedback") {
      const interviewId = body.interviewId
        ? String(body.interviewId)
        : undefined;
      const interview = interviewId ? await getInterview(interviewId) : null;
      const isAssignedInterviewer = !!interview?.interviewerEmails?.some(
        (email) => email.toLowerCase() === user.email.toLowerCase()
      );
      if (!canRecruit(user.role) && !hmOwner && !isAssignedInterviewer) {
        throw new ApiError(403, "Only the assigned interviewer can submit this feedback.");
      }
      if (!interviewId || !interview || interview.candidateId !== id) {
        throw new ApiError(400, "Select the scheduled interview for this feedback.");
      }
      const fb = await createFeedback({
        candidateId: id,
        reqId: c.reqId,
        interviewId,
        interviewer: String(body.interviewer || user.name),
        stage: String(body.stage || c.stage),
        rating: Number(body.rating) || 0,
        recommendation: String(body.recommendation || ""),
        feedback: String(body.feedback || ""),
        createdBy: user.email,
      });
      if (interviewId) {
        await updateInterview(interviewId, { status: "Completed" });
      }
      if (
        c.stage === "Interview Scheduled" ||
        c.stage === "Interview" ||
        c.stage === "Selected"
      ) {
        await updateCandidate(
          id,
          { stage: "Debrief" },
          { byEmail: user.email, from: c.stage, to: "Debrief" }
        );
      }
      return json({ feedback: fb }, 201);
    }

    if (body.action === "debrief") {
      if (!canRecruit(user.role) && !hmOwner) {
        throw new ApiError(403, "Not allowed.");
      }
      if (c.stage === "PendingHMApproval") {
        throw new ApiError(403, "Candidate still pending HM approval.");
      }
      const decision = String(body.decision || "");
      let stage: CandidateStage = c.stage;
      const interviews = await listInterviews({ candidateId: id });
      const maxRound = interviews
        .filter((iv) => iv.status !== "Cancelled")
        .reduce((m, iv) => Math.max(m, iv.roundIndex || 1), 0);
      const patch: Partial<{
        stage: CandidateStage;
        lastAdvancedRound: number;
      }> = {};
      if (decision === "Advance") {
        stage = "Selected";
        patch.stage = stage;
        patch.lastAdvancedRound = maxRound;
        // Mark past rounds complete so UI doesn't keep showing "Scheduled".
        await Promise.all(
          interviews
            .filter(
              (iv) =>
                iv.status !== "Cancelled" &&
                (iv.roundIndex || 1) <= maxRound &&
                iv.status !== "Completed"
            )
            .map((iv) => updateInterview(iv.id, { status: "Completed" }))
        );
      } else if (decision === "Reject") {
        stage = "Rejected";
        patch.stage = stage;
      } else if (decision === "Hold") {
        stage = "On Hold";
        patch.stage = stage;
      } else {
        throw new ApiError(400, "Invalid debrief decision.");
      }
      const updated = await updateCandidate(
        id,
        patch,
        { byEmail: user.email, from: c.stage, to: stage }
      );
      return json({ candidate: updated, decision });
    }

    if (body.action === "offerRequest") {
      if (!canRecruit(user.role)) {
        throw new ApiError(403, "Only an Admin or Recruiter can request offer approval.");
      }
      if (c.stage !== "Selected") {
        throw new ApiError(400, "Candidate must be Selected before requesting offer approval.");
      }
      const plan = await getPlan(c.reqId);
      const configuredRounds = getInterviewRounds(plan).length;
      const lastAdvancedRound = c.lastAdvancedRound || 0;
      if (configuredRounds > 0 && lastAdvancedRound < configuredRounds) {
        throw new ApiError(
          400,
          `Complete all ${configuredRounds} configured interview rounds before moving this candidate to offer approval.`
        );
      }
      const interviews = (await listInterviews({ candidateId: id })).filter(
        (interview) => interview.status !== "Cancelled"
      );
      const feedback = await listFeedback(id);
      const feedbackInterviewIds = new Set(
        feedback.map((item) => item.interviewId).filter(Boolean)
      );
      if (
        interviews.length === 0 ||
        interviews.some((interview) => !feedbackInterviewIds.has(interview.id))
      ) {
        throw new ApiError(
          400,
          "Complete feedback for every interview before moving this candidate to offer approval."
        );
      }
      const tentativeDoj = String(body.tentativeDoj || "").trim();
      const offeredFixedCtc = String(body.offeredFixedCtc || "").trim();
      const offeredVariableCtc = String(body.offeredVariableCtc || "").trim();
      const offeredVariablePeriod = String(body.offeredVariablePeriod || "").trim();
      const offeredEsops = String(body.offeredEsops ?? "").trim();
      const joiningBonus = String(body.joiningBonus ?? "").trim();
      const relocationAssistance = body.relocationAssistance;
      if (!tentativeDoj || !offeredFixedCtc || !offeredVariableCtc || !offeredVariablePeriod || !offeredEsops || !joiningBonus || typeof relocationAssistance !== "boolean") {
        throw new ApiError(400, "Tentative DOJ, fixed and variable CTC, ESOPs, joining bonus, variable period, and relocation assistance are required.");
      }
      if (![offeredFixedCtc, offeredVariableCtc, offeredEsops, joiningBonus].every((value) => /^\d+$/.test(value))) {
        throw new ApiError(400, "Offered CTC, ESOPs, and joining bonus must contain numbers only.");
      }
      if (offeredVariablePeriod !== "Monthly" && offeredVariablePeriod !== "Annually") {
        throw new ApiError(400, "Variable CTC period must be Monthly or Annually.");
      }
      const updated = await updateCandidate(id, {
        stage: "OfferApprovalPending",
        tentativeDoj,
        offeredSalary: offeredFixedCtc,
        offeredFixedCtc,
        offeredVariableCtc,
        offeredVariablePeriod: offeredVariablePeriod as "Monthly" | "Annually",
        offeredEsops,
        joiningBonus,
        relocationAssistance,
        offerApprovalStatus: "Pending",
        offerRequestedBy: user.email,
        offerRequestedAt: new Date().toISOString(),
        offerDecisionBy: undefined,
        offerDecisionAt: undefined,
        offerRejectReason: undefined,
      });
      let updatedRequisition = r;
      const reservedStages = new Set([
        "OfferApprovalPending",
        "OfferApproved",
        "Offered",
        "Onboarded",
      ]);
      const reservedCandidates = await listCandidates(r.id);
      const reservedCount = reservedCandidates.filter(
        (candidate) =>
          candidate.offerApprovalStatus === "Pending" ||
          candidate.offerApprovalStatus === "Approved" ||
          reservedStages.has(candidate.stage)
      ).length;
      const fulfillmentStatus =
        reservedCount >= Math.max(1, r.openings)
          ? "Position Fulfilled"
          : "Partially Fulfilled";
      if (
        r.status === "Approved" ||
        r.status === "Position Reopened" ||
        r.status === "Partially Fulfilled"
      ) {
        updatedRequisition =
          (await updateRequisition(r.id, { status: fulfillmentStatus })) || r;
        await addAudit({
          action: "requisition.fulfillment.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: r.id,
          detail: `${reservedCount}/${Math.max(1, r.openings)} positions reserved for offer`,
        });
      }
      await addAudit({
        action: "candidate.offer_request",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "candidate",
        entityId: id,
        detail: `${tentativeDoj}; fixed=${offeredFixedCtc}; variable=${offeredVariableCtc} ${offeredVariablePeriod}`,
      });
      return json({ candidate: updated, requisition: updatedRequisition });
    }

    if (body.action === "offerApprove" || body.action === "offerReject") {
      if (user.role !== "DepartmentHead" && user.role !== "Admin") {
        throw new ApiError(403, "Only a Department Head can decide offer approval.");
      }
      if (c.offerApprovalStatus !== "Pending") {
        throw new ApiError(400, "Candidate has no pending offer approval request.");
      }
      if (user.role === "DepartmentHead" && !user.departments?.some((d) => d.toLowerCase() === r.department.toLowerCase())) {
        throw new ApiError(403, "This offer is outside your department.");
      }
      const offerRejectReason = body.action === "offerReject"
        ? String(body.reason || "").trim()
        : undefined;
      if (body.action === "offerReject" && !offerRejectReason) {
        throw new ApiError(400, "A rejection reason is required.");
      }
      let approvedOfferTerms: {
        tentativeDoj?: string;
        offeredSalary?: string;
        offeredFixedCtc?: string;
        offeredVariableCtc?: string;
        offeredVariablePeriod?: "Monthly" | "Annually";
        offeredEsops?: string;
        joiningBonus?: string;
        relocationAssistance?: boolean;
      } = {};
      const hasOfferOverride = [
        body.tentativeDoj,
        body.offeredFixedCtc,
        body.offeredVariableCtc,
        body.offeredVariablePeriod,
        body.offeredEsops,
        body.joiningBonus,
        body.relocationAssistance,
      ].some((value) => value !== undefined);
      if (body.action === "offerApprove" && hasOfferOverride) {
        const tentativeDoj = String(body.tentativeDoj ?? c.tentativeDoj ?? "").trim();
        const offeredFixedCtc = String(body.offeredFixedCtc ?? c.offeredFixedCtc ?? c.offeredSalary ?? "").trim();
        const offeredVariableCtc = String(body.offeredVariableCtc ?? c.offeredVariableCtc ?? "").trim();
        const offeredVariablePeriod = String(body.offeredVariablePeriod ?? c.offeredVariablePeriod ?? "").trim();
        const offeredEsops = String(body.offeredEsops ?? c.offeredEsops ?? "").trim();
        const joiningBonus = String(body.joiningBonus ?? c.joiningBonus ?? "").trim();
        const relocationAssistance = body.relocationAssistance ?? c.relocationAssistance;
        if (!tentativeDoj || !offeredFixedCtc || !offeredVariableCtc || !offeredEsops || !joiningBonus || typeof relocationAssistance !== "boolean") {
          throw new ApiError(400, "Tentative DOJ and all proposed offer terms are required to approve updated terms.");
        }
        if (![offeredFixedCtc, offeredVariableCtc, offeredEsops, joiningBonus].every((value) => /^\d+$/.test(value))) {
          throw new ApiError(400, "Offered CTC, ESOPs, and joining bonus must contain numbers only.");
        }
        if (offeredVariablePeriod !== "Monthly" && offeredVariablePeriod !== "Annually") {
          throw new ApiError(400, "Variable CTC period must be Monthly or Annually.");
        }
        approvedOfferTerms = {
          tentativeDoj,
          offeredSalary: offeredFixedCtc,
          offeredFixedCtc,
          offeredVariableCtc,
          offeredVariablePeriod,
          offeredEsops,
          joiningBonus,
          relocationAssistance,
        };
      }
      const offerApprovalStatus = body.action === "offerApprove" ? "Approved" : "Rejected";
      const nextStage: CandidateStage = body.action === "offerApprove"
        ? "OfferApproved"
        : "Selected";
      const updated = await updateCandidate(id, {
        ...approvedOfferTerms,
        stage: nextStage,
        offerApprovalStatus,
        offerDecisionBy: user.email,
        offerDecisionAt: new Date().toISOString(),
        offerRejectReason,
      });
      let updatedRequisition = r;
      if (body.action === "offerApprove") {
        const filledStages = new Set(["OfferApproved", "Offered", "Onboarded"]);
        const candidates = await listCandidates(r.id);
        const filledCount = candidates.filter((candidate) =>
          filledStages.has(candidate.stage)
        ).length;
        const fulfillmentStatus =
          filledCount >= Math.max(1, r.openings)
            ? "Position Fulfilled"
            : "Partially Fulfilled";
        if (
          r.status === "Approved" ||
          r.status === "Position Reopened" ||
          r.status === "Partially Fulfilled"
        ) {
          updatedRequisition =
            (await updateRequisition(r.id, { status: fulfillmentStatus })) || r;
          await addAudit({
            action: "requisition.fulfillment.update",
            actorEmail: user.email,
            actingAdminEmail: user.actingAdminEmail,
            entityType: "requisition",
            entityId: r.id,
            detail: `${filledCount}/${Math.max(1, r.openings)} positions filled`,
          });
        }
      }
      await addAudit({
        action: `candidate.offer_${body.action === "offerApprove" ? "approve" : "reject"}`,
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "candidate",
        entityId: id,
        detail: offerRejectReason,
      });
      return json({ candidate: updated, requisition: updatedRequisition });
    }

    if (!canRecruit(user.role)) throw new ApiError(403, "Not allowed.");
    const patch: Record<string, unknown> = {};
    for (const k of [
      "name",
      "email",
      "phone",
      "location",
      "currentCtc",
      "currentFixedCtc",
      "currentVariableCtc",
      "expectedCtc",
      "notice",
      "remarks",
      "source",
      "sourceDetail",
    ]) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    const updated = await updateCandidate(id, patch);
    return json({ candidate: updated });
  } catch (e) {
    return errResponse(e);
  }
}
