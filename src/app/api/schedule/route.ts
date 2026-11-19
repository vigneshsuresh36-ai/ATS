import { canViewScopedRequisition, scopeDepartments } from "@/lib/requisitionScope";
import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { requestStatusAudit } from "@/lib/requestStatusAudit";
import { readRecordActivity } from "@/lib/statusAudit";
import { requireAdminDb } from "@/lib/firebaseAdmin";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  addAudit,
  createInterview,
  getCandidate,
  getInterview,
  getOrg,
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
import { driveConflict } from "@/lib/recruitmentDrive";
import { getInterviewBusyPeriods } from "@/lib/googleCalendar";
import { isFreeInterval } from "@/lib/calendarAvailability";
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
    const activityId = sp.get("activity");
    const activityInterview = activityId && !activityId.includes("/") ? await getInterview(activityId) : null;
    let interviews = activityId ? (activityInterview ? [activityInterview] : []) : await listInterviews({
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
            ? { departments: scopeDepartments(user) }
            : undefined
      );
      const visibleIds = new Set(visibleReqs
        .filter((requisition) => canViewScopedRequisition(user, requisition) && (user.role !== "Recruiter" || isAssignedRecruiter(requisition, user.email)))
        .map((requisition) => requisition.id));
      interviews = interviews.filter((interview) => visibleIds.has(interview.reqId));
    }
    if (activityId) {
      if (!interviews.some((interview) => interview.id === activityId)) throw new ApiError(404, "Interview not found.");
      return json({ activity: await readRecordActivity(requireAdminDb(), "interview", activityId) });
    }
    const feedback = await listAllFeedback();
    const feedbackByInterview = new Set(
      feedback.map((item) => item.interviewId).filter(Boolean)
    );
    const now = Date.now();
    return json({
      interviews: interviews.map((interview) => ({
        ...interview,
        hasFeedback: feedbackByInterview.has(interview.id),
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
    const driveId = body.driveId;
    const breakMinutes = Number(body.breakMinutes ?? 0);
    const room = typeof body.room === "string" ? body.room.trim() : "";
    if (driveId !== undefined && (typeof driveId !== "string" || !/^[a-f0-9-]{36}$/i.test(driveId)
      || !Number.isInteger(Number(body.durationMinutes)) || durationMinutes < 5 || durationMinutes > 240
      || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120 || room.length > 100
      || !Number.isInteger(Number(body.roundIndex)) || Number(body.roundIndex) < 1 || !["in-person", "phone", "video"].includes(body.format))) {
      throw new ApiError(400, "Enter a valid drive slot.");
    }
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
    if (user.role === "Recruiter" && !isAssignedRecruiter(r, user.email)) {
      throw new ApiError(403, "This requisition is not assigned to you.");
    }
    if (user.role === "Admin" && r.recruiterEmail) {
      const teamEmails = new Set((await listUsers())
        .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
        .map((member) => member.email));
      if (!teamEmails.has(r.recruiterEmail)) throw new ApiError(403, "This requisition is outside your managed team.");
    }
    const c = await getCandidate(candidateId);
    if (!c || c.archived || c.reqId !== reqId) throw new ApiError(400, "Invalid candidate.");

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
      rounds.find((x) => x.order === roundIndex);
    if (!round) {
      throw new ApiError(400, `Round ${roundIndex} is not configured.`);
    }
    const roundName = round.name;
    const feedbackForm = round.feedbackFormId ? (await getOrg()).feedbackFormTemplates?.find((form) => form.id === round.feedbackFormId) : undefined;
    if (round.feedbackFormId && !feedbackForm) throw new ApiError(400, "The selected feedback form is no longer available. Update the interview round before scheduling.");

    const existing = await listInterviews({ candidateId, reqId });
    const confirmed = driveId && existing.find((item) => item.driveId === driveId && item.roundIndex === roundIndex && item.status !== "Cancelled");
    if (confirmed) return json({ interview: confirmed, inviteSent: !!confirmed.calendarEventId });
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
    const bookedRounds = new Set(existing.filter((iv) => iv.status !== "Cancelled").map((iv) => iv.roundIndex || 1));
    const nextRound = rounds.find((configuredRound) => !bookedRounds.has(configuredRound.order));
    if (nextRound && roundIndex > nextRound.order) {
      throw new ApiError(
        400,
        `Schedule Round ${nextRound.order} before Round ${roundIndex}.`
      );
    }

    const interviewers = String(body.interviewers || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (driveId && (interviewers.length > 20 || interviewers.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) throw new ApiError(400, "Enter valid panelist emails.");
    if (interviewers.length === 0) {
      throw new ApiError(
        400,
        "Add at least one interviewer email."
      );
    }

    const format = body.format ?? (isCalendarEnabled() ? "video" : undefined);
    if (format !== undefined && format !== "video" && format !== "in-person" && format !== "phone") {
      throw new ApiError(400, "Choose a valid interview format.");
    }
    if (format === "video" && !isCalendarEnabled()) throw new ApiError(400, "Connect Google Calendar before scheduling a video interview.");
    let location: string | undefined;
    let phoneInstructions: string | undefined;
    if (format === "in-person") {
      const office = (await getOrg()).officeLocations?.find((item) => item.name === body.officeName && (item.city || "") === body.officeCity);
      if (!office) throw new ApiError(400, "Choose a saved office location from Company Profile.");
      location = [...new Set([office.name, office.address, office.city].filter(Boolean))].join(", ");
    }
    if (format === "phone") {
      phoneInstructions = typeof body.phoneInstructions === "string" ? body.phoneInstructions.trim() : "";
      if (!phoneInstructions || phoneInstructions.length > 300) throw new ApiError(400, "Enter phone call instructions up to 300 characters.");
    }
    const officeLocation = location;
    if (driveId) {
      if (Date.parse(datetime) <= Date.now()) throw new ApiError(400, "Drive slots must start in the future.");
      if (format === "in-person" && !room) throw new ApiError(400, "Enter a room for the in-person panel.");
      const slot = { candidateId, datetime, durationMinutes, panel: { interviewers, room: format === "in-person" ? room : "" } };
      if (driveConflict(slot, await listInterviews(), breakMinutes, officeLocation)) throw new ApiError(409, "Candidate, room, or panelist is already booked during this slot or break.");
      if (isCalendarEnabled()) {
        if (!c.email?.trim()) throw new ApiError(400, "Add a candidate email before sending a drive invite.");
        const end = new Date(Date.parse(datetime) + (durationMinutes + breakMinutes) * 60000).toISOString();
        const busy = await getInterviewBusyPeriods(interviewers, datetime, end);
        if (!isFreeInterval({ start: datetime, end }, busy)) throw new ApiError(409, "A panelist is busy in Google Calendar during this slot or break.");
      }
      if (location && room) location = `${location} · Room: ${room}`;
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

    const audit = await requestStatusAudit(user, driveId ? "Interview confirmed in a recruitment drive." : "Interview booked through the scheduling workflow.", driveId ? "Manual" : "System");
    if (driveId) audit.correlationId = driveId;

    let meetLink: string | undefined;
    let calendarEventId: string | undefined;

    if (isCalendarEnabled()) {
      try {
        const event = await createInterviewCalendarEvent({
          summary: `${roundName}: ${c.name} — ${r.title}`,
          video: format === "video",
          location,
          description: [
            ...(format === "in-person" ? ["Format: In person"] : format === "phone" ? ["Format: Phone", `Call instructions: ${phoneInstructions}`] : ["Format: Google Meet"]),
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
      ...(feedbackForm ? { feedbackForm } : {}),
      interviewerEmails: interviewers,
      ...(format ? { format } : {}),
      ...(location ? { location } : {}),
      ...(phoneInstructions ? { phoneInstructions } : {}),
      datetime,
      durationMinutes,
      ...(driveId ? { driveId, breakMinutes, ...(officeLocation ? { officeLocation, room } : {}) } : {}),
      meetLink,
      calendarEventId,
      status: "Scheduled",
      createdBy: user.email,
    }, audit).catch(async (error) => {
      if (calendarEventId) await cancelInterviewCalendarEvent(calendarEventId).catch((cleanupError) => console.error("Could not cancel failed interview booking", cleanupError));
      throw error;
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
    if (user.role === "Recruiter" && !isAssignedRecruiter(requisition, user.email)) {
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
    let format = existing.format;
    let location = existing.location || "";
    let phoneInstructions = existing.phoneInstructions || "";
    let rescheduleCandidate: Awaited<ReturnType<typeof getCandidate>> = null;

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
    if (status === "Rescheduled") {
      if (Date.parse(datetime!) <= Date.now()) throw new ApiError(400, "Choose a future interview date and time.");
      if (!["Approved", "Position Reopened", "Partially Fulfilled"].includes(requisition.status)) throw new ApiError(400, "The hiring request must be open to reschedule an interview.");
      const candidate = await getCandidate(existing.candidateId);
      rescheduleCandidate = candidate;
      if (!candidate || candidate.archived || ["Rejected", "Social CV Reject", "Candidate Backed Out", "Onboarded"].includes(candidate.stage)) throw new ApiError(400, "This candidate is not available for rescheduling.");
      if (interviewerEmails && (!interviewerEmails.length || interviewerEmails.length > 20 || interviewerEmails.some((email) => typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) throw new ApiError(400, "Enter valid interviewer email addresses.");
      if (existing.calendarEventId && !isCalendarEnabled()) throw new ApiError(503, "Reconnect Google Calendar before rescheduling this interview, so its invitation can be updated.");
      if (body.format !== undefined) {
        if (!["video", "in-person", "phone"].includes(body.format)) throw new ApiError(400, "Choose a valid interview format.");
        format = body.format;
        if (format === "video" && !isCalendarEnabled()) throw new ApiError(400, "Connect Google Calendar before scheduling a video interview.");
        location = ""; phoneInstructions = "";
        if (format === "in-person") {
          const office = (await getOrg()).officeLocations?.find((item) => item.name === body.officeName && (item.city || "") === body.officeCity);
          if (!office) throw new ApiError(400, "Choose a saved office location.");
          location = [...new Set([office.name, office.address, office.city].filter(Boolean))].join(", ");
        }
        if (format === "phone") {
          phoneInstructions = typeof body.phoneInstructions === "string" ? body.phoneInstructions.trim() : "";
          if (!phoneInstructions || phoneInstructions.length > 300) throw new ApiError(400, "Enter phone call instructions up to 300 characters.");
        }
      }
    }

    const audit = status !== undefined && status !== existing.status ? await requestStatusAudit(user, status === "Rescheduled" && !body.reason ? "Interview rescheduled with a new time." : body.reason) : undefined;
    let meetLink = existing.meetLink || "";
    let calendarEventId = existing.calendarEventId || "";
    if (isCalendarEnabled() && existing.calendarEventId) {
      try {
        if (status === "Cancelled") {
          await cancelInterviewCalendarEvent(existing.calendarEventId);
        } else if (datetime || interviewerEmails) {
          const candidate = interviewerEmails ? await getCandidate(existing.candidateId) : null;
          const updatedEvent = await updateInterviewCalendarEvent(existing.calendarEventId, {
            startIso: datetime,
            attendeeEmails: interviewerEmails ? [...interviewerEmails, ...(candidate?.email ? [candidate.email] : [])] : undefined,
            ...(status === "Rescheduled" && body.format !== undefined ? { video: format === "video", location, formatDescription: format === "phone" ? `Format: Phone\nCall instructions: ${phoneInstructions}` : format === "in-person" ? "Format: In person" : "Format: Google Meet" } : {}),
          });
          if (status === "Rescheduled" && body.format !== undefined) meetLink = format === "video" ? updatedEvent.meetLink || "" : "";
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Calendar update failed";
        throw new ApiError(502, `Calendar update failed: ${msg}`);
      }
    }
    if (status === "Rescheduled" && body.format !== undefined && !existing.calendarEventId && isCalendarEnabled()) {
      try {
        const event = await createInterviewCalendarEvent({ summary: `${existing.roundName || existing.stage}: ${rescheduleCandidate?.name || "Candidate"} — ${requisition.title}`, video: format === "video", location, description: format === "phone" ? `Format: Phone\nCall instructions: ${phoneInstructions}` : format === "in-person" ? "Format: In person" : "Format: Google Meet", startIso: datetime!, durationMinutes: existing.durationMinutes, attendeeEmails: [...(interviewerEmails || existing.interviewerEmails), ...(rescheduleCandidate?.email ? [rescheduleCandidate.email] : [])] });
        calendarEventId = event.eventId; meetLink = event.meetLink || "";
      } catch (e) { throw new ApiError(502, `Could not create the calendar invitation: ${e instanceof Error ? e.message : "Calendar error"}`); }
    }

    await updateInterview(id, {
      status,
      rescheduleRequestedBy: status === "Reschedule Requested" ? rescheduleRequestedBy : existing.rescheduleRequestedBy,
      datetime,
      interviewerEmails,
      ...(status === "Rescheduled" && body.format !== undefined ? { format, location, phoneInstructions, meetLink, calendarEventId } : {}),
    }, audit, existing.status).catch(async (error) => { if (!existing.calendarEventId && calendarEventId) await cancelInterviewCalendarEvent(calendarEventId).catch(() => {}); throw error; });
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
