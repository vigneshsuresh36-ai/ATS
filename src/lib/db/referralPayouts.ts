import { requireAdminDb } from "../firebaseAdmin";
import type { ReferralPayout } from "../types";

type NewReferralPayout = Omit<ReferralPayout, "id" | "status" | "earnedAt" | "paidAt" | "paidBy">;

export async function createReferralPayout(input: NewReferralPayout) {
  const db = requireAdminDb();
  const id = `${input.candidateId}_round_${input.roundIndex}`;
  const ref = db.collection("referral_payouts").doc(id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return { payout: existing.data() as ReferralPayout, created: false };
    const payout: ReferralPayout = {
      ...input,
      id,
      kind: "InterviewRound",
      status: "Pending",
      earnedAt: new Date().toISOString(),
    };
    transaction.create(ref, payout);
    return { payout, created: true };
  });
}

export async function createJoiningReferralPayout(input: {
  reqId: string;
  candidateId: string;
  candidateName: string;
  referrerEmail: string;
  amount: number;
  joiningDate: string;
  dueAt: string;
}) {
  const db = requireAdminDb();
  const id = `${input.candidateId}_joining`;
  const ref = db.collection("referral_payouts").doc(id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return { payout: existing.data() as ReferralPayout, created: false };
    const payout: ReferralPayout = {
      ...input,
      id,
      kind: "Joining",
      roundIndex: 0,
      roundName: "Joining bonus",
      decision: "Onboarded",
      status: "Pending",
      earnedAt: `${input.joiningDate}T00:00:00.000Z`,
    };
    transaction.create(ref, payout);
    return { payout, created: true };
  });
}

export async function getReferralPayout(id: string): Promise<ReferralPayout | null> {
  const snapshot = await requireAdminDb().collection("referral_payouts").doc(id).get();
  return snapshot.exists ? snapshot.data() as ReferralPayout : null;
}

export async function listReferralPayouts(): Promise<ReferralPayout[]> {
  const snapshot = await requireAdminDb().collection("referral_payouts").get();
  return snapshot.docs.map((doc) => doc.data() as ReferralPayout);
}

export async function markReferralPayoutPaid(id: string, paidBy: string) {
  const db = requireAdminDb();
  const ref = db.collection("referral_payouts").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const payout = snapshot.data() as ReferralPayout;
    if (payout.status === "Paid") return payout;
    const updated: ReferralPayout = {
      ...payout,
      status: "Paid",
      paidAt: new Date().toISOString(),
      paidBy: paidBy.toLowerCase(),
    };
    transaction.set(ref, updated);
    return updated;
  });
}