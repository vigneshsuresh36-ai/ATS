import type { Requisition } from "./types";

/** Only explicitly listed roles with a current application owner may appear publicly. */
export function canListOnCareersPage(req: Requisition): boolean {
  return req.careersPublished === true && !!req.recruiterEmail && ["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status);
}
