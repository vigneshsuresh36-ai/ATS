import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { Firestore } from "firebase-admin/firestore";
import { createPlacementFeeForJoinedCandidate, createVendorSpendRecord, updateVendorSpendRecord } from "../src/lib/db/vendorsSpend";
import type { Candidate, Requisition } from "../src/lib/types";

const loadModule = createRequire(__filename);
const firebase: typeof import("../src/lib/firebaseAdmin") = loadModule("../src/lib/firebaseAdmin");

function candidate(id: string, profileId?: string, email?: string): Candidate {
  return { id, reqId: "REQ-1", name: "Applicant", profileId, email, phone: "", actualJoiningDate: "2026-11-12", offeredFixedCtc: 900000 } as unknown as Candidate;
}
const requisition = { id: "REQ-1", title: "Manager", department: "Operations" } as Requisition;
const consultantId = "VENDOR-1";

function fakeDatabase(records: Candidate[], merged: Record<string, string> = {}) {
  type Data = Record<string, unknown>;
  type Ref = { key: string; id: string };
  type Query = { collection: string; filter?: [string, unknown] };
  const initial: Record<string, Data> = {
    ["recruitment_consultants/" + consultantId]: { name: "Vendor", defaultFee: 30000, feeType: "Fixed Amount Per Hire", replacementGuaranteeDays: 90 },
  };
  for (const record of records) {
    initial["candidates/" + record.id] = { ...record };
    initial[`candidate_applications/${record.id}_${record.reqId}`] = { consultantId };
  }
  for (const [id, target] of Object.entries(merged)) initial["candidate_profiles/" + id] = { mergedIntoProfileId: target };
  let stored = new Map(Object.entries(initial));
  let previous = Promise.resolve();

  function read(map: Map<string, Data>, target: Ref | Query) {
    if ("key" in target) {
      const value = map.get(target.key);
      return { exists: value !== undefined, id: target.id, data: () => value, get: (field: string) => value?.[field] };
    }
    const prefix = target.collection + "/";
    return {
      docs: [...map].filter(([key, data]) => key.startsWith(prefix) && (!target.filter || data[target.filter[0]] === target.filter[1]))
        .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data, get: (field: string) => data[field] })),
    };
  }

  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => {
        const ref = { id, key: `${collection}/${id}` };
        return { ...ref, get: async () => read(stored, ref) };
      },
      where: (field: string, _operator: string, value: unknown): Query => ({ collection, filter: [field, value] }),
      get: async () => read(stored, { collection }),
    }),
    async runTransaction<T>(operation: (transaction: unknown) => Promise<T>) {
      const ready = previous;
      let finish!: () => void;
      previous = new Promise<void>((resolve) => { finish = resolve; });
      await ready;
      try {
        const working = new Map(stored);
        let writesStarted = false;
        const value = await operation({
          get: async (ref: Ref | Query) => {
            if (writesStarted) throw new Error("Transaction read after a write");
            return read(working, ref);
          },
          create: (ref: Ref, data: Data) => {
            writesStarted = true;
            if (working.has(ref.key)) throw new Error("Document already exists");
            working.set(ref.key, data);
          },
          set: (ref: Ref, data: Data) => {
            writesStarted = true;
            working.set(ref.key, { ...working.get(ref.key), ...data });
          },
        });
        stored = working;
        return value;
      } finally {
        finish();
      }
    },
  };
  return {
    db: db as unknown as Firestore,
    records: (name: string) => [...stored].filter(([key]) => key.startsWith(name + "/")).map(([, data]) => data),
  };
}

test("concurrent joins on the same candidate profile create one fee and guarantee", async (context) => {
  const first = candidate("application-1", "profile-1");
  const second = candidate("application-2", "profile-1");
  const database = fakeDatabase([first, second]);
  context.mock.method(firebase, "requireAdminDb", () => database.db);

  const results = await Promise.all([
    createPlacementFeeForJoinedCandidate(first, requisition, "admin"),
    createPlacementFeeForJoinedCandidate(second, requisition, "admin"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(database.records("placement_fees").length, 1);
  assert.equal(database.records("replacement_guarantees").length, 1);
});

test("merged aliases and matching legacy email share the existing fee", async (context) => {
  const first = candidate("application-1", "old-profile", "person@example.com");
  const merged = candidate("application-2", "new-profile", "updated@example.com");
  const legacy = candidate("application-3", undefined, "PERSON@example.com");
  const database = fakeDatabase([first, merged, legacy], { "old-profile": "new-profile" });
  context.mock.method(firebase, "requireAdminDb", () => database.db);

  const fee = await createPlacementFeeForJoinedCandidate(first, requisition, "admin");
  assert.ok(fee);
  assert.equal(await createPlacementFeeForJoinedCandidate(merged, requisition, "admin"), null);
  await assert.rejects(createVendorSpendRecord("placementFees", "PLF", { candidateId: legacy.id, requisitionId: requisition.id, consultantId }), /active placement fee already exists/);
  assert.equal(database.records("placement_fees").length, 1);
});

test("separate requisitions can each have a fee for the same profile", async (context) => {
  const first = candidate("application-1", "profile-1");
  const second = { ...candidate("application-2", "profile-1"), reqId: "REQ-2" };
  const database = fakeDatabase([first, second]);
  context.mock.method(firebase, "requireAdminDb", () => database.db);

  assert.ok(await createPlacementFeeForJoinedCandidate(first, requisition, "admin"));
  assert.ok(await createPlacementFeeForJoinedCandidate(second, { ...requisition, id: "REQ-2" }, "admin"));
  assert.equal(database.records("placement_fees").length, 2);
});

test("a cancelled fee cannot be reactivated beside another fee for the same hire", async (context) => {
  const first = candidate("application-1", "profile-1");
  const second = candidate("application-2", "profile-1");
  const database = fakeDatabase([first, second]);
  context.mock.method(firebase, "requireAdminDb", () => database.db);

  const initial = await createPlacementFeeForJoinedCandidate(first, requisition, "admin");
  assert.ok(initial);
  await updateVendorSpendRecord("placementFees", initial.id, { status: "Cancelled" });
  assert.ok(await createPlacementFeeForJoinedCandidate(second, requisition, "admin"));
  await assert.rejects(updateVendorSpendRecord("placementFees", initial.id, { status: "Estimated" }), /another active fee/);
});

test("one active invoice can claim a placement fee", async (context) => {
  const applicant = candidate("application-1", "profile-1");
  const database = fakeDatabase([applicant]);
  context.mock.method(firebase, "requireAdminDb", () => database.db);

  const fee = await createPlacementFeeForJoinedCandidate(applicant, requisition, "admin");
  assert.ok(fee);
  const data = { placementFeeId: fee.id, consultantId, candidateId: applicant.id, paymentStatus: "Pending" };
  const results = await Promise.allSettled([
    createVendorSpendRecord("invoices", "INV", { ...data, invoiceNumber: "A" }),
    createVendorSpendRecord("invoices", "INV", { ...data, invoiceNumber: "B" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(database.records("vendor_invoices").length, 1);
  assert.equal(database.records("placement_fees")[0].status, "Invoiced");
  await updateVendorSpendRecord("placementFees", fee.id, { status: "Cancelled" });
  await assert.rejects(createVendorSpendRecord("placementFees", "PLF", { candidateId: applicant.id, requisitionId: requisition.id, consultantId }), /active placement fee already exists/);
  await assert.rejects(createVendorSpendRecord("invoices", "INV", { ...data, placementFeeId: "", invoiceNumber: "C" }), /Enter the placement reference/);
});
