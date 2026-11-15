import { ApiError, errResponse, json, requireManagedRequisitionAccess, requireUser } from "@/lib/auth";
import { addAudit, getReferralPayout, getRequisition, listReferralPayouts, listRequisitions, listUsers, markReferralPayoutPaid } from "@/lib/db";

async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can manage referral payouts.");
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const [payouts, requisitions, users] = await Promise.all([listReferralPayouts(), listRequisitions(), listUsers()]);
    const recruiterEmails = new Set(users
      .filter((member) => member.role === "Recruiter" && member.managerEmail === user.email)
      .map((member) => member.email));
    const requisitionById = new Map(requisitions.map((requisition) => [requisition.id, requisition]));
    const visiblePayouts = payouts
      .filter((payout) => {
        const requisition = requisitionById.get(payout.reqId);
        return !!requisition && (!requisition.recruiterEmail || recruiterEmails.has(requisition.recruiterEmail));
      })
      .map((payout) => ({
        ...payout,
        status: payout.status === "Paid"
          ? "Paid" as const
          : payout.dueAt && new Date(payout.dueAt).getTime() < Date.now()
            ? "Overdue" as const
            : "Pending" as const,
        requisitionTitle: requisitionById.get(payout.reqId)?.title || payout.reqId,
      }))
      .sort((a, b) => a.status.localeCompare(b.status) || b.earnedAt.localeCompare(a.earnedAt));
    return json({ payouts: visiblePayouts });
  } catch (error) {
    return errResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) throw new ApiError(400, "Choose a referral payout to update.");
    const payout = await getReferralPayout(id);
    if (!payout) throw new ApiError(404, "Referral payout not found.");
    const requisition = await getRequisition(payout.reqId);
    if (!requisition) throw new ApiError(404, "The payout position was not found.");
    await requireManagedRequisitionAccess(user, requisition);
    const updated = await markReferralPayoutPaid(id, user.email);
    if (!updated) throw new ApiError(404, "Referral payout not found.");
    if (payout.status !== "Paid") {
      await addAudit({
        action: payout.kind === "Joining" ? "employee_referral.joining_bonus.paid" : "employee_referral.interview_bonus.paid",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "referral_payout",
        entityId: id,
        detail: `${updated.amount}; referrer=${updated.referrerEmail}`,
      });
    }
    return json({ payout: updated });
  } catch (error) {
    return errResponse(error);
  }
}