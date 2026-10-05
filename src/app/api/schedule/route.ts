import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  createInterview,
  getCandidate,
  getInterview,
  getPlan,
  getRequisition,
  listInterviews,
  listRequisitions,
  listAllFeedback,
  listUsers,
  updateCandidate,
  updateInterview,
} from "@/lib/db";
import { canRecruit } from "@/lib/roles";
import { getInterviewRounds } from "@/lib/interviewPlan";
import {
  cancelInterviewCalendarEvent,
  createInterviewCalendarEvent,
  updateInterviewCalendarEvent,
} from "@/lib/googleCalendar";
import { isCalendarEnabled } from "@/lib/calendarConfig";

const BLOCKED_SCHEDULE_STAGES = new Set([
  "PendingHMApproval",
  "Rejected",
  "Candidate Backed Out",
]);

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sp = new URL(req.url).searchParams;
    let interviews = await listInterviews({
        candidateId: sp.get("candidateId") || undefined,
        reqId: sp.get("reqId") || undefined,
    });
    if (user.role === "Admin") {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      const visibleReqIds = new Set((await listRequisitions())
        .filter((requisition) => !requisition.recruiterEmail || teamEmails.has(requisition.recruiterEmail))
        .map((requisition) => requisition.id));
      interviews = interviews.filter((interview) => visibleReqIds.has(interview.reqId));
    } else {
      const visibleReqs = await listRequisitions(
        user.role === "HiringManager"
          ? { raisedByEmail: user.email }
          : user.role === "DepartmentHead"
            ? { departments: user.departments || [] }
            : undefined
      );
      const visibleIds = new Set(visibleReqs
        .filter((requisition) => user.role !== "Recruiter" || requisition.recruiterEmail === user.email)
        .map((requisition) => requisition.id));
      interviews = interviews.filter((interview) => visibleIds.has(interview.reqId));
    }
    const feedback = await listAllFeedback();
    const feedbackByInterview = new Set(
      feedback.map((item) => item.interviewId).filter(Boolean)
    );
    const now = Date.now();
    return json({
      interviews: interviews.map((interview) => ({
        ...interview,
        feedbackPending:
          interview.status !== "Cancelled" &&
          interview.status !== "Reschedule Requested" &&
          new Date(interview.datetime).getTime() <= now &&
          !feedbackByInterview.has(interview.id),
        feedbackAgeDays: Math.max(
          0,
          Math.floor((now - new Date(interview.datetime).getTime()) / 86400000)
        ),
      })),
      calendarEnabled: isCalendarEnabled(),
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canRecruit(user.role)) {
      throw new ApiError(403, "Only Admins and Recruiters can schedule.");
    }
    const body = await req.json();
    const reqId = String(body.reqId || "");
    const candidateId = String(body.candidateId || "");
    const datetime = String(body.datetime || "");
    const durationMinutes = Number(body.durationMinutes) || 60;
    if (!reqId || !candidateId || !datetime) {
      throw new ApiError(400, "reqId, candidateId, and date/time are required.");
    }
    if (Number.isNaN(new Date(datetime).getTime())) {
      throw new ApiError(400, "Enter a valid interview date and time.");
    }
    const r = await getRequisition(reqId);
    if (
      !r ||
      (r.status !== "Approved" &&
        r.status !== "Position Reopened" &&
        r.status !== "Partially Fulfilled")
    ) {
      throw new ApiError(403, "Requisition must be approved.");
    }
    if (user.role === "Recruiter" && r.recruiterEmail !== user.email) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (user.role === "Admin" && r.recruiterEmail) {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      if (!teamEmails.has(r.recruiterEmail)) throw new ApiError(403, "This requisition is outside your managed team.");
    }
    const c = await getCandidate(candidateId);
    if (!c || c.reqId !== reqId) throw new ApiError(400, "Invalid candidate.");

    if (c.stage === "Candidate Backed Out") {
      throw new ApiError(403, "Candidate has backed out and cannot be scheduled.");
    }
    if (BLOCKED_SCHEDULE_STAGES.has(c.stage)) {
      throw new ApiError(
        403,
        c.stage === "PendingHMApproval"
          ? "Hiring manager must approve this candidate before scheduling."
          : "Cannot schedule a rejected candidate."
      );
    }

    const plan = await getPlan(reqId);
    const rounds = getInterviewRounds(plan);

    const roundIndex = Math.max(
      1,
      Number(body.roundIndex) || 1
    );
    const round =
      rounds.find((x) => x.order === roundIndex) || rounds[roundIndex - 1];
    if (!round) {
      throw new ApiError(400, `Round ${roundIndex} is not configured.`);
    }
    const roundName = round.name;

    const existing = await listInterviews({ candidateId });
    const activeForRound = existing.filter(
      (iv) =>
        iv.status !== "Cancelled" &&
        (iv.roundIndex || 1) === roundIndex
    );
    if (activeForRound.length > 0) {
      throw new ApiError(
        400,
        `Round ${roundIndex} is already scheduled for this candidate.`
      );
    }
    const maxBooked = existing
      .filter((iv) => iv.status !== "Cancelled")
      .reduce((m, iv) => Math.max(m, iv.roundIndex || 1), 0);
    if (roundIndex > maxBooked + 1) {
      throw new ApiError(
        400,
        `Schedule Round ${maxBooked + 1} before Round ${roundIndex}.`
      );
    }

    const interviewers = String(body.interviewers || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (interviewers.length === 0) {
      throw new ApiError(
        400,
        "Add at least one interviewer email."
      );
    }

    const stage = String(body.stage || roundName || "Interview");
    const attendees = [
      ...interviewers,
      ...(c.email ? [c.email.toLowerCase()] : []),
    ];
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/$/, "");
    const feedbackUrl = appUrl
      ? `${appUrl}/?candidateId=${encodeURIComponent(candidateId)}`
      : "Open the ATS candidate record to complete the feedback form.";

    let meetLink: string | undefined;
    let calendarEventId: string | undefined;

    if (isCalendarEnabled()) {
      try {
        const event = await createInterviewCalendarEvent({
          summary: `${roundName}: ${c.name} — ${r.title}`,
          description: [
            `ATS interview`,
            `Round: ${roundIndex}. ${roundName}`,
            `Candidate: ${c.name}${c.email ? ` (${c.email})` : ""}`,
            `Requisition: ${r.id} — ${r.title}`,
            `Department: ${r.department}`,
            `Scheduled by: ${user.email}`,
            `Feedback form: ${feedbackUrl}`,
          ].join("\n"),
          startIso: datetime,
          durationMinutes,
          attendeeEmails: attendees,
        });
        calendarEventId = event.eventId;
        meetLink = event.meetLink;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Calendar create failed";
        throw new ApiError(
          502,
          `Could not create Google Calendar invite: ${msg}. Check Calendar API + domain-wide delegation.`
        );
      }
    }

    const iv = await createInterview({
      reqId,
      candidateId,
      stage,
      roundIndex,
      roundName,
      interviewerEmails: interviewers,
      datetime,
      meetLink,
      calendarEventId,
      status: "Scheduled",
      createdBy: user.email,
    });

    // Always move into the interview cycle when a round is booked
    // (including after debrief Advance → Selected).
    if (
      c.stage === "HMApproved" ||
      c.stage === "Interview" ||
      c.stage === "Selected" ||
      c.stage === "Debrief" ||
      c.stage === "On Hold" ||
      c.stage === "Screened" ||
      c.stage === "Shortlist"
    ) {
      await updateCandidate(
        candidateId,
        { stage: "Interview Scheduled" },
        {
          byEmail: user.email,
          from: c.stage,
          to: "Interview Scheduled",
        }
      );
    }

    await addAudit({
      action: "interview.schedule",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "interview",
      entityId: iv.id,
      detail: calendarEventId
        ? `${datetime}; round=${roundIndex}; cal=${calendarEventId}`
        : `${datetime}; round=${roundIndex}`,
    });
    return json(
      {
        interview: iv,
        calendarEnabled: isCalendarEnabled(),
        inviteSent: !!calendarEventId,
      },
      201
    );
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canRecruit(user.role)) throw new ApiError(403, "Not allowed.");
    const body = await req.json();
    const id = String(body.id || "");
    if (!id) throw new ApiError(400, "id required.");

    const existing = await getInterview(id);
    if (!existing) throw new ApiError(404, "Interview not found.");
    const requisition = await getRequisition(existing.reqId);
    if (!requisition) {
      throw new ApiError(404, "Requisition not found.");
    }
    if (user.role === "Recruiter" && requisition.recruiterEmail !== user.email) {
      throw new ApiError(403, "This interview is not assigned to you.");
    }
    if (user.role === "Admin" && requisition.recruiterEmail) {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      if (!teamEmails.has(requisition.recruiterEmail)) throw new ApiError(403, "This interview is outside your managed team.");
    }

    const status = body.status as typeof existing.status | undefined;
    const datetime = body.datetime ? String(body.datetime) : undefined;
    const rescheduleRequestedBy = body.rescheduleRequestedBy as "Candidate" | "Interviewer" | undefined;
    const interviewerEmails = Array.isArray(body.interviewerEmails)
      ? (body.interviewerEmails as string[])
      : undefined;

    if (
      status !== undefined &&
      !["Scheduled", "Completed", "Cancelled", "Rescheduled", "Reschedule Requested"].includes(status)
    ) {
      throw new ApiError(400, "Invalid interview status.");
    }
    if (
      status === "Reschedule Requested" &&
      existing.status !== "Scheduled" &&
      existing.status !== "Rescheduled" &&
      existing.status !== "Reschedule Requested"
    ) {
      throw new ApiError(400, "Only a scheduled interview can be marked for rescheduling.");
    }
    if (status === "Reschedule Requested" && rescheduleRequestedBy !== "Candidate" && rescheduleRequestedBy !== "Interviewer") {
      throw new ApiError(400, "Choose whether the candidate or interviewer requested the reschedule.");
    }
    if (status === "Rescheduled" && existing.status !== "Reschedule Requested") {
      throw new ApiError(400, "Mark the interview as reschedule requested before setting a new time.");
    }
    if (status === "Rescheduled" && !datetime) {
      throw new ApiError(400, "A new interview date and time are required.");
    }
    if (datetime && Number.isNaN(new Date(datetime).getTime())) {
      throw new ApiError(400, "Enter a valid interview date and time.");
    }

    if (isCalendarEnabled() && existing.calendarEventId) {
      try {
        if (status === "Cancelled") {
          await cancelInterviewCalendarEvent(existing.calendarEventId);
        } else if (datetime || interviewerEmails) {
          await updateInterviewCalendarEvent(existing.calendarEventId, {
            startIso: datetime,
            attendeeEmails: interviewerEmails,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Calendar update failed";
        throw new ApiError(502, `Calendar update failed: ${msg}`);
      }
    }

    await updateInterview(id, {
      status,
      rescheduleRequestedBy: status === "Reschedule Requested" ? rescheduleRequestedBy : existing.rescheduleRequestedBy,
      datetime,
      interviewerEmails,
    });
    await addAudit({
      action: "interview.update",
      actorEmail: user.email,
      actingAdminEmail: user.actingAdminEmail,
      entityType: "interview",
      entityId: id,
      detail:
        status === "Reschedule Requested"
          ? `${rescheduleRequestedBy} requested reschedule`
          : status || datetime || "update",
    });
    return json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
