import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { AppUser } from "./types";

export type AuditValue = string | number | boolean | null;
export type AuditSource = "Manual" | "API" | "AI" | "Automation" | "System";
export type AuditActor = { id: string; name: string; role: AppUser["role"] | "System" };
export type StatusAuditContext = {
  actor: AuditActor;
  actingAs?: AuditActor;
  source: AuditSource;
  reason: string;
  correlationId: string;
};

export type StatusAuditEvent = StatusAuditContext & {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  previousValue: AuditValue;
  newValue: AuditValue;
  changedAt: string;
};

export const STATUS_AUDIT_COLLECTION = "status_audit";

export function auditActor(user: Pick<AppUser, "id" | "name" | "role">): AuditActor {
  return { id: user.id, name: user.name, role: user.role };
}

export function systemStatusAudit(reason: string, trigger?: StatusAuditContext): StatusAuditContext {
  return {
    actor: { id: "system", name: "ATS", role: "System" },
    source: "System",
    reason,
    correlationId: trigger?.correlationId || randomUUID(),
  };
}

export function appendStatusAudit(
  db: Firestore,
  transaction: Transaction,
  change: Pick<StatusAuditEvent, "entityType" | "entityId" | "field" | "previousValue" | "newValue">,
  context?: StatusAuditContext,
) {
  if (change.previousValue === change.newValue) return;
  if (!context?.reason.trim() || context.reason.length > 500 || !context.actor.id || !context.correlationId) {
    throw new Error("A valid status audit context is required for this change.");
  }
  const ref = db.collection(STATUS_AUDIT_COLLECTION).doc();
  const event: StatusAuditEvent = {
    ...context,
    ...change,
    reason: context.reason.trim(),
    id: ref.id,
    changedAt: new Date().toISOString(),
  };
  transaction.create(ref, { ...event, entityKey: `${change.entityType}:${change.entityId}` });
}

export async function readRecordActivity(db: Firestore, entityType: string, entityId: string) {
  const snapshot = await db.collection(STATUS_AUDIT_COLLECTION).where("entityKey", "==", `${entityType}:${entityId}`).get();
  return snapshot.docs.map((doc) => doc.data() as StatusAuditEvent)
    .sort((left, right) => left.changedAt.localeCompare(right.changedAt) || left.id.localeCompare(right.id));
}
