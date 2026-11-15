import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationSourceForLink } from "../src/lib/applicationSource";
test("public application source follows the issuing link rather than candidate input", () => {
  assert.equal(applicationSourceForLink("career"), "Career Page");
  assert.equal(applicationSourceForLink("employee-referral"), "Employee Referral");
  assert.equal(applicationSourceForLink("social"), "Social CV");
  assert.equal(applicationSourceForLink(undefined), "Social CV");
});
