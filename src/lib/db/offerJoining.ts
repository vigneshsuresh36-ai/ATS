import { requireAdminDb } from "../firebaseAdmin";
import type { Candidate, DojChangeHistory, JoiningStatus, JoiningStatusHistory } from "../types";
import { newId, now } from "./ids";

export type JoiningUpdate =
  | { kind: "doj"; revisedDoj: string; reason: string; remarks?: string; updatedBy: string }
  | { kind: "status"; status: JoiningStatus; actualJoiningDate?: string; reason?: string; remarks?: string; updatedBy: string };

function currentJoiningStatus(candidate: Candidate): JoiningStatus {
  return candidate.joiningStatus || (candidate.stage === "Onboarded" ? "Joined" : "Awaiting Confirmation");
}

export async function ensureJoiningDetails(candidateId: string): Promise<Candidate | null> {
  const db = requireAdminDb();
  const ref = db.collection("candidates").doc(candidateId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const candidate = snapshot.data() as Candidate;
    const initialDoj = candidate.initialDoj || candidate.tentativeDoj || "";
    const patch: Partial<Candidate> = {};
    if (!candidate.initialDoj && initialDoj) patch.initialDoj = initialDoj;
    if (!candidate.currentDoj && initialDoj) patch.currentDoj = initialDoj;
    if (!candidate.joiningStatus) patch.joiningStatus = currentJoiningStatus(candidate);
    if (Object.keys(patch).length) {
      transaction.set(ref, patch, { merge: true });
      return { ...candidate, ...patch };
    }
    return candidate;
  });
}

export async function updateJoiningDetails(candidateId: string, update: JoiningUpdate): Promise<Candidate | null> {
  const db = requireAdminDb();
  const candidateRef = db.collection("candidates").doc(candidateId);
  const updatedAt = now();
  const dojHistoryRef = candidateRef.collection("doj_history").doc(newId("DOJ"));
  const statusHistoryRef = candidateRef.collection("joining_status_history").doc(newId("JSH"));

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(candidateRef);
    if (!snapshot.exists) return null;
    const candidate = snapshot.data() as Candidate;
    const previousStatus = currentJoiningStatus(candidate);
    if (candidate.offerApprovalStatus === "Rejected" || ["Rejected", "Candidate Backed Out", "Social CV Reject"].includes(candidate.stage)) {
      throw new Error("Offer & Joining details are read-only after an offer rejection or candidate withdrawal.");
    }
    if (["Joined", "No-Show", "Candidate Withdrawn"].includes(previousStatus)) {
      throw new Error("Joining details cannot be changed after a terminal joining status.");
    }

    if (update.kind === "doj") {
      const previousDoj = candidate.currentDoj || candidate.initialDoj || candidate.tentativeDoj;
      if (!previousDoj) throw new Error("An initial Date of Joining is required before it can be revised.");
      if (update.revisedDoj === previousDoj) throw new Error("The revised Date of Joining must differ from the current date.");
      const candidatePatch: Partial<Candidate> = {
        initialDoj: candidate.initialDoj || previousDoj,
        currentDoj: update.revisedDoj,
        joiningUpdatedAt: updatedAt,
        ...(update.remarks !== undefined ? { joiningRemarks: update.remarks } : {}),
        dojChangeCount: (candidate.dojChangeCount || 0) + 1,
      };
      const history: DojChangeHistory = {
        id: dojHistoryRef.id,
        candidateId,
        previousDoj,
        revisedDoj: update.revisedDoj,
        reason: update.reason,
        ...(update.remarks ? { remarks: update.remarks } : {}),
        updatedBy: update.updatedBy,
        updatedAt,
      };
      transaction.set(candidateRef, candidatePatch, { merge: true });
      transaction.create(dojHistoryRef, history);
      return { ...candidate, ...candidatePatch };
    }

    if (update.status === previousStatus) throw new Error("Choose a different joining status.");
    const candidatePatch: Partial<Candidate> = {
      joiningStatus: update.status,
      joiningStatusUpdatedAt: updatedAt,
      joiningUpdatedAt: updatedAt,
      ...(update.remarks !== undefined ? { joiningRemarks: update.remarks } : {}),
      ...(update.status === "Joined" && update.actualJoiningDate ? { actualJoiningDate: update.actualJoiningDate } : {}),
    };
    const history: JoiningStatusHistory = {
      id: statusHistoryRef.id,
      candidateId,
      previousStatus,
      newStatus: update.status,
      ...(update.reason ? { reason: update.reason } : {}),
      ...(update.remarks ? { remarks: update.remarks } : {}),
      updatedBy: update.updatedBy,
      updatedAt,
    };
    transaction.set(candidateRef, candidatePatch, { merge: true });
    transaction.create(statusHistoryRef, history);
    return { ...candidate, ...candidatePatch };
  });
}

export async function getJoiningHistory(candidateId: string) {
  const ref = requireAdminDb().collection("candidates").doc(candidateId);
  const [dojSnapshot, statusSnapshot] = await Promise.all([
    ref.collection("doj_history").get(),
    ref.collection("joining_status_history").get(),
  ]);
  const dojHistory = dojSnapshot.docs.map((doc) => doc.data() as DojChangeHistory)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const statusHistory = statusSnapshot.docs.map((doc) => doc.data() as JoiningStatusHistory)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { dojHistory, statusHistory };
}
