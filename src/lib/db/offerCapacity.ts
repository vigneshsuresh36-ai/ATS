import { ApiError } from "../auth";
import { requireAdminDb } from "../firebaseAdmin";
import { remainingOfferOpenings } from "../offerCapacity";
import { appendStatusAudit, systemStatusAudit } from "../statusAudit";
import type { Candidate, Requisition, StageEvent } from "../types";
import { newId } from "./ids";

type Transition = "request" | "approve" | "reject" | "backout";
export async function transitionOffer(candidateId: string, reqId: string, transition: Transition, patch: Partial<Candidate>, actorEmail: string) {
  const db = requireAdminDb();
  const reqRef = db.collection("requisitions").doc(reqId);
  const candidateRef = db.collection("candidates").doc(candidateId);
  const eventRef = db.collection("stage_events").doc(newId("SE"));
  return db.runTransaction(async (tx) => {
    const [reqSnapshot, candidateSnapshot, candidateList] = await Promise.all([tx.get(reqRef), tx.get(candidateRef), tx.get(db.collection("candidates").where("reqId", "==", reqId))]);
    const requisition = reqSnapshot.data() as Requisition | undefined;
    const candidate = candidateSnapshot.data() as Candidate | undefined;
    if (!requisition || !candidate || candidate.reqId !== reqId) throw new ApiError(404, "Candidate or hiring request not found.");
    const candidates = candidateList.docs.map((doc) => doc.data() as Candidate);
    const remaining = remainingOfferOpenings(requisition.openings, candidates);
    if (transition === "request") {
      if (!["Approved", "Position Reopened", "Partially Fulfilled"].includes(requisition.status)) throw new ApiError(409, "This hiring request is not open for offer requests.");
      if (candidate.stage !== "Selected" || candidate.offerApprovalStatus === "Pending" || candidate.offerApprovalStatus === "Approved") throw new ApiError(409, "This candidate is no longer available for a new offer request.");
      if (remaining === 0) throw new ApiError(409, "All openings have approved offers. An opening must become available before requesting another offer.");
    } else if (transition === "approve" || transition === "reject") {
      if (candidate.offerApprovalStatus !== "Pending" || candidate.stage !== "OfferApprovalPending") throw new ApiError(409, "This offer is no longer awaiting approval.");
      if (transition === "approve" && remaining === 0) throw new ApiError(409, "All openings already have approved offers. An opening must become available before approving this offer.");
      if (!["Approved", "Position Reopened", "Partially Fulfilled", "Position Fulfilled"].includes(requisition.status)) throw new ApiError(409, "This hiring request is not available for an offer decision.");
    } else {
      if (candidate.offerApprovalStatus !== "Approved" || !["OfferApproved", "Offered"].includes(candidate.stage)) throw new ApiError(409, "This candidate no longer has an approved offer eligible for backout.");
    }
    const now = new Date().toISOString();
    const updated = { ...candidate, ...patch, updatedAt: now };
    const after = candidates.map((item) => item.id === candidateId ? updated : item);
    const remainingAfter = remainingOfferOpenings(requisition.openings, after);
    let nextStatus = requisition.status;
    if (transition !== "request" && ["Approved", "Position Reopened", "Partially Fulfilled", "Position Fulfilled"].includes(requisition.status)) {
      const approved = Math.max(0, requisition.openings - remainingAfter);
      nextStatus = remainingAfter === 0 ? "Position Fulfilled" : approved > 0 ? "Partially Fulfilled" : requisition.status === "Position Fulfilled" || requisition.status === "Partially Fulfilled" ? "Position Reopened" : requisition.status;
    }
    const reqPatch: Partial<Requisition> = { updatedAt: now, status: nextStatus };
    if (nextStatus === "Position Fulfilled" && requisition.status !== nextStatus) { reqPatch.careersPublished = false; if (requisition.priorityLevel) reqPatch.previousPriorityLevel = requisition.priorityLevel; reqPatch.priorityLevel = "-"; }
    if (nextStatus === "Position Reopened" && requisition.status === "Position Fulfilled") reqPatch.priorityLevel = requisition.previousPriorityLevel || "P4";
    if (requisition.status !== nextStatus) appendStatusAudit(db, tx, { entityType: "requisition", entityId: reqId, field: "status", previousValue: requisition.status, newValue: nextStatus }, systemStatusAudit(`Offer capacity updated: ${requisition.openings - remainingAfter} of ${requisition.openings} openings have approved offers.`));
    tx.update(reqRef, reqPatch);
    tx.update(candidateRef, Object.fromEntries(Object.entries({ ...patch, updatedAt: now }).filter(([, value]) => value !== undefined)));
    if (candidate.stage !== updated.stage) tx.create(eventRef, { id: eventRef.id, candidateId, reqId, fromStage: candidate.stage, toStage: updated.stage, byEmail: actorEmail, at: now } satisfies StageEvent);
    return { candidate: updated, requisition: { ...requisition, ...reqPatch } };
  });
}
