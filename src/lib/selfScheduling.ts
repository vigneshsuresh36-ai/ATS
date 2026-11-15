import { createHash, randomBytes } from "node:crypto";

export type SchedulingInterval = { start: string; durationMinutes: number; interviewerEmails: string[] };

/** Random bearer links are stored as hashes, so a database read does not expose the link. */
export function newSchedulingToken() { return randomBytes(32).toString("base64url"); }
export function schedulingTokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

/** Half-open time ranges allow a new interview to start when another ends. */
export function interviewsConflict(a: SchedulingInterval, b: SchedulingInterval): boolean {
  const aStart = Date.parse(a.start), bStart = Date.parse(b.start);
  if (!Number.isFinite(aStart) || !Number.isFinite(bStart) || !Number.isInteger(a.durationMinutes) || !Number.isInteger(b.durationMinutes) || a.durationMinutes <= 0 || b.durationMinutes <= 0) return true;
  const aPeople = new Set(a.interviewerEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const sharesInterviewer = b.interviewerEmails.some((email) => aPeople.has(email.trim().toLowerCase()));
  return sharesInterviewer && aStart < bStart + b.durationMinutes * 60000 && bStart < aStart + a.durationMinutes * 60000;
}

export function validSchedulingSlots(slots: string[], durationMinutes: number, now = Date.now()): boolean {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 20 || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return false;
  const times = slots.map((slot) => Date.parse(slot));
  return times.every((time) => Number.isFinite(time) && time > now && time <= now + 90 * 86400000) && new Set(times).size === times.length;
}
