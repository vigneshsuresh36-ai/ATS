import { canViewScopedRequisition } from "@/lib/requisitionScope";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { errResponse, json, requireUser } from "@/lib/auth";
import { candidateSourceLabel } from "@/lib/candidateSource";
import { listAllFeedback, listCandidates, listInterviews, listReferralPayouts, listRequisitions, listStageEvents, listUsers } from "@/lib/db";
import { referralEmail } from "@/lib/referrerIdentity";
import { joiningTimeline } from "@/lib/joiningTimeline";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const users = await listUsers();
    const userByEmail = new Map(users.map((item) => [item.email, item]));
    let reqs = await listRequisitions();
    if (user.role === "Admin") {
      const teamEmails = new Set(users.filter((member) => member.role === "Recruiter" && member.managerEmail === user.email).map((member) => member.email));
      reqs = reqs.filter((requisition) => !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail));
    } else if (user.role === "HiringManager") {
      reqs = reqs.filter((r) => r.raisedByEmail === user.email);
    } else if (user.role === "DepartmentHead") {
      const set = new Set((user.departments || []).map((d) => d.toLowerCase()));
      reqs = reqs.filter((r) => set.has(r.department.toLowerCase()));
    } else if (user.role === "Recruiter") {
      reqs = reqs.filter((r) => isAssignedRecruiter(r, user.email));
    }
    reqs = reqs.filter((request) => canViewScopedRequisition(user, request));
    const cands = await listCandidates(undefined, true);
    const [interviews, feedback] = await Promise.all([
      listInterviews(),
      listAllFeedback(),
    ]);
    reqs = reqs.filter((request) => canViewScopedRequisition(user, request));
    const reqIds = new Set(reqs.map((r) => r.id));
    const visibleInterviews = interviews.filter((interview) => reqIds.has(interview.reqId));
    const scoped = cands.filter(
      (c) => reqIds.has(c.reqId)
    );

    const byStage: Record<string, number> = {};
    const stageCandidateIds: Record<string, string[]> = {};
    for (const c of scoped) {
      byStage[c.stage] = (byStage[c.stage] || 0) + 1;
      stageCandidateIds[c.stage] = [...(stageCandidateIds[c.stage] || []), c.id];
    }

    const approvalFunnel = {
      pending: reqs.filter((r) => r.status === "PendingApproval").length,
      approved: reqs.filter((r) => r.status === "Approved").length,
      rejected: reqs.filter((r) => r.status === "Rejected").length,
      closed: reqs.filter(
        (r) => r.status === "Closed" || r.status === "Position Fulfilled"
      ).length,
    };

    const now = Date.now();
    const activeStatuses = new Set(["Approved", "Position Reopened", "Partially Fulfilled"]);
    const activeReqs = reqs.filter((requisition) => activeStatuses.has(requisition.status));
    const joiningTimelineAttention = activeReqs.flatMap((request) => {
      const timeline = joiningTimeline(request, now);
      return timeline && timeline.status !== "on-track" ? [{ id: request.id, title: request.title, ...timeline }] : [];
    });
    const openPositions = activeReqs.reduce((total, requisition) => total + Math.max(0, requisition.openings || 0), 0);
    const openPositionsList = activeReqs.map((requisition) => {
      const linkedCandidates = scoped.filter((candidate) => candidate.reqId === requisition.id);
      const consultants = [...new Set(linkedCandidates
        .filter((candidate) => candidate.source === "Consultant" && candidate.sourceDetail)
        .map((candidate) => candidate.sourceDetail!))];
      return {
        id: requisition.id,
        title: requisition.title,
        department: requisition.department,
        location: requisition.location,
        openings: requisition.openings,
        candidateCount: linkedCandidates.length,
        status: requisition.status,
        ageDays: Math.max(0, Math.floor((now - new Date(requisition.createdAt).getTime()) / 86400000)),
        recruiter: requisition.recruiterEmail
          ? userByEmail.get(requisition.recruiterEmail)?.name || requisition.recruiterEmail
          : "Unassigned",
        consultants,
      };
    }).sort((a, b) => b.ageDays - a.ageDays);
    const hiringManagerRequisitions = user.role === "HiringManager"
      ? reqs.map((requisition) => {
          const linkedCandidates = scoped.filter((candidate) => candidate.reqId === requisition.id);
          const stageCounts = linkedCandidates.reduce<Record<string, number>>((counts, candidate) => {
            counts[candidate.stage] = (counts[candidate.stage] || 0) + 1;
            return counts;
          }, {});
          const candidatesByRound = new Map<number, Set<string>>();
          for (const interview of visibleInterviews) {
            if (interview.reqId !== requisition.id || interview.status === "Cancelled") continue;
            const round = interview.roundIndex || 1;
            const ids = candidatesByRound.get(round) || new Set<string>();
            ids.add(interview.candidateId);
            candidatesByRound.set(round, ids);
          }
          return {
            id: requisition.id,
            title: requisition.title,
            department: requisition.department,
            location: requisition.location,
            openings: requisition.openings,
            status: requisition.status,
            approvedAt: requisition.approvedAt,
            createdAt: requisition.createdAt,
            ageDays: Math.max(0, Math.floor((now - new Date(requisition.createdAt).getTime()) / 86400000)),
            candidateCount: linkedCandidates.length,
            stageCounts,
            roundCounts: [...candidatesByRound.entries()]
              .sort(([left], [right]) => left - right)
              .map(([round, ids]) => ({ round, candidates: ids.size })),
          };
        })
      : [];
    const departmentHeadPositions = user.role === "DepartmentHead"
      ? activeReqs
          .filter((requisition) => requisition.approvedBy?.toLowerCase() === user.email)
          .map((requisition) => ({
            id: requisition.id,
            title: requisition.title,
            department: requisition.department,
            location: requisition.location,
            openings: requisition.openings,
            candidateCount: scoped.filter((candidate) => candidate.reqId === requisition.id).length,
            status: requisition.status,
            approvedAt: requisition.approvedAt,
            ageDays: Math.max(0, Math.floor((now - new Date(requisition.createdAt).getTime()) / 86400000)),
          }))
          .sort((a, b) => b.ageDays - a.ageDays)
      : [];
    const ageing = activeReqs
      .map((r) => ({
        id: r.id,
        title: r.title,
        department: r.department,
        location: r.location,
        openings: r.openings,
        candidateCount: scoped.filter((candidate) => candidate.reqId === r.id).length,
        status: r.status,
        ageDays: Math.max(
          0,
          Math.floor((now - new Date(r.createdAt).getTime()) / 86400000)
        ),
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    const ageingBuckets = {
      "0-7 days": ageing.filter((r) => r.ageDays <= 7).length,
      "8-15 days": ageing.filter((r) => r.ageDays >= 8 && r.ageDays <= 15).length,
      "16-30 days": ageing.filter((r) => r.ageDays >= 16 && r.ageDays <= 30).length,
      "30+ days": ageing.filter((r) => r.ageDays > 30).length,
    };

    const feedbackByInterview = new Set(
      feedback.map((item) => item.interviewId).filter(Boolean)
    );
    const feedbackPending = visibleInterviews
      .filter(
        (interview) =>
          interview.status !== "Cancelled" &&
          interview.status !== "Reschedule Requested" &&
          new Date(interview.datetime).getTime() <= now &&
          !feedbackByInterview.has(interview.id)
      )
      .map((interview) => {
        const candidate = cands.find((item) => item.id === interview.candidateId);
        const requisition = reqs.find((item) => item.id === interview.reqId);
        return {
          interviewId: interview.id,
          candidateId: interview.candidateId,
          reqId: interview.reqId,
          candidateName: candidate?.name || "Unknown candidate",
          requisitionTitle: requisition?.title || interview.reqId,
          interviewerEmails: interview.interviewerEmails,
          interviewDate: interview.datetime,
          roundName: interview.roundName || `Round ${interview.roundIndex || 1}`,
          feedbackAgeHours: Math.max(
            0,
            Math.floor((now - new Date(interview.datetime).getTime()) / 3600000)
          ),
          ageDays: Math.max(
            0,
            Math.floor((now - new Date(interview.datetime).getTime()) / 86400000)
          ),
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays);

    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const interviewsThisMonth = visibleInterviews.filter(
      (interview) => new Date(interview.datetime).getTime() >= monthStart.getTime()
    ).length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const interviewsToday = visibleInterviews.filter((interview) => {
      const time = new Date(interview.datetime).getTime();
      return interview.status !== "Cancelled" && time >= todayStart.getTime() && time < tomorrowStart.getTime();
    });
    const offersInProgress = scoped.filter(
      (candidate) => candidate.offerApprovalStatus === "Pending" || /offer/i.test(candidate.stage)
    ).length;
    const joinedThisMonth = scoped.filter(
      (candidate) => candidate.stage === "Onboarded" && new Date(candidate.updatedAt).getTime() >= monthStart.getTime()
    ).length;
    const sourceMap = new Map<string, { source: string; candidates: number; interviews: number; selected: number; offers: number }>();
    for (const candidate of scoped) {
      const source = candidate.source === "Employee Referral" ? "Employee Referral" : candidate.sourceDetail || candidateSourceLabel(candidate.source) || "Unknown";
      const row = sourceMap.get(source) || { source, candidates: 0, interviews: 0, selected: 0, offers: 0 };
      row.candidates += 1;
      row.interviews += interviews.filter((interview) => interview.candidateId === candidate.id).length;
      if (candidate.stage === "Selected" || candidate.stage === "OfferApprovalPending" || candidate.stage === "OfferApproved" || candidate.stage === "Offered" || candidate.stage === "Onboarded") row.selected += 1;
      if (candidate.offerApprovalStatus === "Pending" || candidate.offerApprovalStatus === "Approved" || /offer/i.test(candidate.stage)) row.offers += 1;
      sourceMap.set(source, row);
    }
    const workloadMap = new Map<string, { recruiter: string; openReqs: number; candidates: number; interviews: number; feedbackPending: number }>();
    for (const requisition of reqs) {
      const recruiterEmail = requisition.recruiterEmail || "Unassigned";
      const recruiter = recruiterEmail === "Unassigned"
        ? recruiterEmail
        : userByEmail.get(recruiterEmail)?.name || recruiterEmail;
      const row = workloadMap.get(recruiterEmail) || { recruiter, openReqs: 0, candidates: 0, interviews: 0, feedbackPending: 0 };
      if (
        requisition.status === "Approved" ||
        requisition.status === "Position Reopened" ||
        requisition.status === "Partially Fulfilled"
      ) {
        row.openReqs += 1;
      }
      const requisitionCandidates = scoped.filter((candidate) => candidate.reqId === requisition.id);
      row.candidates += requisitionCandidates.length;
      row.interviews += visibleInterviews.filter((interview) => interview.reqId === requisition.id).length;
      row.feedbackPending += feedbackPending.filter((item) => item.reqId === requisition.id).length;
      workloadMap.set(recruiterEmail, row);
    }

    const recruiters = users.filter((item) =>
      item.role === "Recruiter" &&
      (user.role === "Admin" ? item.managerEmail === user.email : item.email === user.email)
    );
    const recruiterEmails = new Set(recruiters.map((item) => item.email));
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const stageEvents = await listStageEvents();
    const offerEvents = stageEvents.filter((event) => event.toStage === "Offered" && recruiterEmails.has(event.byEmail));
    const offersByRecruiter = recruiters.map((recruiter) => {
      const events = offerEvents.filter((event) => event.byEmail === recruiter.email);
      return {
        recruiter: recruiter.name,
        email: recruiter.email,
        thisWeek: events.filter((event) => new Date(event.at).getTime() >= weekStart.getTime()).length,
        thisMonth: events.filter((event) => new Date(event.at).getTime() >= monthStart.getTime()).length,
      };
    }).sort((a, b) => b.thisMonth - a.thisMonth);

    const activityStart = new Date(todayStart);
    activityStart.setDate(activityStart.getDate() - 6);
    const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(activityStart);
      start.setDate(start.getDate() + index);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const inDay = (value: string) => {
        const time = new Date(value).getTime();
        return time >= start.getTime() && time < end.getTime();
      };
      return {
        date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
        day: start.toLocaleDateString("en", { weekday: "short" }),
        candidatesAdded: scoped.filter((candidate) => inDay(candidate.createdAt)).length,
        interviewsBooked: visibleInterviews.filter((interview) => inDay(interview.createdAt)).length,
        feedbackSubmitted: feedback.filter((item) =>
          inDay(item.createdAt) && reqIds.has(item.reqId)
        ).length,
        offersIssued: offerEvents.filter((event) => inDay(event.at)).length,
      };
    });

    const candidateReviewsPending = scoped
      .filter((candidate) => candidate.stage === "PendingHMApproval")
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        reqId: candidate.reqId,
        requisitionTitle: reqs.find((requisition) => requisition.id === candidate.reqId)?.title || candidate.reqId,
        ageDays: Math.max(0, Math.floor((now - new Date(candidate.createdAt).getTime()) / 86400000)),
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    const requisitionById = new Map(reqs.map((requisition) => [requisition.id, requisition]));
    const referralPayouts = user.role === "Admin" ? await listReferralPayouts() : [];
    const referralPayoutsByCandidate = new Map<string, typeof referralPayouts>();
    for (const payout of referralPayouts) {
      const candidatePayouts = referralPayoutsByCandidate.get(payout.candidateId) || [];
      candidatePayouts.push(payout);
      referralPayoutsByCandidate.set(payout.candidateId, candidatePayouts);
    }
    const reportData = user.role === "Admin" ? {
      candidates: scoped.map((candidate) => {
        const requisition = requisitionById.get(candidate.reqId);
        return {
          id: candidate.id,
          name: candidate.name,
          email: candidate.email,
          phone: candidate.phone,
          location: candidate.location,
          stage: candidate.stage,
          reqId: candidate.reqId,
          requisitionTitle: requisition?.title || candidate.reqId,
          department: requisition?.department || "",
          recruiter: requisition?.recruiterEmail
            ? userByEmail.get(requisition.recruiterEmail)?.name || requisition.recruiterEmail
            : "Unassigned",
          source: candidateSourceLabel(candidate.source) || candidate.source || "Unknown",
          sourceDetail: candidate.sourceDetail || "",
          experienceYears: candidate.experienceYears ?? "",
          skills: candidate.skills?.join(", ") || "",
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        };
      }),
      requisitions: reqs.map((requisition) => ({
        id: requisition.id,
        title: requisition.title,
        department: requisition.department,
        requisitionType: requisition.requisitionType,
        location: requisition.location,
        employment: requisition.employment,
        level: requisition.level,
        priorityLevel: requisition.priorityLevel || "-",
        priority: requisition.priority,
        openings: requisition.openings,
        status: requisition.status,
        raisedBy: requisition.raisedByName,
        recruiter: requisition.recruiterEmail
          ? userByEmail.get(requisition.recruiterEmail)?.name || requisition.recruiterEmail
          : "Unassigned",
        createdAt: requisition.createdAt,
        updatedAt: requisition.updatedAt,
      })),
      interviews: visibleInterviews.map((interview) => {
        const candidate = scoped.find((item) => item.id === interview.candidateId);
        const requisition = requisitionById.get(interview.reqId);
        return {
          id: interview.id,
          candidateName: candidate?.name || "Unknown candidate",
          candidateEmail: candidate?.email || "",
          requisitionTitle: requisition?.title || interview.reqId,
          department: requisition?.department || "",
          round: interview.roundName || `Round ${interview.roundIndex || 1}`,
          interviewerEmails: interview.interviewerEmails.join(", "),
          datetime: interview.datetime,
          status: interview.status,
          createdAt: interview.createdAt,
        };
      }),
      employeeReferrals: scoped
        .filter((candidate) => candidate.source === "Employee Referral")
        .map((candidate) => {
          const requisition = requisitionById.get(candidate.reqId);
          const candidatePayouts = referralPayoutsByCandidate.get(candidate.id) || [];
          const joiningPayout = candidatePayouts.find((payout) => payout.kind === "Joining");
          const interviewPayouts = candidatePayouts.filter((payout) => payout.kind !== "Joining");
          const referrerEmail = referralEmail(candidate, users) || candidate.sourceDetail || "";
          return {
            candidateId: candidate.id,
            candidateName: candidate.name,
            candidateEmail: candidate.email,
            referrerName: userByEmail.get(referrerEmail.toLowerCase())?.name || referrerEmail,
            referrerEmail,
            requisitionTitle: requisition?.title || candidate.reqId,
            department: requisition?.department || "",
            location: candidate.location || requisition?.location || "",
            stage: candidate.stage,
            referralBonus: joiningPayout?.amount ?? candidate.employeeReferralBonus ?? requisition?.referralBonus ?? 0,
            bonusEarned: candidate.stage === "Onboarded",
            joiningPayoutStatus: joiningPayout?.status || "Not created",
            interviewPayoutCount: interviewPayouts.length,
            interviewPayoutTotal: interviewPayouts.reduce((total, payout) => total + payout.amount, 0),
            createdAt: candidate.createdAt,
            updatedAt: candidate.updatedAt,
          };
        }),
      referralPayouts: referralPayouts
        .filter((payout) => reqIds.has(payout.reqId))
        .map((payout) => ({
          ...payout,
          referrerName: userByEmail.get(payout.referrerEmail.toLowerCase())?.name || payout.referrerEmail,
          requisitionTitle: requisitionById.get(payout.reqId)?.title || payout.reqId,
          kind: payout.kind || "InterviewRound",
        })),
    } : undefined;

    const departmentHeadOffers = user.role === "DepartmentHead"
      ? scoped
          .filter((candidate) =>
            !!candidate.offerApprovalStatus ||
            candidate.stage === "Offered" ||
            candidate.stage === "Onboarded"
          )
          .map((candidate) => {
            const requisition = requisitionById.get(candidate.reqId);
            return {
              candidateId: candidate.id,
              candidateName: candidate.name,
              department: requisition?.department || "",
              reqId: candidate.reqId,
              requisitionTitle: requisition?.title || candidate.reqId,
              status: candidate.offerApprovalStatus || candidate.stage,
              candidateStage: candidate.stage,
              tentativeDoj: candidate.tentativeDoj,
              offeredFixedCtc: candidate.offeredFixedCtc || candidate.offeredSalary,
              offeredVariableCtc: candidate.offeredVariableCtc,
              offeredVariablePeriod: candidate.offeredVariablePeriod,
              offeredEsops: candidate.offeredEsops,
              joiningBonus: candidate.joiningBonus,
              relocationAssistance: candidate.relocationAssistance,
              offerRequestedAt: candidate.offerRequestedAt,
              offerDecisionAt: candidate.offerDecisionAt,
              offerRejectReason: candidate.offerRejectReason,
            };
          })
          .sort((a, b) => (b.offerRequestedAt || "").localeCompare(a.offerRequestedAt || ""))
      : [];

    return json({
      totalCandidates: scoped.length,
      reportData,
      openPositions,
      openPositionsList,
      joiningTimelineAttention,
      departmentHeadPositions,
      departmentHeadOffers,
      hiringManagerRequisitions,
      candidateReviewsPending: { count: candidateReviewsPending.length, items: candidateReviewsPending.slice(0, 12) },
      openReqs: reqs.filter(
        (r) =>
          r.status === "Approved" ||
          r.status === "Position Reopened" ||
          r.status === "Partially Fulfilled"
      ).length,
      stages: byStage,
      stageCandidateIds,
      approvalFunnel,
      requisitions: reqs.length,
      requisitionAgeing: {
        totalOpen: ageing.length,
        buckets: ageingBuckets,
        oldest: ageing.slice(0, 8),
      },
      feedbackPending: {
        total: feedbackPending.length,
        ageing: {
          "<24 Hours": feedbackPending.filter((item) => item.feedbackAgeHours < 24).length,
          "1-2 Days": feedbackPending.filter((item) => item.feedbackAgeHours >= 24 && item.feedbackAgeHours < 48).length,
          "3-5 Days": feedbackPending.filter((item) => item.feedbackAgeHours >= 48 && item.feedbackAgeHours < 120).length,
          "5+ Days": feedbackPending.filter((item) => item.feedbackAgeHours >= 120).length,
        },
        items: feedbackPending.slice(0, 12),
      },
      interviewsThisMonth,
      interviewsToday: interviewsToday.length,
      interviewsTodayItems: interviewsToday.map((interview) => ({
        ...interview,
        candidateName: cands.find((candidate) => candidate.id === interview.candidateId)?.name || "Unknown candidate",
        requisitionTitle: reqs.find((requisition) => requisition.id === interview.reqId)?.title || interview.reqId,
      })),
      weeklyActivity,
      offersInProgress,
      joinedThisMonth,
      averageTimeToHire: null,
      sourcePerformance: [...sourceMap.values()].sort((a, b) => b.candidates - a.candidates),
      recruiterWorkload: [...workloadMap.values()].sort((a, b) => b.openReqs - a.openReqs),
      offersByRecruiter,
    });
  } catch (e) {
    return errResponse(e);
  }
}
