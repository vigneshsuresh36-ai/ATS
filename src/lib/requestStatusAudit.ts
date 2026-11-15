import { randomUUID } from "node:crypto";
import { ApiError } from "./auth";
import { getUserByEmail } from "./db";
import { auditActor, type StatusAuditContext } from "./statusAudit";
import type { AppUser } from "./types";

export async function requestStatusAudit(user: AppUser, reason: unknown, source: "Manual" | "API" | "System" = "Manual"): Promise<StatusAuditContext> {
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    throw new ApiError(400, "Enter a reason for the status change (up to 500 characters).");
  }
  const actor = user.actingAdminEmail ? await getUserByEmail(user.actingAdminEmail) : user;
  if (!actor) throw new ApiError(403, "The authenticated actor could not be resolved.");
  return {
    actor: auditActor(actor),
    ...(user.actingAdminEmail ? { actingAs: auditActor(user) } : {}),
    source,
    reason: reason.trim(),
    correlationId: randomUUID(),
  };
}
