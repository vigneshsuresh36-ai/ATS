import { canViewScopedRequisition } from "@/lib/requisitionScope";
import { indianCityLabel } from "@/lib/indianCities";
import { canReopenApplication } from "@/lib/candidateReopening";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { normalizeQuestion, validFeedbackAnswer } from "@/lib/feedbackForms";
import { systemStatusAudit } from "@/lib/statusAudit";
import { referralEmail } from "@/lib/referrerIdentity";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import {
  addAudit,
  createReferralPayout,
  createJoiningReferralPayout,
  createPlacementFeeForJoinedCandidate,
  createFeedback,
  getCandidate,
  getInterview,
  getOrg,
  getPlan,
  getRequisition,
  listAllFeedback,
  listFeedback,
  listInterviews,
  listRequisitions,
  listStageEvents,
  listUsers,
  reopenCandidateApplication,
  updateCandidate,
  updateFeedback,
  updateInterview,
} from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { cancelInterviewCalendarEvent } from "@/lib/googleCalendar";
import { transitionOffer } from "@/lib/db/offerCapacity";
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
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
    const [events, feedback, interviews, allInterviews, allFeedback, allRequisitions] = await Promise.all([
      listStageEvents(id),
      listFeedback(id),
      listInterviews({ candidateId: id, reqId: c.reqId }),
      listInterviews({ candidateId: id }),
      listAllFeedback(),
      listRequisitions(),
    ]);
    const reqTitles = new Map(allRequisitions.map((item) => [item.id, item.title]));
    const historyReqIds = new Set(allRequisitions.filter((item) => item.id !== c.reqId && canViewScopedRequisition(user, item)).map((item) => item.id));
    const historicalInterviews = allInterviews.filter((item) => historyReqIds.has(item.reqId));
    const historicalIds = new Set(historicalInterviews.map((item) => item.id));
    const historyFeedback = allFeedback.filter((item) => item.candidateId === id && historyReqIds.has(item.reqId));
    const interviewHistory: {
      reqId: string;
      reqTitle: string;
      roundName: string;
      datetime: string;
      status: string;
      interviewers: string[];
      feedback: typeof allFeedback;
    }[] = historicalInterviews.map((interview) => ({
      reqId: interview.reqId,
      reqTitle: reqTitles.get(interview.reqId) || interview.reqId,
      roundName: interview.roundName || interview.stage || `Round ${interview.roundIndex || 1}`,
      datetime: interview.datetime,
      status: interview.status,
      interviewers: interview.interviewerEmails || [],
      feedback: historyFeedback.filter((item) => item.interviewId === interview.id),
    }));
    interviewHistory.push(...historyFeedback
      .filter((item) => !item.interviewId || !historicalIds.has(item.interviewId))
      .map((item) => ({
        reqId: item.reqId,
        reqTitle: reqTitles.get(item.reqId) || item.reqId,
        roundName: item.stage || "Interview feedback",
        datetime: item.createdAt,
        status: "Feedback recorded",
        interviewers: [item.interviewer],
        feedback: [item],
      })));
    return json({
      candidate: c,
      requisition,
      events,
      feedback: feedback.filter((item) => item.reqId === c.reqId),
      interviews,
      interviewHistory,
    });
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
    if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) throw new ApiError(403, "This requisition is not assigned to you.");
    const body = await req.json();
    const fulfilledOfferAction = r.status === "Position Fulfilled" && (body.action === "offerApprove" || body.action === "offerReject" || (c.offerApprovalStatus === "Approved" && (body.action === "candidateBackOut" || (body.action === "stage" && ["Offered", "Onboarded"].includes(body.stage)))));
    if (
      r.status !== "Approved" &&
      r.status !== "Position Reopened" &&
      r.status !== "Partially Fulfilled" &&
      user.role !== "Admin" && !fulfilledOfferAction
    ) {
      throw new ApiError(403, "Requisition not approved.");
    }
    const isOfferDecision = body.action === "offerApprove" || body.action === "offerReject";
    const isFeedbackAction = body.action === "feedback";
    if (!canRecruit(user.role) && user.role !== "HiringManager" && !isOfferDecision && !isFeedbackAction) {
      throw new ApiError(403, "Not allowed.");
    }
    const hmOwner = isHmOwner(user.role, r.raisedByEmail, user.email);
    const canHmDecide = user.role === "Admin" || hmOwner;

    if (body.action === "reopen") {
      if (!canRecruit(user.role)) throw new ApiError(403, "Only recruiters and admins can reopen applications.");
      if (c.archived || !canReopenApplication(c.stage)) throw new ApiError(400, "Only rejected or backed-out applications can be reopened.");
      return json({ candidate: await reopenCandidateApplication(c, user.email) });
    }

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
      if (c.offerApprovalStatus === "Pending") {
        throw new ApiError(400, "Resolve the pending offer before updating the candidate's withdrawal status.");
      }
      if (c.offerApprovalStatus === "Approved" && c.stage !== "OfferApproved" && c.stage !== "Offered") {
        throw new ApiError(400, "An approved offer can only be marked declined before the candidate is onboarded.");
      }

      const reason = String(body.reason || "").trim();
      const backoutPatch = {
          stage: "Candidate Backed Out",
          backedOutAt: new Date().toISOString(),
          backedOutBy: user.email,
          backOutReason: reason || undefined,
        } as const;
      const updated = c.offerApprovalStatus === "Approved" ? (await transitionOffer(id, c.reqId, "backout", backoutPatch, user.email)).candidate : await updateCandidate(id, backoutPatch, { byEmail: user.email, from: c.stage, to: "Candidate Backed Out" });
      const interviews = await listInterviews({ candidateId: id, reqId: c.reqId });
      const activeInterviews = interviews.filter((interview) =>
        ["Scheduled", "Rescheduled", "Reschedule Requested"].includes(interview.status)
      );
      const interviewAudit = systemStatusAudit("Candidate backed out; cancelled remaining interviews.");
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
        await updateInterview(interview.id, { status: "Cancelled" }, interviewAudit, interview.status);
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
      if (canReopenApplication(c.stage)) throw new ApiError(400, "Use Reopen application to start a new application and keep this one in history.");
      if (c.source === "Employee Referral" && c.stage === "New") {
        if (!canRecruit(user.role)) {
          throw new ApiError(403, "Only a Recruiter or Admin can review an employee referral.");
        }
        if (to !== "PendingHMApproval" && to !== "Rejected") {
          throw new ApiError(400, "Choose Select for HM approval or Reject referral.");
        }
        const updated = await updateCandidate(
          id,
          { stage: to },
          { byEmail: user.email, from: c.stage, to }
        );
        await addAudit({
          action: to === "Rejected" ? "candidate.employee_referral.reject" : "candidate.employee_referral.advance",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "candidate",
          entityId: id,
          detail: to,
        });
        return json({ candidate: updated });
      }
      if (c.stage === "Social CV") {
        if (!canRecruit(user.role)) throw new ApiError(403, "Only a Recruiter or Admin can review a social application.");
        if (to !== "Social CV Reject" && to !== "PendingHMApproval") {
          throw new ApiError(400, "Choose Social CV Reject or move the candidate to HM approval.");
        }
        const updated = await updateCandidate(
          id,
          { stage: to },
          { byEmail: user.email, from: c.stage, to }
        );
        await addAudit({
          action: to === "Social CV Reject" ? "candidate.social_cv.reject" : "candidate.social_cv.advance",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "candidate",
          entityId: id,
          detail: to,
        });
        return json({ candidate: updated });
      }
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

      const interviews = await listInterviews({ candidateId: id, reqId: c.reqId });
      const maxRound = interviews
        .filter((iv) => iv.status !== "Cancelled")
        .reduce((m, iv) => Math.max(m, iv.roundIndex || 1), 0);
      const lastAdvanced = c.lastAdvancedRound ?? 0;
      const plan = await getPlan(c.reqId);
      const finalRound = Math.max(getInterviewRounds(plan).at(-1)?.order ?? 0, maxRound);
      const roundsComplete = finalRound > 0 && lastAdvanced >= finalRound;

      const workflowLocked = new Set<CandidateStage>([
        "PendingHMApproval",
        "HMApproved",
        "Screened",
        "Shortlist",
        "Interview",
        "Interview Scheduled",
        "Debrief",
        "OfferApprovalPending",
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
        "On Hold",
        "OfferApproved",
      ];
      if (!allowedOutcomes.includes(to)) {
        throw new ApiError(
          400,
          "Choose a valid post-interview stage. Use the debrief decision to reject a candidate."
        );
      }

      const postApprovalStages: CandidateStage[] = ["OfferApproved", "Offered", "Onboarded"];
      if (postApprovalStages.includes(to) && c.offerApprovalStatus !== "Approved") {
        throw new ApiError(400, "The Department Head must approve the offer before moving the candidate to Offer Approved, Offered, or Onboarded.");
      }
      if (c.stage === "Offered" && to === "OfferApproved") {
        throw new ApiError(400, "An issued offer cannot be moved back to Offer Approved.");
      }
      if ((c.stage === "OfferApproved" || c.stage === "Offered") && !postApprovalStages.includes(to)) {
        throw new ApiError(400, "After offer approval, update the offer to Offered, Onboarded, or record that the candidate declined it.");
      }

      const updated = await updateCandidate(
        id,
        { stage: to },
        { byEmail: user.email, from: c.stage, to }
      );
      if (to === "Onboarded" && (await getOrg()).vendorsSpendEnabled) {
        const placement = await createPlacementFeeForJoinedCandidate(updated || c, r, user.email);
        if (placement) {
          await addAudit({
            action: "vendor.placement_fee.estimated",
            actorEmail: user.email,
            actingAdminEmail: user.actingAdminEmail,
            entityType: "placement_fee",
            entityId: String(placement.id),
            detail: String(placement.expectedFee),
          });
        }
      }
      const joiningReferrer = to === "Onboarded" && c.source === "Employee Referral" ? referralEmail(c, await listUsers(true)) : undefined;
      if (joiningReferrer) {
        const amount = Number(c.employeeReferralBonus ?? r.referralBonus ?? 0);
        if (amount > 0) {
          const joined = new Date();
          const joiningDate = `${joined.getFullYear()}-${String(joined.getMonth() + 1).padStart(2, "0")}-${String(joined.getDate()).padStart(2, "0")}`;
          const org = await getOrg();
          const overdueDays = org.referralBonusOverdueDays || 30;
          const dueDate = new Date(joined.getFullYear(), joined.getMonth(), joined.getDate());
          dueDate.setDate(dueDate.getDate() + overdueDays);
          const dueAt = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}T00:00:00.000Z`;
          const result = await createJoiningReferralPayout({
            reqId: c.reqId,
            candidateId: c.id,
            candidateName: c.name,
            referrerEmail: joiningReferrer,
            amount,
            joiningDate,
            dueAt,
          });
          if (result.created) {
            await addAudit({
              action: "employee_referral.joining_bonus.earned",
              actorEmail: user.email,
              actingAdminEmail: user.actingAdminEmail,
              entityType: "referral_payout",
              entityId: result.payout.id,
              detail: `joining=${joiningDate}; due=${dueAt}; amount=${amount}; referrer=${c.sourceDetail}`,
            });
          }
        }
      }
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

    if (body.action === "feedback" || body.action === "updateFeedback") {
      const updating = body.action === "updateFeedback";
      if (updating && !canRecruit(user.role)) throw new ApiError(403, "Not allowed.");
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
      if (!interviewId || !interview || interview.candidateId !== id || interview.reqId !== c.reqId) {
        throw new ApiError(400, "Select the scheduled interview for this feedback.");
      }
      const questions = (interview.feedbackForm?.questions || []).map(normalizeQuestion);
      const answers = Array.isArray(body.customAnswers) ? body.customAnswers : [];
      if (answers.length !== questions.length || answers.some((item: { question?: unknown; answer?: unknown }, index: number) => item.question !== questions[index].label || typeof item.answer !== "string" || !validFeedbackAnswer(questions[index], item.answer))) throw new ApiError(400, "The feedback form has changed. Refresh the page and try again.");
      const changes = {
        customAnswers: questions.map((question, index) => ({ question: question.label, answer: answers[index].answer.trim() })),
        rating: Number(body.rating) || 0,
        recommendation: String(body.recommendation || ""),
        feedback: String(body.feedback || ""),
      };
      if (updating) {
        const entry = (await listFeedback(id)).find((item) =>
          item.id === body.feedbackId && item.interviewId === interviewId && item.reqId === c.reqId
        );
        if (!entry) throw new ApiError(404, "Interview feedback not found.");
        if ((entry.updatedAt ?? null) !== body.feedbackUpdatedAt) {
          throw new ApiError(409, "This feedback has changed. Reopen it and try again.");
        }
        const feedback = await updateFeedback(entry, changes, user.email);
        return json({ feedback });
      }
      const fb = await createFeedback({
        ...changes,
        candidateId: id,
        reqId: c.reqId,
        interviewId,
        interviewer: String(body.interviewer || user.name),
        stage: String(body.stage || c.stage),
        createdBy: user.email,
      });
      if (interviewId) {
        await updateInterview(interviewId, { status: "Completed" }, systemStatusAudit("Interview feedback was submitted."), interview.status);
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
      if (body.expectedStage === "On Hold" && c.stage !== "On Hold") throw new ApiError(409, "This candidate's status has changed. Refresh and try again.");
      if (c.stage === "PendingHMApproval") {
        throw new ApiError(403, "Candidate still pending HM approval.");
      }
      const decision = String(body.decision || "");
      let stage: CandidateStage = c.stage;
      const interviews = await listInterviews({ candidateId: id, reqId: c.reqId });
      if (c.stage === "On Hold" && decision === "Advance") {
        const active = interviews.filter((interview) => interview.status !== "Cancelled");
        const feedbackIds = new Set((await listFeedback(id)).map((entry) => entry.interviewId));
        if (!active.length || active.some((interview) => interview.status === "Reschedule Requested" || !feedbackIds.has(interview.id))) throw new ApiError(400, "Complete the interview and feedback before selecting this candidate.");
      }
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
        const interviewAudit = systemStatusAudit("Candidate advanced after debrief; closed completed rounds.");
        // Mark past rounds complete so UI doesn't keep showing "Scheduled".
        await Promise.all(
          interviews
            .filter(
              (iv) =>
                iv.status !== "Cancelled" &&
                (iv.roundIndex || 1) <= maxRound &&
                iv.status !== "Completed"
            )
            .map((iv) => updateInterview(iv.id, { status: "Completed" }, interviewAudit, iv.status))
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
      const interviewReferrer = decision === "Advance" && c.source === "Employee Referral" ? referralEmail(c, await listUsers(true)) : undefined;
      if (interviewReferrer) {
        const requisition = await getRequisition(c.reqId);
        const feedback = await listFeedback(id);
        const feedbackInterviewIds = new Set(feedback.map((item) => item.interviewId).filter(Boolean));
        const completedRounds = interviews
          .filter((interview) => interview.status === "Completed" && feedbackInterviewIds.has(interview.id))
          .sort((a, b) => (b.roundIndex || 1) - (a.roundIndex || 1));
        const completedRound = completedRounds[0];
        const amount = Number(requisition?.referralInterviewBonus || 0);
        if (completedRound && amount > 0) {
          const roundIndex = completedRound.roundIndex || 1;
          const result = await createReferralPayout({
            reqId: c.reqId,
            candidateId: id,
            candidateName: c.name,
            referrerEmail: interviewReferrer,
            roundIndex,
            roundName: completedRound.roundName || completedRound.stage || `Round ${roundIndex}`,
            amount,
            decision: "Advance",
          });
          if (result.created) {
            await addAudit({
              action: "employee_referral.interview_bonus.earned",
              actorEmail: user.email,
              actingAdminEmail: user.actingAdminEmail,
              entityType: "referral_payout",
              entityId: result.payout.id,
              detail: `${result.payout.roundName}; ${amount}; decision=${decision}`,
            });
          }
        }
      }
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
      const applicableRounds = getInterviewRounds(plan);
      const finalRound = applicableRounds.at(-1)?.order ?? 0;
      const lastAdvancedRound = c.lastAdvancedRound || 0;
      if (lastAdvancedRound < finalRound) {
        throw new ApiError(
          400,
          "Complete all applicable interview rounds before moving this candidate to offer approval."
        );
      }
      const interviews = (await listInterviews({ candidateId: id, reqId: c.reqId })).filter(
        (interview) => interview.status !== "Cancelled"
      );
      const bookedRounds = new Set(interviews.map((interview) => interview.roundIndex || 1));
      if (applicableRounds.some((round) => !bookedRounds.has(round.order))) {
        throw new ApiError(400, "Schedule every applicable interview round before requesting offer approval.");
      }
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
      const { candidate: updated, requisition: updatedRequisition } = await transitionOffer(id, r.id, "request", {
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
      }, user.email);
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
      if (user.role === "DepartmentHead" && !canViewScopedRequisition(user, r)) throw new ApiError(403, "This offer is outside your department scope.");
      if (c.offerApprovalStatus !== "Pending") {
        throw new ApiError(400, "Candidate has no pending offer approval request.");
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
      const { candidate: updated, requisition: updatedRequisition } = await transitionOffer(id, r.id, body.action === "offerApprove" ? "approve" : "reject", {
        ...approvedOfferTerms,
        stage: nextStage,
        offerApprovalStatus,
        offerDecisionBy: user.email,
        offerDecisionAt: new Date().toISOString(),
        offerRejectReason,
      }, user.email);
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
    if (body.location !== undefined) {
      const location = indianCityLabel(body.location);
      if (!location) throw new ApiError(400, "Choose an Indian city from the location suggestions.");
      patch.location = location;
    }
    const updated = await updateCandidate(id, patch);
    return json({ candidate: updated });
  } catch (e) {
    return errResponse(e);
  }
}
