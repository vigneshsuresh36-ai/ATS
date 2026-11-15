import { test } from "node:test";
import assert from "node:assert/strict";
import { canListOnCareersPage } from "../src/lib/careers";
import type { Requisition } from "../src/lib/types";
const role = { id: "R1", status: "Approved", recruiterEmail: "recruiter@example.com", careersPublished: true } as Requisition;
test("careers page requires explicit listing, an open status, and an assigned recruiter", () => {
  assert.equal(canListOnCareersPage(role), true);
  assert.equal(canListOnCareersPage({ ...role, careersPublished: false }), false);
  assert.equal(canListOnCareersPage({ ...role, careersPublished: undefined }), false);
  assert.equal(canListOnCareersPage({ ...role, recruiterEmail: "" }), false);
  for (const status of ["On Hold", "PendingApproval", "Rejected", "Position Closed", "Position Fulfilled"] as const) assert.equal(canListOnCareersPage({ ...role, status }), false);
});
