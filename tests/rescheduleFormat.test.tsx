import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleView } from "../src/components/ats/ScheduleView";
import type { Interview, Requisition } from "../src/lib/types";

test("rescheduling exposes the existing interview format as an editable selector", () => {
  const interview = { id: "iv1", reqId: "r1", candidateId: "c1", stage: "Interview", roundIndex: 1, status: "Reschedule Requested", datetime: "2026-11-20T10:00:00Z", format: "phone", phoneInstructions: "Call the candidate", interviewerEmails: ["panel@example.com"], createdAt: "2026-11-01T10:00:00Z", createdBy: "admin@example.com" } as Interview;
  const html = renderToStaticMarkup(<ScheduleView reqs={[{ id: "r1", title: "Role", status: "Approved" } as Requisition]} apiFetch={async () => new Response()} onDone={() => {}} initialReqId="r1" initialCandidateId="c1" rescheduleInterview={interview} />);
  assert.match(html, /id="interview-format"/);
  assert.match(html, /value="phone" selected/);
  assert.match(html, /Call the candidate/);
  assert.doesNotMatch(html, /Reason for status update/);
});
