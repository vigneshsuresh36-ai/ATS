import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewScopedRequisition, coversRequisitionScope, parseAccessScopes, requiresSubDepartment } from "../src/lib/requisitionScope";
import { requisitionApproverRecipients } from "../src/lib/requisitionNotificationRecipients";
import type { AppUser, OrgSettings } from "../src/lib/types";

const collections = { businessUnit: "Unit A", department: "Finance", subDepartment: "Collections" };
const payments = { ...collections, subDepartment: "Payments" };
const request = { department: "Finance", lob: "Unit A", subDepartment: "Collections", accessScoped: true, raisedByEmail: "hm@example.test" };
const head = { role: "DepartmentHead", active: true, email: "head1@example.test", departments: ["Finance"], accessScopes: [collections] } as AppUser;
const second = { ...head, email: "head2@example.test", accessScopes: [payments] };
const legacy = { ...head, email: "legacy@example.test", accessScopes: undefined };

test("a Finance head can approve their own team within the granted business unit", () => {
  assert.equal(canViewScopedRequisition(head, request), true);
  assert.equal(canViewScopedRequisition(second, request), false);
  assert.equal(canViewScopedRequisition(head, { ...request, lob: "Unit B" }), false);
  assert.deepEqual(requisitionApproverRecipients([head, second, legacy], request), [head.email]);
  assert.deepEqual(requisitionApproverRecipients([head, second, legacy], { ...request, subDepartment: "Payments" }), [second.email]);
  assert.equal(coversRequisitionScope(legacy, request), false);
  assert.equal(coversRequisitionScope(legacy, { ...request, accessScoped: undefined }), true);
});

test("hiring manager visibility requires both ownership and an assigned combination", () => {
  const manager: AppUser = { ...head, role: "HiringManager", email: request.raisedByEmail };
  assert.equal(canViewScopedRequisition(manager, request), true);
  assert.equal(canViewScopedRequisition(manager, { ...request, raisedByEmail: "other@example.test" }), false);
  assert.equal(canViewScopedRequisition(manager, { ...request, subDepartment: "Payments" }), false);
});

test("scope grants deduplicate and enforce configured business unit and department links", () => {
  const org = {
    businessUnits: ["Unit A", "Unit B"],
    departmentBusinessUnits: [{ businessUnit: "Unit A", department: "Finance" }],
    subDepartments: [{ department: "Finance", name: "Collections" }, { department: "Finance", name: "Payments" }],
  } as OrgSettings;
  assert.deepEqual(parseAccessScopes([collections, collections, payments], org), [collections, payments]);
  assert.deepEqual(parseAccessScopes([collections, { businessUnit: "Unit A", department: "Finance" }], org), [{ businessUnit: "Unit A", department: "Finance" }]);
  assert.equal(parseAccessScopes([{ ...collections, businessUnit: "Unit B" }], org), null);
  assert.equal(parseAccessScopes([{ ...collections, subDepartment: "Other" }], org), null);
  assert.equal(requiresSubDepartment("Finance", org), true);
});
