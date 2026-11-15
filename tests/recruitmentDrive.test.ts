import assert from "node:assert/strict";
import { test } from "node:test";
import { planDrive } from "../src/lib/recruitmentDrive";

const start = Date.parse("2026-11-16T04:30:00Z");
const minute = 60_000;
const panel = { interviewers: ["panel@example.com"], room: "Room A" };
const candidates = [20, 30, 15].map((duration, index) => ({ id: String(index), duration }));

test("a drive runs independent panels in parallel and respects individual duration and breaks", () => {
  const { slots, unplaced } = planDrive({
    start, end: start + 60 * minute, breakMinutes: 10, candidates, existing: [],
    panels: [panel, { interviewers: ["other@example.com"], room: "Room B" }],
  });
  assert.deepEqual(slots.map((slot) => (Date.parse(slot.datetime) - start) / minute), [0, 0, 30]);
  assert.deepEqual(unplaced, []);
});

test("shared interviewers or rooms prevent simultaneous drive bookings", () => {
  for (const second of [ { ...panel, room: "Room B" }, { ...panel, interviewers: ["other@example.com"] } ]) {
    const { slots, unplaced } = planDrive({
      start, end: start + 60 * minute, breakMinutes: 10, candidates, existing: [],
      office: "Head office", panels: [panel, second],
    });
    assert.equal(slots.length, 2);
    assert.equal(Date.parse(slots[1].datetime), start + 30 * minute);
    assert.deepEqual(unplaced, ["2"]);
  }
});

