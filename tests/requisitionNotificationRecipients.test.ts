import { test } from "node:test";
import assert from "node:assert/strict";
import { requisitionApproverRecipients, requisitionDecisionRecipients } from "../src/lib/requisitionNotificationRecipients";
import type { AppUser } from "../src/lib/types";

const users = [
  { email: "admin@example.com", role: "Admin", active: true, departments: [] },
  { email: "head-tech@example.com", role: "DepartmentHead", active: true, departments: ["Technology"] },
  { email: "head-sales@example.com", role: "DepartmentHead", active: true, departments: ["Sales"] },
  { email: "inactive@example.com", role: "DepartmentHead", active: false, departments: ["Technology"] },
  { email: "requester@example.com", role: "HiringManager", active: true, departments: ["Technology"] },
] as AppUser[];

test("submission recipients are only active admins and matching department heads", () => {
  assert.deepEqual(requisitionApproverRecipients(users, "technology", "ADMIN@example.com"), ["head-tech@example.com"]);
  assert.deepEqual(requisitionApproverRecipients(users, "Sales"), ["admin@example.com", "head-sales@example.com"]);
});

test("decision recipients include the active requester and approvers, but exclude the actor", () => {
  assert.deepEqual(
    requisitionDecisionRecipients(users, "Technology", "REQUESTER@example.com", "head-tech@example.com"),
    ["requester@example.com", "admin@example.com"]
  );
  assert.deepEqual(
    requisitionDecisionRecipients(users, "Technology", "requester@example.com", "admin@example.com"),
    ["requester@example.com", "head-tech@example.com"]
  );
});