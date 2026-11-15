import { test } from "node:test";
import assert from "node:assert/strict";
import { hiringProcessStep } from "../src/lib/hiringProcess";

test("pending offer remains at offer approval even when the requisition is closed", () => {
  assert.equal(hiringProcessStep("Closed", ["PendingHMApproval", "OfferApprovalPending"], true), 5);
});

test("a hired candidate reaches the final step", () => {
  assert.equal(hiringProcessStep("Position Fulfilled", ["OfferApprovalPending", "Onboarded"], true), 6);
});
