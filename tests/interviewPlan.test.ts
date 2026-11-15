import { test } from "node:test";
import assert from "node:assert/strict";
import { getInterviewRounds } from "../src/lib/interviewPlan";

test("applicable interview rounds preserve their numbers and legacy defaults", () => {
  assert.deepEqual(getInterviewRounds(null).map((round) => round.order), [1]);
  const rounds = [{ name: "Final", order: 3 }, { name: "Screen", order: 1, applicable: false }, { name: "Technical", order: 2, applicable: true }];
  const plan = { reqId: "REQ-1", rounds, updatedAt: "", updatedBy: "" };
  assert.deepEqual(getInterviewRounds(plan).map((round) => round.order), [2, 3]);
  assert.deepEqual(rounds.map((round) => round.order), [3, 1, 2]);
});
