import { test } from "node:test";
import assert from "node:assert/strict";
import { planAutomations, renderTemplate, taskKey } from "../src/lib/automationPlanner";
import { defaultAutomationSettings } from "../src/lib/automationTypes";
import { permittedAutomationRequests } from "../src/lib/automationAccess";
import type { AutomationContext } from "../src/lib/automationContext";
import type { AppUser, Candidate, Interview, InterviewFeedback, Requisition, StageEvent } from "../src/lib/types";

const now = Date.parse("2026-10-28T06:30:00Z");
const before = (hours: number) => new Date(now - hours * 3600000).toISOString();
const user: AppUser = { id: "recruiter", name: "Recruiter", email: "recruiter@example.com", role: "Recruiter", title: "Recruiter", departments: ["Engineering"], active: true, createdAt: before(100) };
const request = { id: "REQ1", title: "Frontend Engineer", department: "Engineering", status: "Approved", recruiterEmail: user.email, raisedByEmail: "hm@example.com", updatedAt: before(96), createdAt: before(100) } as Requisition;
const candidate = { id: "C1", reqId: "REQ1", name: "Sample Candidate", email: "candidate@example.com", stage: "Interview", updatedAt: before(70), createdAt: before(80), archived: false } as Candidate;
const interview: Interview = { id: "I1", reqId: "REQ1", candidateId: "C1", stage: "Technical", interviewerEmails: ["a@example.com", "b@example.com"], datetime: before(60), status: "Completed", createdAt: before(70), createdBy: user.email };
function context(): AutomationContext { return { requisitions: [{ ...request }], candidates: [{ ...candidate }], interviews: [{ ...interview }], feedback: [], events: [], users: [{ ...user, managerEmail: "manager@example.com" }, { ...user, id: "manager", email: "manager@example.com", role: "Admin" }, { ...user, id: "head", email: "head@example.com", role: "DepartmentHead" }], org: { id: "org", company: "STARSHIP", slaDaysDefault: 10, offerJoiningEnabled: true } }; }
function settings() { const s = defaultAutomationSettings(); for (const c of Object.values(s)) c.enabled = true; return s; }
test("paused defaults produce no jobs", () => assert.deepEqual(planAutomations(context(), defaultAutomationSettings(), user, now), []));
test("feedback reminder targets only panelists missing feedback", () => {
  const ctx = context(); ctx.feedback = [{ interviewId: "I1", interviewer: "a@example.com" } as InterviewFeedback];
  const tasks = planAutomations(ctx, settings(), user, now);
  assert.deepEqual(tasks.find((t) => t.title === "Feedback reminder")?.recipients, ["b@example.com"]);
  assert.deepEqual(tasks.find((t) => t.title.includes("escalation"))?.recipients, ["manager@example.com"]);
});
test("feedback stops when all panelists submit", () => {
  const ctx = context(); ctx.feedback = interview.interviewerEmails.map((interviewer) => ({ interviewId: "I1", interviewer } as InterviewFeedback));
  assert.equal(planAutomations(ctx, settings(), user, now).filter((t) => t.workflow === "feedback").length, 0);
});
test("cancelled and reschedule-requested interviews produce no jobs", () => {
  for (const status of ["Cancelled", "Reschedule Requested"] as const) { const ctx = context(); ctx.interviews[0].status = status; assert.equal(planAutomations(ctx, settings(), user, now).length, 0); }
});
test("future interviews do not generate interview briefs or feedback reminders", () => {
  const ctx = context(); ctx.interviews[0].datetime = before(-5); ctx.interviews[0].status = "Scheduled";
  const tasks = planAutomations(ctx, settings(), user, now);
  assert.equal(tasks.filter((t) => t.workflow === "briefs").length, 0);
  assert.equal(tasks.filter((t) => t.workflow === "feedback").length, 0);
  const reminders = tasks.filter((t) => t.workflow === "interviewReminders");
  assert.deepEqual(reminders.map((t) => t.recipients), [["candidate@example.com"], ["a@example.com"], ["b@example.com"]]);
  assert.ok(reminders.every((t) => t.body.includes("Technical") && !t.body.includes("{interviewTime}")));
});
test("pre-interview reminders are invalidated when the interview changes or completes", () => {
  const ctx = context(); ctx.interviews[0].datetime = before(-5); ctx.interviews[0].status = "Scheduled";
  const ids = planAutomations(ctx, settings(), user, now).filter((t) => t.workflow === "interviewReminders").map((t) => t.id);
  ctx.interviews[0].datetime = before(-4);
  assert.ok(planAutomations(ctx, settings(), user, now).filter((t) => t.workflow === "interviewReminders").every((t) => !ids.includes(t.id)));
  ctx.interviews[0].status = "Completed";
  assert.equal(planAutomations(ctx, settings(), user, now).filter((t) => t.workflow === "interviewReminders").length, 0);
});
test("briefs outside configured window are not generated", () => {
  const ctx = context(); ctx.interviews[0].datetime = before(-30);
  assert.equal(planAutomations(ctx, settings(), user, now).length, 0);
});
test("business-event IDs stay stable across managers and repeated runs", () => {
  const a = planAutomations(context(), settings(), user, now);
  const b = planAutomations(context(), settings(), { ...user, email: "admin@example.com" }, now + 10000);
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
  assert.equal(taskKey("same"), taskKey("same")); assert.notEqual(taskKey("same"), taskKey("different"));
});
test("rescheduling changes the event ID and invalidates the old plan", () => {
  const ctx = context(); const oldIds = planAutomations(ctx, settings(), user, now).map((t) => t.id); ctx.interviews[0].datetime = before(59);
  assert.ok(planAutomations(ctx, settings(), user, now).every((t) => !oldIds.includes(t.id)));
});
test("request approval reminders respect timing and department ownership", () => {
  const ctx = context(); ctx.interviews = []; ctx.requisitions[0].status = "PendingApproval";
  assert.deepEqual(planAutomations(ctx, settings(), user, now)[0].recipients, ["head@example.com"]);
  ctx.requisitions[0].updatedAt = before(1); assert.equal(planAutomations(ctx, settings(), user, now).length, 0);
});
test("candidate approval reminder targets the hiring manager", () => {
  const ctx = context(); ctx.interviews = []; ctx.candidates[0].stage = "PendingHMApproval";
  assert.deepEqual(planAutomations(ctx, settings(), user, now)[0].recipients, ["hm@example.com"]);
});
test("joining stops on confirmation, withdrawal, no-show and onboarding", () => {
  for (const status of ["Confirmed", "Candidate Withdrawn", "No-Show", "Joined"] as const) {
    const ctx = context(); ctx.interviews = []; Object.assign(ctx.candidates[0], { stage: "Offered", currentDoj: "2026-10-30", joiningStatus: status });
    assert.equal(planAutomations(ctx, settings(), user, now).length, 0);
  }
});
test("joining checkpoints are distinct and joining add-on can disable them", () => {
  const ctx = context(); ctx.interviews = []; Object.assign(ctx.candidates[0], { stage: "Offered", currentDoj: "2026-11-02", joiningStatus: "Awaiting Confirmation" });
  const first = planAutomations(ctx, settings(), user, now)[0];
  const second = planAutomations(ctx, settings(), user, now + 3 * 86400000)[0];
  assert.ok(first); assert.ok(second); assert.notEqual(first.id, second.id);
  ctx.org.offerJoiningEnabled = false; assert.equal(planAutomations(ctx, settings(), user, now).length, 0);
});
test("old and sensitive stage transitions are never messaged", () => {
  const ctx = context(); ctx.interviews = [];
  const s = { ...settings(), enabledSince: before(24) };
  ctx.events = [{ id: "E1", candidateId: "C1", reqId: "REQ1", toStage: "Interview", fromStage: "Screened", at: before(48), byEmail: user.email }];
  assert.equal(planAutomations(ctx, s, user, now).length, 0);
  for (const stage of ["Rejected", "OfferApproved", "Offered", "Candidate Backed Out"] as const) {
    ctx.candidates[0].stage = stage; ctx.events[0].toStage = stage; ctx.events[0].at = before(1);
    assert.equal(planAutomations(ctx, s, user, now).filter((t) => t.workflow === "updates").length, 0);
  }
});
test("new non-sensitive transitions generate one reviewable message", () => {
  const ctx = context(); ctx.interviews = [];
  ctx.events = [{ id: "E2", candidateId: "C1", reqId: "REQ1", toStage: "Interview", fromStage: "Screened", at: before(1), byEmail: user.email } as StageEvent];
  const tasks = planAutomations(ctx, { ...settings(), enabledSince: before(24) }, user, now);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, "pending"); assert.equal(tasks[0].workflow, "updates"); assert.ok(tasks[0].body.includes("Sample Candidate"));
});
test("closed requisitions do not trigger candidate reminders", () => {
  const ctx = context(); ctx.requisitions[0].status = "Position Closed"; assert.equal(planAutomations(ctx, settings(), user, now).length, 0);
});
test("missing interviewer email yields an explicit empty-recipient task", () => {
  const ctx = context(); ctx.interviews[0].interviewerEmails = [];
  assert.deepEqual(planAutomations(ctx, settings(), user, now).find((t) => t.title === "Feedback reminder")?.recipients, []);
});
test("templates replace only supported placeholders", () => assert.equal(renderTemplate("Hi {candidateName}. {unknown}", { candidateName: "A" }), "Hi A. {unknown}"));
test("recruiter scope excludes other recruiters and unassigned roles", () => {
  const requests = [request, { ...request, id: "other", recruiterEmail: "other@example.com" }, { ...request, id: "unassigned", recruiterEmail: undefined }];
  assert.deepEqual(permittedAutomationRequests(user, requests, []).map((r) => r.id), ["REQ1"]);
});
test("admin scope includes only active managed recruiters and unassigned roles", () => {
  const requests = [request, { ...request, id: "other", recruiterEmail: "other@example.com" }, { ...request, id: "unassigned", recruiterEmail: undefined }];
  const admin = { ...user, role: "Admin" as const, email: "admin@example.com" };
  assert.deepEqual(permittedAutomationRequests(admin, requests, [{ ...user, managerEmail: admin.email }]).map((r) => r.id), ["REQ1", "unassigned"]);
  assert.deepEqual(permittedAutomationRequests(admin, requests, [{ ...user, managerEmail: admin.email, active: false }]).map((r) => r.id), ["unassigned"]);
});
test("non-recruiting roles receive no automation scope", () => {
  for (const role of ["HiringManager", "DepartmentHead", "Employee"] as const) assert.deepEqual(permittedAutomationRequests({ ...user, role }, [request], [user]), []);
});
