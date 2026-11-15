import { test } from "node:test";
import assert from "node:assert/strict";
import { isFreeInterval } from "../src/lib/calendarAvailability";
const slot = { start: "2026-11-01T10:00:00Z", end: "2026-11-01T11:00:00Z" };
test("availability excludes overlaps and fails closed on invalid busy periods", () => {
  assert.equal(isFreeInterval(slot, []), true);
  assert.equal(isFreeInterval(slot, [{ start: "2026-11-01T10:30:00Z", end: "2026-11-01T11:30:00Z" }]), false);
  assert.equal(isFreeInterval(slot, [{ start: "2026-11-01T11:00:00Z", end: "2026-11-01T12:00:00Z" }]), true);
  assert.equal(isFreeInterval(slot, [{ start: "invalid", end: "invalid" }]), false);
});
