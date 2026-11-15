import { listAllFeedback, listCandidates, listInterviews, listRequisitions, listUsers, listStageEvents, getOrg } from "./db";
import type { AppUser, Requisition } from "./types";
import { ApiError } from "./auth";
import { permittedAutomationRequests } from "./automationAccess";

export function requireAutomationRole(user: AppUser) {
  if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Automations are available to Admins and Recruiters.");
}
export function visibleAutomationRequests(user: AppUser, reqs: Requisition[], users: AppUser[]) {
  requireAutomationRole(user);
  return permittedAutomationRequests(user, reqs, users);
}
export async function automationContext(user: AppUser) {
  requireAutomationRole(user);
  const [allReqs, users, allCandidates, allInterviews, allFeedback, allEvents, org] = await Promise.all([
    listRequisitions(), listUsers(), listCandidates(), listInterviews(), listAllFeedback(), listStageEvents(), getOrg(),
  ]);
  const requisitions = visibleAutomationRequests(user, allReqs, users);
  const ids = new Set(requisitions.map((r) => r.id));
  return { requisitions, users, org, candidates: allCandidates.filter((c) => ids.has(c.reqId)),
    interviews: allInterviews.filter((i) => ids.has(i.reqId)), feedback: allFeedback.filter((f) => ids.has(f.reqId)), events: allEvents.filter((e) => ids.has(e.reqId)) };
}
export type AutomationContext = Awaited<ReturnType<typeof automationContext>>;
