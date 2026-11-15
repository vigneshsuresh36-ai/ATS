import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCvComparison } from "../src/lib/cvComparison";

test("only verified quotations count toward the requirements coverage", () => {
  const result = verifyCvComparison({ requirements: ["Build accessible interfaces", "Lead user research"], evidence: ["Built accessible interfaces", "invented research experience"] }, "Build accessible interfaces. Lead user research.", "Built accessible interfaces for a product.");
  assert.equal(result?.score, 50);
  assert.deepEqual(result?.items.map((item) => item.found), [true, false]);
});

test("unverified, protected and duplicate requirements cannot inflate the score", () => {
  const result = verifyCvComparison({ requirements: ["Gender: female", "Design systems", "Design systems", "Made up requirement"], evidence: ["female", "Design systems", "Design systems", "Made up"] }, "Gender: female. Design systems.", "Design systems experience.");
  assert.equal(result?.score, 100);
  assert.equal(result?.items.length, 1);
  assert.equal(result?.items[0].requirement, "Design systems");
});

test("returns no score when no requirements can be verified", () => {
  assert.equal(verifyCvComparison({ requirements: ["Fabricated requirement"], evidence: ["text"] }, "Different job description", "text"), null);
});
