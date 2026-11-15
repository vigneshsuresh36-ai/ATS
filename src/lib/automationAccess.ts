import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import type { AppUser, Requisition } from "./types";
/** Same requisition ownership boundary used by existing candidate and search APIs. */
export function permittedAutomationRequests(user: AppUser, requests: Requisition[], users: AppUser[]) {
  if (user.role !== "Recruiter" && user.role !== "Admin") return [];
  const team = new Set(users.filter((u) => u.active && u.role === "Recruiter" && u.managerEmail === user.email).map((u) => u.email));
  return requests.filter((r) => user.role === "Recruiter" ? isAssignedRecruiter(r, user.email) : !r.recruiterEmail || team.has(r.recruiterEmail));
}
