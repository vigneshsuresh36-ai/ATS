import { test } from "node:test";
import assert from "node:assert/strict";
import { joiningCountdownLabel, joiningTimeline } from "../src/lib/joiningTimeline";

const request = { priority: "15–90 days", approvedAt: "2026-11-01T12:00:00Z", status: "Approved" as const };
const at = (date: string) => joiningTimeline(request, Date.parse(date));

test("fulfillment cutoff uses the maximum joining days from the approval date", () => {
  const target = at("2027-01-20T06:00:00Z");
  assert.equal(target?.approvalDate, "2026-11-01");
  assert.equal(target?.deadline, "2027-01-30");
  assert.equal(target?.remainingDays, 10);
  assert.equal(target?.status, "on-track");
  assert.equal(joiningCountdownLabel(10), "10 days left");
  assert.equal(at("2027-01-23T06:00:00Z")?.status, "approaching");
  assert.equal(at("2027-02-03T06:00:00Z")?.remainingDays, -4);
  assert.equal(joiningCountdownLabel(-4), "4 days overdue (−4)");
});

test("the cutoff stays due until midnight in India", () => {
  assert.equal(at("2027-01-30T18:29:59.999Z")?.remainingDays, 0);
  assert.equal(joiningCountdownLabel(0), "Due today");
  const overdue = at("2027-01-30T18:30:00.000Z");
  assert.equal(overdue?.remainingDays, -1);
  assert.equal(overdue?.status, "overdue");
  assert.equal(joiningCountdownLabel(-1), "1 day overdue (−1)");
});

test("approval dates crossing UTC midnight use the Indian calendar date", () => {
  const target = joiningTimeline({ ...request, approvedAt: "2026-10-31T18:30:00Z" }, Date.parse("2027-01-20T06:00:00Z"));
  assert.equal(target?.approvalDate, "2026-11-01");
  assert.equal(target?.deadline, "2027-01-30");
});

test("missing approval, invalid targets and inactive requisitions do not show a countdown", () => {
  assert.equal(joiningTimeline({ ...request, approvedAt: undefined }), null);
  assert.equal(joiningTimeline({ ...request, priority: "urgent" }), null);
  assert.equal(joiningTimeline({ ...request, priority: "30-15 days" }), null);
  assert.equal(joiningTimeline({ ...request, status: "Position Fulfilled" }), null);
});
