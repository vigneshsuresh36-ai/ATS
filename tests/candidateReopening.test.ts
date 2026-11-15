import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { reopenCandidateApplication } from "../src/lib/db/candidates";
import type { Candidate } from "../src/lib/types";

const firebase: typeof import("../src/lib/firebaseAdmin") = createRequire(__filename)("../src/lib/firebaseAdmin");
const previous: Candidate = {
  id: "application-1", applicationId: "APP-000001", profileId: "profile-1", candidateId: "CAN-000001",
  reqId: "REQ-1", name: "Candidate", email: "", phone: "", location: "", stage: "Rejected",
  archived: false, createdAt: "2026-10-01", updatedAt: "2026-10-02",
  offerApprovalStatus: "Rejected", offerRejectReason: "Previous decision", lastAdvancedRound: 2,
};

function database(failEvent = false) {
  type Data = Record<string, unknown>;
  type Ref = { id: string; key: string };
  let stored = new Map<string, Data>([
    ["candidates/application-1", { ...previous }],
    ["candidate_profiles/profile-1", { id: previous.profileId, candidateId: previous.candidateId, name: previous.name, email: "", phone: "", location: "" }],
    ["application_id_registry/APP-000001", { applicationRecordId: previous.id }],
    ["requisitions/REQ-1", { status: "Approved" }],
    ["stage_events/rejected", { candidateId: previous.id, toStage: "Rejected" }],
    ["interviews/old", { candidateId: previous.id, status: "Completed" }],
    ["candidate_applications/application-1_REQ-1", { source: "Consultant", consultantId: "vendor-1" }],
  ]);
  let queue = Promise.resolve();
  return {
    get records() { return stored; },
    db: {
      collection: (collection: string) => ({ doc: (id: string): Ref => ({ id, key: collection + "/" + id }) }),
      async runTransaction<T>(run: (tx: unknown) => Promise<T>) {
        const ready = queue;
        let done!: () => void;
        queue = new Promise<void>(resolve => { done = resolve; });
        await ready;
        try {
          const next = new Map(stored);
          let writing = false;
          const result = await run({
            get: async (ref: Ref) => {
              assert.equal(writing, false, "Firestore requires reads before writes");
              const data = next.get(ref.key);
              return { exists: !!data, data: () => data };
            },
            create: (ref: Ref, value: Data) => {
              writing = true;
              if (failEvent && ref.key.startsWith("stage_events/reopen-")) throw new Error("Event could not be saved");
              assert.ok(!next.has(ref.key));
              next.set(ref.key, value);
            },
            set: (ref: Ref, value: Data) => { writing = true; next.set(ref.key, { ...next.get(ref.key), ...value }); },
          });
          stored = next;
          return result;
        } finally { done(); }
      },
    } as unknown as Firestore,
  };
}

test("reopening preserves the prior application and records one new application and event across retries", async context => {
  const store = database();
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  const [first, retry] = await Promise.all([
    reopenCandidateApplication(previous, "recruiter@example.test"),
    reopenCandidateApplication(previous, "recruiter@example.test"),
  ]);
  assert.deepEqual(first, retry);
  assert.notEqual(first.id, previous.id);
  assert.notEqual(first.applicationId, previous.applicationId);
  assert.equal(first.candidateId, previous.candidateId);
  assert.equal(first.previousApplicationRecordId, previous.id);
  assert.equal(first.stage, "PendingHMApproval");
  assert.equal(first.lastAdvancedRound, undefined);
  assert.equal(first.offerApprovalStatus, undefined);
  assert.deepEqual(store.records.get("candidates/application-1"), previous);
  assert.equal(store.records.get("interviews/old")?.candidateId, previous.id);
  assert.equal(store.records.get("stage_events/rejected")?.toStage, "Rejected");
  const event = store.records.get("stage_events/reopen-application-1");
  assert.equal(event?.candidateId, first.id);
  assert.equal(store.records.get("candidate_applications/" + first.id + "_REQ-1")?.consultantId, "vendor-1");
  assert.equal(event?.byEmail, "recruiter@example.test");
  assert.equal([...store.records.keys()].filter(key => key.startsWith("candidates/")).length, 2);
});

test("a failed reopening event rolls back the new application", async context => {
  const store = database(true);
  context.mock.method(firebase, "requireAdminDb", () => store.db);
  await assert.rejects(reopenCandidateApplication(previous, "recruiter@example.test"), /Event could not be saved/);
  assert.deepEqual(store.records.get("candidates/application-1"), previous);
  assert.equal([...store.records.keys()].filter(key => key.startsWith("candidates/")).length, 1);
});
