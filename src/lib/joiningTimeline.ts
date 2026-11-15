import type { Requisition } from "./types";
import { isRequisitionOpenForRecruiting } from "./requisitionStatus";

type TimelineInput = Pick<Requisition, "priority" | "approvedAt" | "status">;
const dayInMilliseconds = 86_400_000;
const calendarFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function calendarDate(timestamp: number) {
  const parts = Object.fromEntries(calendarFormatter.formatToParts(timestamp).map(({ type, value }) => [type, value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

export function joiningTimeline(request: TimelineInput, now = Date.now()) {
  if (!isRequisitionOpenForRecruiting(request.status) || !request.approvedAt) return null;
  const match = request.priority?.trim().match(/^(\d+)\s*(?:[-–—]\s*(\d+)\s*)?days?$/i);
  const approved = Date.parse(request.approvedAt);
  if (!match || !Number.isFinite(approved) || !Number.isFinite(now)) return null;

  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum || maximum > 3650) return null;

  const approvalDate = calendarDate(approved);
  const cutoffDay = Date.parse(approvalDate) + maximum * dayInMilliseconds;
  const remainingDays = (cutoffDay - Date.parse(calendarDate(now))) / dayInMilliseconds;
  const status = remainingDays < 0 ? "overdue" : remainingDays <= 7 ? "approaching" : "on-track";
  return {
    approvalDate,
    deadline: new Date(cutoffDay).toISOString().slice(0, 10),
    remainingDays,
    status,
    targetDays: maximum,
  } as const;
}

export function joiningCountdownLabel(remainingDays: number) {
  if (remainingDays === 0) return "Due today";
  const days = Math.abs(remainingDays);
  const duration = days + (days === 1 ? " day" : " days");
  return remainingDays < 0 ? duration + " overdue (−" + days + ")" : duration + " left";
}
