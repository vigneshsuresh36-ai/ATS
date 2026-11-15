import { test } from "node:test";
import { strict as assert } from "node:assert";
import { referralEmail } from "../src/lib/referrerIdentity";

test("referrals resolve saved employee identity, legacy employee codes and email links", () => {
  const users = [{ email: "person@example.com", employeeCode: "LT992" }];
  assert.equal(referralEmail({ sourceDetail: "lt992" }, users), "person@example.com");
  assert.equal(referralEmail({ sourceDetail: "old-code", referrerEmail: "person@example.com" }, users), "person@example.com");
  assert.equal(referralEmail({ sourceDetail: "PERSON@example.com" }, users), "person@example.com");
  assert.equal(referralEmail({ sourceDetail: "unknown-code" }, users), undefined);
});
