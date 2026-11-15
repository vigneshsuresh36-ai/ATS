import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationsView } from "../src/components/ats/AutomationsView";
import { defaultAutomationSettings } from "../src/lib/automationTypes";
const noop = () => {};
test("new workspace shows six paused workflows, real zero counts and setup status", () => {
  const html = renderToStaticMarkup(<AutomationsView apiFetch={async () => new Response()} onReq={noop} onCand={noop} initialData={{ settings: defaultAutomationSettings(), tasks: [], integrations: { ai: false, email: false, scheduler: false } }} />);
  assert.equal((html.match(/role="switch"/g) || []).length, 6);
  assert.equal((html.match(/aria-checked="false"/g) || []).length, 6);
  assert.ok(!html.includes("AI interview briefs"));
  assert.ok(html.includes("Interview reminders"));
  assert.ok(html.includes("Setup needed")); assert.ok(html.includes("No activity yet"));
  assert.ok(html.includes("Interview scheduling remains manual"));
  assert.ok(!html.includes("12 Reminders"));
});
test("review queue shows actual saved drafts and delivery exceptions", () => {
  const base = { ownerEmail: "recruiter@example.com", reqId: "R1", sourceVersion: "v1", recipients: ["test@example.com"], subject: "Test", body: "Draft", createdAt: "2026-10-28T06:00:00Z", updatedAt: "2026-10-28T06:00:00Z" };
  const html = renderToStaticMarkup(<AutomationsView apiFetch={async () => new Response()} onReq={noop} onCand={noop} initialData={{ settings: defaultAutomationSettings(), tasks: [
    { ...base, id: "a", workflow: "updates", title: "Candidate stage update", detail: "Sample Candidate", status: "pending" },
    { ...base, id: "b", workflow: "feedback", title: "Feedback reminder", detail: "Sample Interview", status: "failed", error: "Missing interviewer email" },
  ], integrations: { ai: false, email: false, scheduler: false } }} />);
  assert.ok(html.includes("Candidate stage update")); assert.ok(html.includes("Sample Candidate")); assert.ok(html.includes("Missing interviewer email")); assert.ok(html.includes("Needs attention"));
});
