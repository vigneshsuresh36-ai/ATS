import { getOrg, getRequisition, getSocialLinkByToken, getUserByEmail } from "@/lib/db";
import type { Requisition } from "@/lib/types";

const OPEN_STATUSES = new Set<Requisition["status"]>([
  "Approved", "Position Reopened", "Partially Fulfilled",
]);

export async function getActiveSocialApplication(token: string) {
  const link = await getSocialLinkByToken(token);
  if (!link) return null;
  const requisition = await getRequisition(link.reqId);
  if (link.kind === "employee-referral") {
    const [org, referrer] = await Promise.all([
      getOrg(),
      getUserByEmail(link.referrerEmail || ""),
    ]);
    if (!org.employeeReferralsEnabled || !referrer || !referrer.active || referrer.role !== "Employee") return null;
  }
  if (
    !requisition ||
    !OPEN_STATUSES.has(requisition.status) ||
    (link.kind === "career" && requisition.careersPublished !== true) ||
    (link.kind !== "employee-referral" && requisition.recruiterEmail?.toLowerCase() !== link.recruiterEmail.toLowerCase())
  ) return null;
  return { link, requisition };
}
