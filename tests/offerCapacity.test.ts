import { test } from "node:test";
import assert from "node:assert/strict";
import { remainingOfferOpenings } from "../src/lib/offerCapacity";
import type { Candidate } from "../src/lib/types";

const candidate = (stage: Candidate["stage"], offerApprovalStatus?: Candidate["offerApprovalStatus"]) => ({ stage, offerApprovalStatus });
test("pending requests do not occupy an opening but approved offers do", () => {
  assert.equal(remainingOfferOpenings(1, [candidate("OfferApprovalPending", "Pending"), candidate("Selected")]), 1);
  assert.equal(remainingOfferOpenings(1, [candidate("OfferApproved", "Approved"), candidate("Selected")]), 0);
});
test("backout releases exactly one opening without counting the historical approval", () => {
  const active = [candidate("OfferApproved", "Approved"), candidate("Offered", "Approved"), candidate("OfferApproved", "Approved"), candidate("OfferApproved", "Approved")];
  assert.equal(remainingOfferOpenings(4, active), 0);
  active[0] = candidate("Candidate Backed Out", "Approved");
  assert.equal(remainingOfferOpenings(4, active), 1);
});
