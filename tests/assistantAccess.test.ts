import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantRequisitions, canIncludePendingOffer } from "../src/lib/assistantAccess";
import type { AppUser, Candidate, Requisition } from "../src/lib/types";
const user = { email: "person@example.com", departments: ["Technology"], active: true } as AppUser;
const reqs = [
  { id: "own", department: "Technology", raisedByEmail: "person@example.com", recruiterEmail: "person@example.com" },
  { id: "department", department: "technology", raisedByEmail: "other@example.com", recruiterEmail: "other@example.com" },
  { id: "other", department: "Sales", raisedByEmail: "other@example.com", recruiterEmail: "other@example.com" },
] as Requisition[];
test("assistant scope respects each role and empty departments", () => {
  assert.deepEqual(assistantRequisitions({ ...user, role: "HiringManager" }, reqs, []).map((r) => r.id), ["own"]);
  assert.deepEqual(assistantRequisitions({ ...user, role: "DepartmentHead" }, reqs, []).map((r) => r.id), ["own", "department"]);
  assert.deepEqual(assistantRequisitions({ ...user, role: "DepartmentHead", departments: [] }, reqs, []), []);
  assert.deepEqual(assistantRequisitions({ ...user, role: "Recruiter" }, reqs, []).map((r) => r.id), ["own"]);
  assert.deepEqual(assistantRequisitions({ ...user, role: "Employee" }, reqs, []), []);
});
test("pending offer details respect the requester's role", () => {
  const candidate = { offerApprovalStatus: "Pending", offerRequestedBy: "other@example.com" } as Candidate;
  assert.equal(canIncludePendingOffer({ ...user, role: "Recruiter" }, candidate), false);
  assert.equal(canIncludePendingOffer({ ...user, role: "Recruiter" }, { ...candidate, offerRequestedBy: user.email }), true);
  assert.equal(canIncludePendingOffer({ ...user, role: "DepartmentHead" }, candidate), true);
  assert.equal(canIncludePendingOffer({ ...user, role: "Employee" }, candidate), false);
  assert.equal(canIncludePendingOffer({ ...user, role: "DepartmentHead" }, { ...candidate, offerApprovalStatus: "Approved" }), false);
});
