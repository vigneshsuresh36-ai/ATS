import { test } from "node:test";
import assert from "node:assert/strict";
import { initialAdministrator } from "../src/lib/initialAdministrator";
test("each installation requires its own configured administrator", () => {
  assert.throws(() => initialAdministrator(undefined, undefined, "2026-01-01"), /BOOTSTRAP_ADMIN_EMAIL/);
  assert.throws(() => initialAdministrator("invalid", undefined, "2026-01-01"), /BOOTSTRAP_ADMIN_EMAIL/);
  const admin = initialAdministrator(" Owner@Customer.example ", "Customer Admin", "2026-01-01");
  assert.equal(admin.email, "owner@customer.example");
  assert.equal(admin.name, "Customer Admin");
  assert.equal(admin.role, "Admin");
});
