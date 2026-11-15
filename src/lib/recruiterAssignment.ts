import type { Requisition } from "./types";

export function recruiterCollaborators(emails: string[] = []) {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].sort();
}

export function isAssignedRecruiter(req: Pick<Requisition, "recruiterEmail" | "recruiterCollaboratorEmails">, email: string) {
  const normalized = email.trim().toLowerCase();
  return !!normalized && (req.recruiterEmail?.trim().toLowerCase() === normalized ||
    recruiterCollaborators(req.recruiterCollaboratorEmails).includes(normalized));
}
