import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateContactIndexId,
  formatApplicationId,
  formatCandidateId,
  nextUnreservedIdentity,
  normalizeCandidateEmail,
  normalizeCandidatePhone,
} from "../src/lib/candidateIdentity";

test("formats stable candidate and application numbers", () => {
  assert.equal(formatCandidateId(1), "CAN-000001");
  assert.equal(formatCandidateId(42), "CAN-000042");
  assert.equal(formatApplicationId(1), "APP-000001");
  assert.equal(formatApplicationId(42), "APP-000042");
});

test("allocates the next unreserved candidate and application identities", async () => {
  const reserved = new Set(["CAN-000001", "CAN-000002", "APP-000001"]);
  const candidate = await nextUnreservedIdentity(1, formatCandidateId, async (id) => reserved.has(id));
  const application = await nextUnreservedIdentity(1, formatApplicationId, async (id) => reserved.has(id));

  assert.deepEqual(candidate, { sequence: 3, id: "CAN-000003" });
  assert.deepEqual(application, { sequence: 2, id: "APP-000002" });
});

test("normalizes email and phone before identity matching", () => {
  assert.equal(normalizeCandidateEmail("  PERSON+ATS@Example.COM "), "person+ats@example.com");
  assert.equal(normalizeCandidatePhone("+91 (98765) 43210"), "919876543210");
  assert.equal(normalizeCandidateEmail(undefined), "");
  assert.equal(normalizeCandidatePhone(undefined), "");
});

test("contact index document IDs do not expose raw contact details", () => {
  const indexId = candidateContactIndexId("email", "person@example.com");
  assert.match(indexId, /^email_[a-f0-9]{64}$/);
  assert.equal(indexId.includes("person@example.com"), false);
});