import type { Interview } from "./types";

export type DrivePanel = { interviewers: string[]; room: string };
export type DriveSlot = { candidateId: string; datetime: string; durationMinutes: number; panel: DrivePanel };

const minute = 60000;

export function driveConflict(slot: DriveSlot, existing: Interview[], breakMinutes: number, office?: string) {
  const start = Date.parse(slot.datetime);
  return existing.some((interview) => {
    if (interview.status !== "Scheduled" && interview.status !== "Rescheduled") return false;
    const sameRoom = !!slot.panel.room && !!office && interview.officeLocation === office
      && interview.room?.toLowerCase() === slot.panel.room.toLowerCase();
    const samePanelist = interview.interviewerEmails.some((email) => slot.panel.interviewers.includes(email.trim().toLowerCase()));
    if (!sameRoom && !samePanelist && interview.candidateId !== slot.candidateId) return false;
    const otherStart = Date.parse(interview.datetime);
    const otherEnd = otherStart + ((interview.durationMinutes ?? 60) + (interview.breakMinutes ?? 0)) * minute;
    return start < otherEnd && otherStart < start + (slot.durationMinutes + breakMinutes) * minute;
  });
}

export function planDrive(input: {
  start: number; end: number; breakMinutes: number; panels: DrivePanel[];
  candidates: { id: string; duration: number }[]; existing: Interview[]; office?: string;
}) {
  const { start, end, breakMinutes, panels, candidates, office } = input;
  const bookings = [...input.existing];
  const slots: DriveSlot[] = [];
  const unplaced: string[] = [];
  const nextStarts = panels.map(() => start);
  for (const candidate of candidates) {
    let earliest: DriveSlot | undefined;
    let selectedPanel = -1;
    panels.forEach((panel, index) => {
      for (let time = nextStarts[index]; time + candidate.duration * minute <= end; time += minute) {
        const slot = { candidateId: candidate.id, datetime: new Date(time).toISOString(), durationMinutes: candidate.duration, panel };
        if (driveConflict(slot, bookings, breakMinutes, office)) continue;
        if (!earliest || time < Date.parse(earliest.datetime)) {
          earliest = slot;
          selectedPanel = index;
        }
        break;
      }
    });
    if (!earliest) { unplaced.push(candidate.id); continue; }
    const slot: DriveSlot = earliest;
    slots.push(slot);
    nextStarts[selectedPanel] = Date.parse(slot.datetime) + (slot.durationMinutes + breakMinutes) * minute;
    bookings.push({
      candidateId: slot.candidateId, datetime: slot.datetime, durationMinutes: slot.durationMinutes, breakMinutes,
      interviewerEmails: slot.panel.interviewers, room: slot.panel.room, officeLocation: office, status: "Scheduled",
    } as Interview);
  }
  return { slots, unplaced };
}
