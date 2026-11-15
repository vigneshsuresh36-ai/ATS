import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { createRequire } from "node:module";

import { GET as readAuditReport } from "../src/app/api/status-audit/route";
import * as auditRoute from "../src/app/api/status-audit/route";
import { NextRequest } from "next/server";
import { updateRequisition } from "../src/lib/db/requisitions";
import { STATUS_AUDIT_COLLECTION, systemStatusAudit, type StatusAuditContext } from "../src/lib/statusAudit";
import type { AppUser, Requisition } from "../src/lib/types";

const loadModule = createRequire(__filename);
const firebase: typeof import("../src/lib/firebaseAdmin") = loadModule("../src/lib/firebaseAdmin");
const auth: typeof import("../src/lib/auth") = loadModule("../src/lib/auth");

const initial = { id: "REQ-1", status: "Approved", department: "Operations", recruiterEmail: "", openings: 2, priorityLevel: "P2" } as Requisition;
const manual: StatusAuditContext = {
  actor: { id: "user-1", name: "Recruiter", role: "Recruiter" },
  source: "Manual", reason: "Role paused by the hiring team", correlationId: "request-1",
};

function fakeDatabase(failAudit = false) {
  type Data = Record<string, unknown>;
  type Ref = { id: string; key: string };
  const stored = new Map<string, Data>([["requisitions/REQ-1", { ...initial }]]);
  let nextId = 0;
  let previous = Promise.resolve();
  const db = {
    collection: (collection: string) => ({
      doc: (id = String(++nextId)): Ref => ({ id, key: `${collection}/${id}` }),
    }),
    async runTransaction<T>(operation: (transaction: unknown) => Promise<T>) {
      const ready = previous;
      let finish!: () => void;
      previous = new Promise<void>((resolve) => { finish = resolve; });
      await ready;
      try {
        const working = new Map(stored);
        const result = await operation({
          get: async (ref: Ref) => ({ data: () => working.get(ref.key) }),
          set: (ref: Ref, data: Data) => working.set(ref.key, { ...working.get(ref.key), ...data }),
          create: (ref: Ref, data: Data) => {
            if (failAudit || working.has(ref.key)) throw new Error("Audit create failed");
            working.set(ref.key, data);
          },
        });
        stored.clear();
        for (const [key, value] of working) stored.set(key, value);
        return result;
      } finally {
        finish();
      }
    },
  };
  return {
    db: db as unknown as Firestore,
    status: () => stored.get("requisitions/REQ-1")?.status,
    audits: () => [...stored].filter(([key]) => key.startsWith(STATUS_AUDIT_COLLECTION + "/")).map(([, event]) => event),
  };
}

test("status and audit commit together with the trusted actor, previous value, and reason", async (context) => {
  const store = fakeDatabase();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  await updateRequisition(initial.id, { status: "On Hold" }, manual, initial);
  assert.equal(store.status(), "On Hold");
  const [audit] = store.audits();
  assert.equal(audit.previousValue, "Approved");
  assert.equal(audit.newValue, "On Hold");
  assert.deepEqual(audit.actor, manual.actor);
  assert.equal(audit.reason, manual.reason);
  assert.equal(audit.correlationId, manual.correlationId);
  assert.match(String(audit.changedAt), /Z$/);
});

test("missing audit context and a failed audit write roll back the status", async (context) => {
  const store = fakeDatabase(true);
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  await assert.rejects(updateRequisition(initial.id, { status: "On Hold" }), /audit context/);
  await assert.rejects(updateRequisition(initial.id, { status: "On Hold" }, manual, initial), /Audit create failed/);
  assert.equal(store.status(), "Approved");
  assert.deepEqual(store.audits(), []);
});

test("concurrent decisions reject the stale status and preserve the first audit event", async (context) => {
  const store = fakeDatabase();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  const results = await Promise.allSettled([
    updateRequisition(initial.id, { status: "On Hold" }, manual, initial),
    updateRequisition(initial.id, { status: "Position Closed" }, manual, initial),
  ]);
  assert.deepEqual(results.map(({ status }) => status), ["fulfilled", "rejected"]);
  assert.equal(store.status(), "On Hold");
  assert.equal(store.audits().length, 1);
});

test("system changes record the trigger and no-op updates create no history", async (context) => {
  const store = fakeDatabase();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  const trigger = systemStatusAudit("Offer reserved one opening", manual);
  await updateRequisition(initial.id, { status: "Partially Fulfilled" }, trigger, initial);
  await updateRequisition(initial.id, { status: "Partially Fulfilled" }, trigger);
  const [event] = store.audits();
  assert.equal(store.audits().length, 1);
  assert.equal(event.source, "System");
  assert.equal(event.reason, trigger.reason);
  assert.equal(event.correlationId, manual.correlationId);
});

test("audit report rejects recruiters and exposes no mutation handlers for any role", async (context) => {
  context.mock.method(auth, "requireUser", async () => ({ role: "Recruiter" }) as AppUser);
  const result = await readAuditReport(new NextRequest("http://localhost/api/status-audit"));
  assert.equal(result.status, 403);
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal(method in auditRoute, false);
});

test("recruiter ownership history keeps assignment, reassignment, and removal", async (context) => {
  const store = fakeDatabase();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  const assigned = await updateRequisition(initial.id, { recruiterEmail: "first@example.com" }, manual, initial);
  assert.ok(assigned);
  await assert.rejects(updateRequisition(initial.id, { recruiterEmail: "second@example.com" }), /audit context/);
  const reassigned = await updateRequisition(initial.id, { recruiterEmail: "second@example.com" }, manual, assigned);
  assert.ok(reassigned);
  await assert.rejects(updateRequisition(initial.id, { recruiterEmail: "third@example.com" }, manual, assigned), /requisition changed/);
  await updateRequisition(initial.id, { recruiterEmail: "" }, manual, reassigned);
  await updateRequisition(initial.id, { recruiterEmail: "" });
  assert.deepEqual(store.audits().map((event) => [event.field, event.previousValue, event.newValue]), [
    ["recruiterEmail", null, "first@example.com"],
    ["recruiterEmail", "first@example.com", "second@example.com"],
    ["recruiterEmail", "second@example.com", null],
  ]);
});

test("recruiter collaborators gain access and their removal is recorded atomically", async (context) => {
  const { isAssignedRecruiter } = await import("../src/lib/recruiterAssignment");
  const store = fakeDatabase();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  const assigned = await updateRequisition(initial.id, { recruiterEmail: "primary@example.com", recruiterCollaboratorEmails: [" SECOND@example.com "] }, manual, initial);
  assert.ok(assigned);
  assert.equal(isAssignedRecruiter(assigned, "primary@example.com"), true);
  assert.equal(isAssignedRecruiter(assigned, "second@example.com"), true);
  await assert.rejects(updateRequisition(initial.id, { recruiterCollaboratorEmails: [] }), /audit context/);
  const removed = await updateRequisition(initial.id, { recruiterCollaboratorEmails: [] }, manual, assigned);
  assert.ok(removed);
  assert.equal(isAssignedRecruiter(removed, "second@example.com"), false);
  assert.deepEqual(store.audits().filter((event) => event.field === "recruiterCollaboratorEmails").map((event) => [event.previousValue, event.newValue]), [
    [null, "second@example.com"], ["second@example.com", null],
  ]);
});
