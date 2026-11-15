import { requireAdminDb } from "./firebaseAdmin";
import type { AuditLog } from "./types";

/** Use only explicit priority changes belonging to the authorized requisitions. */
export function prioritiesFromAudit(events: AuditLog[], allowedIds: string[]): Record<string, string> {
  const allowed = new Set(allowedIds);
  const latest: Record<string, { priority: string; at: string }> = {};
  for (const event of events) {
    if (!allowed.has(event.entityId) || event.entityType !== "requisition" || event.action !== "requisition.priority.update" || !["P1", "P2", "P3", "P4"].includes(event.detail || "") || !event.at) continue;
    if (!latest[event.entityId] || latest[event.entityId].at < event.at) latest[event.entityId] = { priority: event.detail!, at: event.at };
  }
  return Object.fromEntries(Object.entries(latest).map(([id, value]) => [id, value.priority]));
}
export async function lastAssignedPriorities(requisitionIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(requisitionIds.filter(Boolean))];
  const db = requireAdminDb();
  const groups: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) groups.push(ids.slice(i, i + 30));
  const snapshots = await Promise.all(groups.map((group) => db.collection("audit_log").where("entityId", "in", group).get()));
  return prioritiesFromAudit(snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data() as AuditLog)), ids);
}
