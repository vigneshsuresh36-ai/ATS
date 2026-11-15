import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticatedFetch } from "../src/lib/authenticatedFetch";

test("authenticated reads refresh and retry once after a rejected session", async () => {
  const calls: string[] = [];
  const user = { getIdToken: async (force?: boolean) => force ? "renewed" : "cached" };
  const fetcher: typeof fetch = async (_input, init) => { calls.push(new Headers(init?.headers).get("Authorization") || ""); return new Response("", { status: calls.length === 1 ? 401 : 200 }); };
  const result = await authenticatedFetch("/api/automations", undefined, user, null, null, fetcher);
  assert.equal(result.status, 200); assert.deepEqual(calls, ["Bearer cached", "Bearer renewed"]);
});
test("mutating requests are never retried after an authentication failure", async () => {
  let calls = 0, refreshes = 0;
  const user = { getIdToken: async (force?: boolean) => { if (force) refreshes++; return "token"; } };
  const fetcher: typeof fetch = async () => { calls++; return new Response("", { status: 401 }); };
  const response = await authenticatedFetch("/api/automations", { method: "POST", body: "{}" }, user, null, null, fetcher);
  assert.equal(response.status, 401); assert.equal(calls, 1); assert.equal(refreshes, 0);
});
test("requests preserve custom headers and selected acting identity", async () => {
  let headers = new Headers();
  const fetcher: typeof fetch = async (_input, init) => { headers = new Headers(init?.headers); return new Response("", { status: 200 }); };
  await authenticatedFetch("/api/me", { headers: { "X-Test": "value" } }, null, "token", "member@example.com", fetcher);
  assert.equal(headers.get("X-Test"), "value"); assert.equal(headers.get("X-ATS-Act-As"), "member@example.com"); assert.equal(headers.get("Authorization"), "Bearer token");
});
