import { createHash } from "node:crypto";
import type { AutomationContext } from "./automationContext";
import type { AutomationSettings, AutomationTask, WorkflowId } from "./automationTypes";
import type { AppUser } from "./types";

export const taskKey = (key: string) => createHash("sha256").update(key).digest("hex");
const activeCandidate = (stage: string) => !["Rejected", "Social CV Reject", "Candidate Backed Out", "Onboarded", "On Hold"].includes(stage);
export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{(candidateName|roleTitle|companyName|stage|joiningDate|interviewTime|roundName|meetingDetails)\}/g, (_, key: string) => values[key] || "");
}
/** Pure planner: deterministic business-event IDs prevent duplicate messages across runners and managers. */
export function planAutomations(ctx: AutomationContext, settings: AutomationSettings & { enabledSince?: string }, user: AppUser, now = Date.now()): AutomationTask[] {
  const tasks: AutomationTask[] = [];
  const stamp = new Date(now).toISOString();
  const enabledSince = settings.enabledSince;
  const values = (name: string, title: string, stage = "", date = "") => ({ candidateName: name, roleTitle: title, companyName: ctx.org.company, stage, joiningDate: date });
  const add = (workflow: WorkflowId, key: string, input: Partial<AutomationTask> & Pick<AutomationTask, "reqId" | "sourceVersion" | "title" | "detail">, vars: Record<string, string>, recipients: string[]) => {
    if (!settings[workflow].enabled) return;
    const config = settings[workflow];
    tasks.push({ id: taskKey(`${workflow}:${key}`), workflow, ownerEmail: user.email, recipients: [...new Set(recipients.filter(Boolean))],
      subject: renderTemplate(config.subject, vars), body: renderTemplate(config.template, vars), status: "pending", createdAt: stamp, updatedAt: stamp, ...input });
  };
  for (const r of ctx.requisitions) {
    const candidates = ctx.candidates.filter((c) => c.reqId === r.id);
    if (r.status === "PendingApproval" && now - Date.parse(r.updatedAt) >= settings.approvals.delayHours * 3600000) {
      const recipients = ctx.users.filter((u) => u.active && (r.department ? u.role === "DepartmentHead" && u.departments.some((d) => d.toLowerCase() === r.department.toLowerCase()) : u.role === "Admin")).map((u) => u.email);
      add("approvals", `${r.id}:${r.updatedAt}`, { reqId: r.id, sourceVersion: r.updatedAt, title: "Hiring request awaiting approval", detail: r.title }, values("", r.title), recipients);
    }
    if (["Rejected", "Closed", "Position Closed", "Position Fulfilled"].includes(r.status)) continue;
    for (const c of candidates) {
      if (!activeCandidate(c.stage)) continue;
      const vars = values(c.name, r.title, c.stage === "HMApproved" ? "hiring manager review completed" : c.stage, c.currentDoj || c.initialDoj || c.tentativeDoj || "");
      if (c.stage === "PendingHMApproval" && now - Date.parse(c.updatedAt) >= settings.approvals.delayHours * 3600000) {
        add("approvals", `candidate:${c.id}:${c.updatedAt}`, { reqId: r.id, candidateId: c.id, sourceVersion: c.updatedAt, title: "Candidate awaiting hiring manager review", detail: `${c.name} · ${r.title}` }, vars, [r.raisedByEmail]);
      }
      if (c.offerApprovalStatus === "Pending" && now - Date.parse(c.offerRequestedAt || c.updatedAt) >= settings.approvals.delayHours * 3600000) {
        const recipients = ctx.users.filter((u) => u.active && u.role === "DepartmentHead" && u.departments.some((d) => d.toLowerCase() === r.department.toLowerCase())).map((u) => u.email);
        add("approvals", `offer:${c.id}:${c.offerRequestedAt || c.updatedAt}`, { reqId: r.id, candidateId: c.id, sourceVersion: c.offerRequestedAt || c.updatedAt, title: "Offer awaiting approval", detail: `${c.name} · ${r.title}` }, vars, recipients);
      }
      // Never replay old transitions on enable, and never send rejection/offer decisions through this workflow.
      const event = ctx.events.filter((e) => e.candidateId === c.id && e.toStage === c.stage).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (event && enabledSince && event.at >= enabledSince && ["Screened", "Shortlist", "HMApproved", "Interview", "Interview Scheduled", "Debrief"].includes(c.stage)) {
        add("updates", event.id, { reqId: r.id, candidateId: c.id, sourceVersion: event.id, title: "Candidate stage update", detail: `${c.name} · ${c.stage}` }, vars, [c.email]);
      }
      const date = c.currentDoj || c.initialDoj || c.tentativeDoj;
      if (ctx.org.offerJoiningEnabled && c.stage === "Offered" && date && (!c.joiningStatus || ["Awaiting Confirmation", "Rescheduled"].includes(c.joiningStatus))) {
        // Compare date-only values in the configured business timezone, independent of the host timezone.
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata" }).format(new Date(now));
        const days = (Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
        const window = Math.max(1, Math.round(settings.joining.delayHours / 24));
        const checkpoint = days <= 2 ? 2 : window;
        if (days >= 0 && days <= window) add("joining", `${c.id}:${date}:${checkpoint}`, { reqId: r.id, candidateId: c.id, sourceVersion: date, title: "Joining confirmation", detail: `${c.name} · ${date}` }, vars, [c.email]);
      }
      for (const iv of ctx.interviews.filter((i) => i.candidateId === c.id && i.reqId === r.id && i.status !== "Cancelled" && i.status !== "Reschedule Requested")) {
        const ageHours = (now - Date.parse(iv.datetime)) / 3600000;
        if (["Scheduled", "Rescheduled"].includes(iv.status) && ageHours < 0 && ageHours >= -settings.interviewReminders.delayHours) {
          const interviewTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata", timeZoneName: undefined }).format(new Date(iv.datetime));
          const reminderVars = { ...vars, interviewTime: `${interviewTime} (${process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata"})`, roundName: iv.roundName || iv.stage, meetingDetails: iv.meetLink ? `Meeting link: ${iv.meetLink}` : "Please refer to your interview invitation for meeting details." };
          for (const recipient of new Set([c.email, ...iv.interviewerEmails].map((email) => (email || "").trim().toLowerCase()).filter(Boolean))) {
            add("interviewReminders", `${iv.id}:${iv.datetime}:${recipient}`, { reqId: r.id, candidateId: c.id, interviewId: iv.id, sourceVersion: iv.datetime, title: "Upcoming interview reminder", detail: `${c.name} · ${iv.roundName || iv.stage}` }, reminderVars, [recipient]);
          }
        }
        const completed = new Set(ctx.feedback.filter((f) => f.interviewId === iv.id).map((f) => f.interviewer.toLowerCase()));
        const missing = iv.interviewerEmails.filter((email) => !completed.has(email.toLowerCase()));
        if (ageHours >= settings.feedback.delayHours && (missing.length || !iv.interviewerEmails.length)) {
          add("feedback", `${iv.id}:${iv.datetime}:reminder`, { reqId: r.id, candidateId: c.id, interviewId: iv.id, sourceVersion: iv.datetime, title: "Feedback reminder", detail: `${c.name} · ${iv.roundName || iv.stage}` }, vars, missing);
          if (ageHours >= settings.feedback.escalationHours) {
            const recruiter = ctx.users.find((u) => u.email === r.recruiterEmail);
            const manager = ctx.users.find((u) => u.active && u.email === recruiter?.managerEmail);
            add("feedback", `${iv.id}:${iv.datetime}:escalation`, { reqId: r.id, candidateId: c.id, interviewId: iv.id, sourceVersion: iv.datetime, title: "Overdue feedback escalation", detail: `${c.name} · Feedback remains outstanding` }, vars, manager ? [manager.email] : [r.raisedByEmail]);
          }
        }
      }
    }
  }
  return tasks;
}
