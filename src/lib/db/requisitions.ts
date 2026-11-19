import { recruiterCollaborators } from "../recruiterAssignment";
import { requireAdminDb } from "../firebaseAdmin";
import { appendStatusAudit, type StatusAuditContext } from "../statusAudit";
import { ApiError } from "../auth";
import type { ApprovalStatus, Requisition } from "../types";
import { isRequisitionClosed } from "../requisitionStatus";
import { newId, now } from "./ids";

export async function listRequisitions(filter?: {
  raisedByEmail?: string;
  department?: string;
  departments?: string[];
  status?: ApprovalStatus;
}): Promise<Requisition[]> {
  const db = requireAdminDb();
  let snap;
  if (filter?.raisedByEmail && !filter.status && !filter.department && !filter.departments) {
    snap = await db
      .collection("requisitions")
      .where("raisedByEmail", "==", filter.raisedByEmail.toLowerCase())
      .get();
  } else if (filter?.status && !filter.raisedByEmail && !filter.department && !filter.departments) {
    snap = await db
      .collection("requisitions")
      .where("status", "==", filter.status)
      .get();
  } else {
    snap = await db.collection("requisitions").get();
  }

  let list = snap.docs.map((d) => d.data() as Requisition);
  if (filter?.raisedByEmail)
    list = list.filter(
      (r) => r.raisedByEmail === filter.raisedByEmail!.toLowerCase()
    );
  if (filter?.department)
    list = list.filter(
      (r) => r.department.toLowerCase() === filter.department!.toLowerCase()
    );
  if (filter?.departments?.length) {
    const set = new Set(filter.departments.map((d) => d.toLowerCase()));
    list = list.filter((r) => set.has(r.department.toLowerCase()));
  }
  if (filter?.status) list = list.filter((r) => r.status === filter.status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRequisition(id: string): Promise<Requisition | null> {
  const snap = await requireAdminDb().collection("requisitions").doc(id).get();
  return snap.exists ? (snap.data() as Requisition) : null;
}

export async function createRequisition(
  input: Omit<Requisition, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: ApprovalStatus;
  },
  audit: StatusAuditContext,
): Promise<Requisition> {
  const db = requireAdminDb();
  return db.runTransaction(async (tx) => {
    const orgRef = db.collection("org").doc("org");
    const settings = (await tx.get(orgRef)).data();
    const sequenceKey = input.requisitionType === "Replacement" ? "requisitionReplacementSequence" : "requisitionNewSequence";
    const sequence = settings?.requisitionSeparateSequences ? settings[sequenceKey] : { prefix: settings?.requisitionIdPrefix, nextNumber: settings?.requisitionNextNumber };
    const sequential = typeof sequence?.prefix === "string" && Number.isSafeInteger(sequence?.nextNumber);
    const id = sequential ? `${sequence.prefix}-${sequence.nextNumber}` : newId("REQ");
    const reqRef = db.collection("requisitions").doc(id);
    if ((await tx.get(reqRef)).exists) throw new Error("The next requisition ID already exists. Ask an admin to update the requisition sequence.");
    const req: Requisition = { ...input, id, status: input.status || "PendingApproval", raisedByEmail: input.raisedByEmail.toLowerCase(), createdAt: now(), updatedAt: now() };
    appendStatusAudit(db, tx, { entityType: "requisition", entityId: id, field: "status", previousValue: null, newValue: req.status }, audit);
    tx.create(reqRef, req);
    if (sequential) tx.update(orgRef, settings?.requisitionSeparateSequences ? { [`${sequenceKey}.nextNumber`]: sequence.nextNumber + 1 } : { requisitionNextNumber: sequence.nextNumber + 1 });
    return req;
  });
}

export async function updateRequisition(
  id: string,
  patch: Partial<Requisition>,
  audit?: StatusAuditContext,
  expected?: Pick<Requisition, "status" | "department" | "lob" | "subDepartment" | "accessScoped" | "recruiterEmail" | "recruiterCollaboratorEmails" | "openings">
): Promise<Requisition | null> {
  const db = requireAdminDb();
  const ref = db.collection("requisitions").doc(id);
  return db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data() as Requisition | undefined;
    if (!current) return null;
    if (expected && (current.status !== expected.status || current.department !== expected.department ||
      current.lob !== expected.lob || current.subDepartment !== expected.subDepartment || current.accessScoped !== expected.accessScoped ||
      current.recruiterEmail !== expected.recruiterEmail ||
      recruiterCollaborators(current.recruiterCollaboratorEmails).join(",") !== recruiterCollaborators(expected.recruiterCollaboratorEmails).join(",") || current.openings !== expected.openings)) {
      if (audit?.source === "System") return current;
      throw new ApiError(409, "This requisition changed. Refresh it and try again.");
    }
    const normalizedPatch = { ...patch };
    if (patch.status && !["Approved", "Position Reopened", "Partially Fulfilled"].includes(patch.status)) normalizedPatch.careersPublished = false;
    if (patch.recruiterEmail !== undefined && (current.recruiterEmail || "").toLowerCase() !== patch.recruiterEmail.toLowerCase()) normalizedPatch.careersPublished = false;
    if (patch.status && isRequisitionClosed(patch.status)) {
      if (["P1", "P2", "P3", "P4"].includes(current.priorityLevel || "")) normalizedPatch.previousPriorityLevel = current.priorityLevel;
      normalizedPatch.priorityLevel = "-";
    } else if (patch.status === "Approved" && !patch.priorityLevel) {
      normalizedPatch.priorityLevel = "P4";
    }
    if (patch.status !== undefined) {
      appendStatusAudit(db, transaction, {
        entityType: "requisition", entityId: id, field: "status",
        previousValue: current.status, newValue: patch.status,
      }, audit);
    }
    if (patch.recruiterEmail !== undefined) {
      appendStatusAudit(db, transaction, {
        entityType: "requisition", entityId: id, field: "recruiterEmail",
        previousValue: (current.recruiterEmail || "").trim().toLowerCase() || null,
        newValue: patch.recruiterEmail.trim().toLowerCase() || null,
      }, audit);
    }
    if (patch.recruiterCollaboratorEmails !== undefined) {
      const previous = recruiterCollaborators(current.recruiterCollaboratorEmails);
      const next = recruiterCollaborators(patch.recruiterCollaboratorEmails);
      normalizedPatch.recruiterCollaboratorEmails = next;
      appendStatusAudit(db, transaction, {
        entityType: "requisition", entityId: id, field: "recruiterCollaboratorEmails",
        previousValue: previous.join(", ") || null, newValue: next.join(", ") || null,
      }, audit);
    }
    const updated = { ...normalizedPatch, updatedAt: now() };
    transaction.set(ref, updated, { merge: true });
    return { ...current, ...updated };
  });
}
