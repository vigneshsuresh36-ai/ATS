import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntegrationRequest } from "../src/lib/integrationRequests";
test("integration requests accept only supported services and boolean request states", () => {
  for (const provider of ["whatsapp", "naukri", "linkedin"]) assert.deepEqual(parseIntegrationRequest({ provider, requested: true }), { provider, requested: true });
  assert.equal(parseIntegrationRequest({ provider: "other", requested: true }), null);
  assert.equal(parseIntegrationRequest({ provider: "whatsapp", requested: "true" }), null);
  assert.equal(parseIntegrationRequest(null), null);
});
