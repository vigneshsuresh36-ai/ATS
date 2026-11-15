import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCandidateMigrationGroups } from "../src/lib/candidateMigration";

test("migration groups exact normalized email and phone matches without using names", () => {
  const plan = buildCandidateMigrationGroups([
    { id: "legacy-1", name: "Same Name", email: " PERSON@example.com ", phone: "+1 (222) 555-0100" },
    { id: "legacy-2", name: "Different Name", email: "person@example.com", phone: "12225550100" },
    { id: "legacy-3", name: "Same Name" },
  ]);
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.groups.find((group) => group.records.length === 2)?.records.length, 2);
  assert.equal(plan.potentialDuplicatePairs.length, 0);
});

test("migration reports one-contact conflicts for review and never groups by name alone", () => {
  const plan = buildCandidateMigrationGroups([
    { id: "legacy-1", name: "Alex Smith", email: "alex@example.com", phone: "1112223333" },
    { id: "legacy-2", name: "Alex Smith", email: "alex@example.com", phone: "9998887777" },
    { id: "legacy-3", name: "Alex Smith", email: "other@example.com", phone: "4445556666" },
  ]);
  assert.equal(plan.groups.length, 3);
  assert.equal(plan.potentialDuplicatePairs.length, 1);
});