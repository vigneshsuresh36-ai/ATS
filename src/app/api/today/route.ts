import { canViewScopedRequisition } from "@/lib/requisitionScope";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { errResponse, json, requireUser } from "@/lib/auth";
import { dropoffRisk } from "@/lib/dropoffRisk";
import { buildPriorityList } from "@/lib/priorityList";
import {
  getOrg,
  listCandidates,
  listInterviews,
  listRequisitions,
  listUsers,
  listAllFeedback,
  listStageEvents,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const org = await getOrg();
    const sla = org.slaDaysDefault || 10;

    let reqs = await listRequisitions();
    if (user.role === "Admin") {
      const team = (await listUsers()).filter((member) => member.role === "Recruiter" && member.managerEmail === user.email);
      const teamEmails = new Set(team.map((member) => member.email));
      reqs = reqs.filter((requisition) => !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail));
    } else if (user.role === "Recruiter") {
      reqs = reqs.filter((r) => isAssignedRecruiter(r, user.email));
    }

    reqs = reqs.filter((request) => canViewScopedRequisition(user, request));
    const reqIds = new Set(reqs.map((r) => r.id));
    let cands = await listCandidates();
    cands = cands.filter(
      (c) => reqIds.has(c.reqId) || user.role === "Admin"
    );
    if (user.role === "HiringManager" || user.role === "DepartmentHead") {
      cands = cands.filter((c) => reqIds.has(c.reqId));
    }

    const now = Date.now();
    const events = await listStageEvents();
    const lastChange = new Map<string, number>();
    for (const e of events) {
      const t = new Date(e.at).getTime();
      if (!lastChange.has(e.candidateId) || t > lastChange.get(e.candidateId)!) {
        lastChange.set(e.candidateId, t);
      }
    }

    const interviews = (await listInterviews()).filter((interview) => reqIds.has(interview.reqId));
    const allFb = await listAllFeedback();
    const fbByInterview = new Set(allFb.map((f) => f.interviewId).filter(Boolean));
    const reqById = new Map(reqs.map((r) => [r.id, r]));
    const candById = new Map(cands.map((c) => [c.id, c]));
    const interviewsToday = interviews
      .filter((interview) => {
        const date = new Date(interview.datetime);
        const today = new Date();
        return interview.status !== "Cancelled" &&
          interview.status !== "Reschedule Requested" &&
          date.getFullYear() === today.getFullYear() &&
          date.getMonth() === today.getMonth() &&
          date.getDate() === today.getDate();
      })
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .map((interview) => ({
        ...interview,
        candidate: candById.get(interview.candidateId),
        requisition: reqById.get(interview.reqId),
        feedbackPending: !fbByInterview.has(interview.id),
      }));
    const upcomingInterviews = interviews
      .filter((interview) => interview.status !== "Cancelled" && interview.status !== "Reschedule Requested" && new Date(interview.datetime).getTime() > now)
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .slice(0, 12)
      .map((interview) => ({
        ...interview,
        candidate: candById.get(interview.candidateId),
        requisition: reqById.get(interview.reqId),
      }));

    const newApps = cands
      .filter((c) => {
        const age = now - new Date(c.createdAt).getTime();
        return c.stage === "New" && age < 7 * 86400000;
      })
      .slice(0, 15);

    const awaitingFb = interviews
      .filter(
        (interview) =>
          interview.status !== "Cancelled" &&
          interview.status !== "Reschedule Requested" &&
          new Date(interview.datetime).getTime() <= now &&
          !fbByInterview.has(interview.id)
      )
      .map((interview) => {
        const candidate = cands.find((item) => item.id === interview.candidateId);
        return candidate
          ? {
              ...candidate,
              interviewId: interview.id,
              interviewerEmails: interview.interviewerEmails,
              interviewDate: interview.datetime,
              feedbackAgeDays: Math.max(0, Math.floor((now - new Date(interview.datetime).getTime()) / 86400000)),
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b?.feedbackAgeDays || 0) - (a?.feedbackAgeDays || 0))
      .slice(0, 15);

    const debriefs = cands
      .filter((c) => /debrief/i.test(c.stage) && !/reject/i.test(c.stage))
      .slice(0, 15);

    const offers = cands
      .filter((c) => /offer/i.test(c.stage) && !/declin|onboard/i.test(c.stage))
      .slice(0, 15);

    const stuck = cands
      .filter((c) => {
        if (/reject|backed out|hire|onboard|talent pool|declin/i.test(c.stage)) return false;
        const since = lastChange.get(c.id) || new Date(c.createdAt).getTime();
        const days = Math.floor((now - since) / 86400000);
        return days >= sla;
      })
      .map((c) => {
        const since = lastChange.get(c.id) || new Date(c.createdAt).getTime();
        return {
          ...c,
          days: Math.floor((now - since) / 86400000),
          sla,
        };
      })
      .sort((a, b) => b.days - a.days);

    const pendingApprovals = reqs.filter((r) => r.status === "PendingApproval");
    const reqsNeed = reqs
      .filter(
        (r) =>
          r.status === "Approved" ||
          r.status === "Position Reopened" ||
          r.status === "Partially Fulfilled"
      )
      .filter((r) => !cands.some((c) => c.reqId === r.id));

    const nextRoundPending = cands
      .filter((c) => c.stage === "Selected")
      .slice(0, 15);
    const interviewsToSchedule = cands
      .filter((c) => c.stage === "HMApproved" || c.stage === "Selected")
      .slice(0, 15);
    const offersPending = cands
      .filter((c) => c.offerApprovalStatus === "Pending" || c.stage === "OfferApprovalPending");

    const atRisk = cands
      .map((c) => {
        const since = lastChange.get(c.id) || new Date(c.createdAt).getTime();
        const risk = dropoffRisk(c, Math.floor((now - since) / 86400000));
        return risk ? { id: c.id, name: c.name, ...risk } : null;
      })
      .filter((item): item is NonNullable<typeof item> => !!item);
    const priority = buildPriorityList({
      interviewsToday,
      awaitingFb: awaitingFb.filter((item): item is NonNullable<typeof item> => !!item),
      offersPending,
      stuck,
      toSchedule: interviewsToSchedule.filter((c) => c.stage === "HMApproved"),
      atRisk,
    });

    return json({
      priority,
      newApps,
      awaitingFb,
      debriefs,
      offers,
      stuck,
      pendingApprovals,
      reqsNeed,
      interviewsToday,
      upcomingInterviews,
      nextRoundPending,
      interviewsToSchedule,
      offersPending,
      sla,
    });
  } catch (e) {
    return errResponse(e);
  }
}
