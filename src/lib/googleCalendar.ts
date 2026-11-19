import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { isCalendarEnabled } from "./calendarConfig";

export { isCalendarEnabled };

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

function loadSaJson(): {
  client_email: string;
  private_key: string;
} | null {
  const pathEnv = process.env.FIREBASE_ADMIN_CREDENTIALS_PATH;
  if (pathEnv) {
    const full = resolve(process.cwd(), pathEnv);
    if (existsSync(full)) {
      return JSON.parse(readFileSync(full, "utf8"));
    }
  }
  if (
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return {
      client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      private_key: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").replace(
        /\\n/g,
        "\n"
      ),
    };
  }
  return null;
}

async function getCalendarClient() {
  const { google } = await import("googleapis");
  const impersonate = (process.env.GOOGLE_CALENDAR_IMPERSONATE_EMAIL || "")
    .trim()
    .toLowerCase();
  if (!impersonate) {
    throw new Error(
      "GOOGLE_CALENDAR_IMPERSONATE_EMAIL is required (Workspace user whose calendar hosts invites)."
    );
  }
  const sa = loadSaJson();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error("Firebase Admin service account credentials are missing.");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: CALENDAR_SCOPES,
    subject: impersonate,
  });
  await auth.authorize();
  return google.calendar({ version: "v3", auth });
}

/** Reject unknown calendars rather than treating missing free/busy data as availability. */
export async function getInterviewBusyPeriods(interviewerEmails: string[], startIso: string, endIso: string) {
  const calendar = await getCalendarClient();
  const response = await calendar.freebusy.query({ requestBody: { timeMin: startIso, timeMax: endIso, items: interviewerEmails.map((id) => ({ id })) } });
  const result = response.data.calendars || {};
  return interviewerEmails.flatMap((email) => {
    const entry = result[email];
    if (!entry || entry.errors?.length || !entry.busy) throw new Error(`Free/busy is unavailable for ${email}. Check calendar sharing and service access.`);
    return entry.busy.map((period) => ({ start: period.start || "", end: period.end || "" }));
  });
}

export type CreateInterviewEventInput = {
  video: boolean;
  location?: string;
  summary: string;
  description: string;
  startIso: string;
  durationMinutes?: number;
  attendeeEmails: string[];
  timeZone?: string;
};

export type CreateInterviewEventResult = {
  eventId: string;
  htmlLink?: string;
  meetLink?: string;
};

export async function createInterviewCalendarEvent(
  input: CreateInterviewEventInput
): Promise<CreateInterviewEventResult> {
  const calendar = await getCalendarClient();
  const duration = input.durationMinutes || 60;
  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error("Invalid interview datetime.");
  }
  const end = new Date(start.getTime() + duration * 60_000);
  const timeZone =
    input.timeZone ||
    process.env.GOOGLE_CALENDAR_TIMEZONE ||
    "Asia/Kolkata";

  const attendees = [
    ...new Set(
      input.attendeeEmails
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].map((email) => ({ email }));

  const res = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: input.video ? 1 : 0,
    sendUpdates: input.video ? "none" : "all",
    requestBody: {
      summary: input.summary,
      location: input.location,
      description: input.description,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: input.video ? undefined : attendees,
      guestsCanModify: false,
      guestsCanInviteOthers: false,
      conferenceData: input.video ? {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      } : undefined,
    },
  });

  let event = res.data;
  const eventId = event.id;
  if (!eventId) throw new Error("Calendar event created without an id.");
  if (!input.video) return { eventId, htmlLink: event.htmlLink || undefined };

  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const meetLink = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
      if (meetLink) {
        await calendar.events.patch({
          calendarId: "primary", eventId, conferenceDataVersion: 1, sendUpdates: "all",
          requestBody: { attendees },
        });
        return { eventId, htmlLink: event.htmlLink || undefined, meetLink };
      }
      if (event.conferenceData?.createRequest?.status?.statusCode === "failure") break;
      await delay(750);
      event = (await calendar.events.get({ calendarId: "primary", eventId })).data;
    }
    throw new Error("Google Meet could not create a video link for the organizer.");
  } catch (error) {
    await calendar.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" }).catch(() => {});
    throw error;
  }
}

export async function cancelInterviewCalendarEvent(eventId: string) {
  if (!isCalendarEnabled() || !eventId) return;
  const calendar = await getCalendarClient();
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
  });
}

export async function updateInterviewCalendarEvent(
  eventId: string,
  patch: {
    startIso?: string;
    durationMinutes?: number;
    attendeeEmails?: string[];
    summary?: string;
    description?: string;
    location?: string;
    video?: boolean;
    formatDescription?: string;
  }
) {
  const calendar = await getCalendarClient();
  const existing = await calendar.events.get({
    calendarId: "primary",
    eventId,
  });
  const timeZone = process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata";
  const originalStart = Date.parse(existing.data.start?.dateTime || "");
  const originalEnd = Date.parse(existing.data.end?.dateTime || "");
  const existingDuration = (originalEnd - originalStart) / 60_000;
  const duration = patch.durationMinutes || (Number.isFinite(existingDuration) && existingDuration > 0 ? existingDuration : 60);
  const startIso = patch.startIso || existing.data.start?.dateTime;
  if (!startIso) throw new Error("Event has no start time.");
  const start = new Date(startIso);
  const end = new Date(start.getTime() + duration * 60_000);

  const attendees = patch.attendeeEmails
    ? [
        ...new Set(
          patch.attendeeEmails
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean)
        ),
      ].map((email) => ({ email }))
    : existing.data.attendees;

  const res = await calendar.events.patch({
    calendarId: "primary",
    eventId,
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: patch.summary ?? existing.data.summary,
      description: patch.formatDescription ? [patch.formatDescription, (existing.data.description || "").split("\n").filter((line) => !/^(Format:|Call instructions:)/.test(line)).join("\n")].filter(Boolean).join("\n") : patch.description ?? existing.data.description,
      location: patch.location ?? existing.data.location,
      ...(patch.video === true && !existing.data.conferenceData ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : patch.video === false ? { conferenceData: null as unknown as NonNullable<typeof existing.data.conferenceData> } : {}),
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees,
    },
  });

  let updated = res.data;
  if (patch.video === true && !updated.hangoutLink && !updated.conferenceData?.entryPoints?.some((entry) => entry.entryPointType === "video")) {
    for (let attempt = 0; attempt < 8; attempt++) {
      await delay(750);
      updated = (await calendar.events.get({ calendarId: "primary", eventId })).data;
      if (updated.hangoutLink || updated.conferenceData?.entryPoints?.some((entry) => entry.entryPointType === "video")) break;
    }
    if (!updated.hangoutLink && !updated.conferenceData?.entryPoints?.some((entry) => entry.entryPointType === "video")) throw new Error("Google Meet could not create a video link. Check the calendar event before retrying.");
  }
  return {
    eventId,
    meetLink:
      updated.hangoutLink ||
      updated.conferenceData?.entryPoints?.find(
        (e) => e.entryPointType === "video"
      )?.uri,
  };
}
