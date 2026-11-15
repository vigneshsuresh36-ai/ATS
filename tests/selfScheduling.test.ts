import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewsConflict, newSchedulingToken, schedulingTokenHash, validSchedulingSlots } from "../src/lib/selfScheduling";
const base = { start: "2026-11-01T10:00:00Z", durationMinutes: 60, interviewerEmails: ["Panel@example.com"] };
test("interviewer conflicts include partial overlap and ignore case", () => {
  assert.equal(interviewsConflict(base, { ...base, start: "2026-11-01T10:30:00Z", interviewerEmails: ["panel@example.com"] }), true);
  assert.equal(interviewsConflict(base, { ...base, start: "2026-11-01T11:00:00Z" }), false);
  assert.equal(interviewsConflict(base, { ...base, interviewerEmails: ["other@example.com"] }), false);
  assert.equal(interviewsConflict(base, { ...base, start: "bad" }), true);
});
test("candidate links have random opaque tokens and stable stored hashes", () => {
  const a = newSchedulingToken(), b = newSchedulingToken();
  assert.notEqual(a, b); assert.equal(schedulingTokenHash(a), schedulingTokenHash(a)); assert.notEqual(schedulingTokenHash(a), a);
});
test("proposed slots must be unique future times and use a bounded duration", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(validSchedulingSlots([base.start], 60, now), true);
  assert.equal(validSchedulingSlots([base.start, base.start], 60, now), false);
  assert.equal(validSchedulingSlots([base.start], 0, now), false);
  assert.equal(validSchedulingSlots(["bad"], 60, now), false);
  assert.equal(validSchedulingSlots([base.start], 60, Date.parse("2026-11-02T00:00:00Z")), false);
});
