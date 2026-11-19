import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelinePanel } from "../src/components/ats/PipelinePanel";
import { CandidatePanel } from "../src/components/ats/CandidatePanel";
import type { Candidate, Interview, Requisition } from "../src/lib/types";

const req = { id: "req1", title: "Role", status: "Approved", openings: 1, createdAt: "2026-01-01T00:00:00Z", priority: "15-30 days", raisedByEmail: "manager@example.com" } as Requisition;
const candidate = (stage: Candidate["stage"], extra: Partial<Candidate> = {}) => ({ id: "c1", reqId: "req1", name: "Candidate", email: "c@example.com", stage, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...extra } as Candidate);
const interview = (extra: Partial<Interview> = {}) => ({ id: "i1", candidateId: "c1", reqId: "req1", roundIndex: 1, status: "Completed", datetime: "2026-01-01T00:00:00Z", hasFeedback: true, ...extra } as Interview);
function render(c: Candidate, interviews: Interview[], request = req) {
  return renderToStaticMarkup(<PipelinePanel req={request} candidates={[c]} interviews={interviews} plan={null} org={null} role="Admin" apiFetch={async () => new Response()} onClose={() => {}} onRefresh={() => {}} onCand={() => {}} onCandAction={() => {}} onScheduleCandidate={() => {}} onRescheduleInterview={() => {}} />);
}
test("completed or rejected candidates do not show update feedback as a next action", () => {
  for (const stage of ["Rejected", "OfferApproved"] as const) assert.doesNotMatch(render(candidate(stage), [interview()]), /Update feedback|Request offer|Add feedback/);
});
test("debrief candidates can decide and open the requested status menu", () => {
  const html = render(candidate("Debrief"), [interview()]);
  assert.match(html, /Decide: select or reject/);
  assert.match(html, /Interview Backout/);
  assert.doesNotMatch(html, /Update feedback/);
});
test("scheduled interviews offer status updates alongside pending feedback", () => {
  const html = render(candidate("Interview Scheduled"), [interview({ status: "Scheduled", hasFeedback: false, feedbackPending: true })]);
  assert.match(html, /Add feedback/);
  assert.match(html, /Update feedback/);
  assert.doesNotMatch(html, /Interview Backout/);
});
test("a reschedule request exposes the rescheduling action instead of treating the interview as awaiting feedback", () => {
  const html = render(candidate("Interview Scheduled"), [interview({ status: "Reschedule Requested", hasFeedback: false, feedbackPending: false })]);
  assert.match(html, /Reschedule interview/);
  assert.doesNotMatch(html, /Add feedback/);
  assert.doesNotMatch(html, /Update feedback/);
  assert.match(html, /Interview Backout/);
});
test("a rescheduled interview shows feedback and the three requested actions", () => {
  const html = render(candidate("Interview Scheduled"), [interview({ status: "Rescheduled", hasFeedback: false, feedbackPending: false })]);
  assert.match(html, /Add feedback/);
  assert.match(html, /Candidate requested reschedule/);
  assert.match(html, /Interviewer requested reschedule/);
  assert.doesNotMatch(html, /Candidate backout/);
  assert.doesNotMatch(html, /Update feedback/);
});
test("the feedback form offers interview backout separately from saving feedback", () => {
  const html = renderToStaticMarkup(<CandidatePanel data={{ candidate: candidate("Interview Scheduled"), requisition: req, interviews: [interview({ status: "Rescheduled", hasFeedback: false })], feedback: [] }} role="Admin" mode="drawer" section="feedback" onClose={() => {}} apiFetch={async () => new Response()} onRefresh={() => {}} onOpenApplication={async () => {}} />);
  assert.match(html, /Save feedback/);
  assert.match(html, /Interview Backout/);
  assert.match(html, /Select a rating/);
  assert.doesNotMatch(html, /aria-checked="true"/);
});
test("department heads can read each interviewer's submitted feedback by round", () => {
  const rounds = [interview({ id: "i1", roundName: "Round 1 — Technical" }), interview({ id: "i2", roundIndex: 2, roundName: "Round 2 — Manager" })];
  const feedback = rounds.map((round, index) => ({ id: `f${index}`, candidateId: "c1", reqId: "req1", interviewId: round.id, interviewer: `interviewer${index}@example.com`, stage: "Interview", rating: 4, recommendation: "Yes", feedback: index ? "" : "Clear technical explanation", customAnswers: [{ question: "Communication", answer: index ? "Excellent" : "Good" }], createdAt: "2026-01-01T00:00:00Z", createdBy: "interviewer@example.com" }));
  const html = renderToStaticMarkup(<CandidatePanel data={{ candidate: candidate("Selected"), requisition: req, interviews: rounds, feedback }} role="DepartmentHead" onClose={() => {}} apiFetch={async () => new Response()} onRefresh={() => {}} onOpenApplication={async () => {}} />);
  for (const text of ["Round 1 — Technical", "Round 2 — Manager", "interviewer0@example.com", "interviewer1@example.com", "Clear technical explanation", "No interview notes provided.", "Communication", "Excellent"]) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /Save feedback|Finish the current round/);
  assert.doesNotMatch(html, /Activity &amp; comments/);
});
test("recruiters retain the activity and comments tab", () => {
  const html = renderToStaticMarkup(<CandidatePanel data={{ candidate: candidate("Selected"), requisition: req, interviews: [], feedback: [] }} role="Recruiter" onClose={() => {}} apiFetch={async () => new Response()} onRefresh={() => {}} onOpenApplication={async () => {}} />);
  assert.match(html, /Activity &amp; comments/);
});
test("an offer is offered only when all rounds and feedback are complete", () => {
  const ready = render(candidate("Selected", { lastAdvancedRound: 1 }), [interview()]);
  assert.match(ready, /Request offer/);
  assert.match(ready, /Candidate Backout/);
  assert.doesNotMatch(render(candidate("Selected", { lastAdvancedRound: 1 }), [interview({ hasFeedback: false })]), /Request offer/);
  assert.doesNotMatch(render(candidate("Selected", { lastAdvancedRound: 1, offerApprovalStatus: "Pending" }), [interview()]), /Request offer/);
});
test("on-hold requests do not offer recruiting actions", () => {
  assert.doesNotMatch(render(candidate("Debrief"), [interview()], { ...req, status: "On Hold" }), /Decide: select or reject|Update feedback/);
});
test("on-hold candidates can be selected or rejected when the request is open", () => {
  const html = render(candidate("On Hold"), [interview()]);
  assert.match(html, />Selected<\/button>/);
  assert.match(html, />Rejected<\/button>/);
  assert.doesNotMatch(html, /Update stage/);
  const locked = render(candidate("On Hold"), [interview({ hasFeedback: false })]);
  assert.match(locked, /disabled=""[^>]*>Selected<\/button>/);
  assert.doesNotMatch(render(candidate("On Hold"), [interview()], { ...req, status: "On Hold" }), />Rejected<\/button>/);
});
test("a full request only offers the approved candidate an offer backout action", () => {
  const approved = candidate("OfferApproved", { id: "approved", offerApprovalStatus: "Approved" });
  const other = candidate("Selected", { id: "other", lastAdvancedRound: 1 });
  const html = renderToStaticMarkup(<PipelinePanel req={{ ...req, status: "Position Fulfilled" }} candidates={[approved, other]} interviews={[]} plan={null} org={null} role="Admin" apiFetch={async () => new Response()} onClose={() => {}} onRefresh={() => {}} onCand={() => {}} onAddCandidate={() => {}} />);
  assert.match(html, /Candidate Offer Reject\/Backout/);
  assert.doesNotMatch(html, /Add candidate|Request offer/);
});
test("four openings remain usable until four approved offers, then reopen after backout", () => {
  const approved = [1, 2, 3, 4].map((number) => candidate("OfferApproved", { id: `approved${number}`, offerApprovalStatus: "Approved" }));
  const selected = candidate("Selected", { id: "c1", lastAdvancedRound: 1 });
  const make = (list: Candidate[]) => renderToStaticMarkup(<PipelinePanel req={{ ...req, openings: 4, status: "Partially Fulfilled" }} candidates={list} interviews={[interview()]} plan={null} org={null} role="Admin" apiFetch={async () => new Response()} onClose={() => {}} onRefresh={() => {}} onCand={() => {}} onAddCandidate={() => {}} onCandAction={() => {}} />);
  assert.match(make([...approved.slice(0, 3), selected]), /Request offer/);
  assert.doesNotMatch(make([...approved, selected]), /Request offer|Add candidate/);
  assert.match(make([{ ...approved[0], stage: "Candidate Backed Out" }, ...approved.slice(1), selected]), /Request offer/);
});
