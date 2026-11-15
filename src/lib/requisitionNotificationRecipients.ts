import type { AppUser } from "./types";
import { coversRequisitionScope } from "./requisitionScope";

type ApprovalScope = Parameters<typeof coversRequisitionScope>[1];

export function requisitionApproverRecipients(
  users: AppUser[],
  scope: ApprovalScope | string,
  excludeEmail?: string
) {
  const excluded = excludeEmail?.toLowerCase();
  return [...new Set(users
    .filter((user) => user.active && (
      user.role === "Admin" ||
      user.role === "DepartmentHead" && coversRequisitionScope(user, typeof scope === "string" ? { department: scope, lob: "" } : scope)
    ))
    .map((user) => user.email.toLowerCase())
    .filter((email) => email !== excluded))];
}

export function requisitionDecisionRecipients(
  users: AppUser[],
  scope: ApprovalScope | string,
  raisedByEmail: string,
  actorEmail: string
) {
  const activeEmails = new Set(users.filter((user) => user.active).map((user) => user.email.toLowerCase()));
  const actor = actorEmail.toLowerCase();
  return [...new Set([
    raisedByEmail.toLowerCase(),
    ...requisitionApproverRecipients(users, scope),
  ])].filter((email) => email !== actor && activeEmails.has(email));
}