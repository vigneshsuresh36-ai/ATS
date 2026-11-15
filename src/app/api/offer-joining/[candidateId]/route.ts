import { ApiError, errResponse, json } from "@/lib/auth";
import { addAudit, createPlacementFeeForJoinedCandidate, ensureJoiningDetails, getJoiningHistory, getOrg, getRequisition, updateJoiningDetails } from "@/lib/db";
import { requireAccessibleJoiningCandidate, requireOfferJoiningUser } from "@/lib/offerJoiningAccess";
import type { JoiningStatus } from "@/lib/types";

type Ctx = { params: Promise<{ candidateId: string }> };
const DOJ_REASONS = ["Notice Period Extension", "Personal Reasons", "Documentation Pending", "Business Requirement", "Other"];
const JOINING_STATUSES: JoiningStatus[] = ["Joined", "No-Show", "Candidate Withdrawn"];

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maxLength) throw new ApiError(400, `${field} is too long or invalid.`);
  return value.trim();
}

export async function GET(request: Request, context: Ctx) {
  try {
    const user = await requireOfferJoiningUser(request);
    const { candidateId } = await context.params;
    await requireAccessibleJoiningCandidate(user, candidateId);
    const candidate = await ensureJoiningDetails(candidateId);
    if (!candidate) throw new ApiError(404, "Candidate not found.");
    const history = await getJoiningHistory(candidateId);
    return json({ candidate, ...history });
  } catch (error) {
    return errResponse(error);
  }
}

export async function PATCH(request: Request, context: Ctx) {
  try {
    const user = await requireOfferJoiningUser(request);
    const { candidateId } = await context.params;
    const { candidate: accessibleCandidate } = await requireAccessibleJoiningCandidate(user, candidateId);
    if (accessibleCandidate.offerApprovalStatus === "Rejected" || ["Rejected", "Candidate Backed Out", "Social CV Reject"].includes(accessibleCandidate.stage)) {
      throw new ApiError(409, "Offer & Joining details are read-only after an offer rejection or candidate withdrawal.");
    }
    const body = await request.json();
    const remarks = boundedText(body.remarks, "Remarks", 2000);
    let candidate;

    if (body.action === "updateDoj") {
      const revisedDoj = String(body.revisedDoj || "").trim();
      const reason = String(body.reason || "").trim();
      if (!isValidDateOnly(revisedDoj)) throw new ApiError(400, "Enter a valid revised Date of Joining.");
      if (!DOJ_REASONS.includes(reason)) throw new ApiError(400, "Choose a reason for changing the Date of Joining.");
      if (reason === "Other" && !remarks) throw new ApiError(400, "Remarks are required when the reason is Other.");
      candidate = await updateJoiningDetails(candidateId, { kind: "doj", revisedDoj, reason, remarks, updatedBy: user.email });
    } else if (body.action === "updateStatus") {
      const status = String(body.status || "") as JoiningStatus;
      const reason = boundedText(body.reason, "Reason", 500);
      if (!JOINING_STATUSES.includes(status)) throw new ApiError(400, "Choose a valid joining status.");
      const actualJoiningDate = String(body.actualJoiningDate || "").trim();
      if (actualJoiningDate && !isValidDateOnly(actualJoiningDate)) {
        throw new ApiError(400, "Enter a valid Actual Joining Date.");
      }
      candidate = await updateJoiningDetails(candidateId, {
        kind: "status", status, ...(status === "Joined" && actualJoiningDate ? { actualJoiningDate } : {}),
        ...(reason ? { reason } : {}), ...(remarks ? { remarks } : {}), updatedBy: user.email,
      });
    } else {
      throw new ApiError(400, "Choose a valid Offer & Joining action.");
    }

    if (!candidate) throw new ApiError(404, "Candidate not found.");
    if (body.action === "updateStatus" && body.status === "Joined" && (await getOrg()).vendorsSpendEnabled) {
      const requisition = await getRequisition(candidate.reqId);
      if (requisition) {
        const placement = await createPlacementFeeForJoinedCandidate(candidate, requisition, user.email);
        if (placement) {
          await addAudit({
            action: "vendor.placement_fee.estimated",
            actorEmail: user.email,
            actingAdminEmail: user.actingAdminEmail,
            entityType: "placement_fee",
            entityId: String(placement.id),
            detail: String(placement.expectedFee),
          });
        }
      }
    }
    return json({ candidate });
  } catch (error) {
    if (error instanceof Error && [
      "Joining details cannot be changed after a terminal joining status.",
      "Offer & Joining details are read-only after an offer rejection or candidate withdrawal.",
      "An initial Date of Joining is required before it can be revised.",
      "The revised Date of Joining must differ from the current date.",
      "Choose a different joining status.",
    ].includes(error.message)) {
      return errResponse(new ApiError(409, error.message));
    }
    return errResponse(error);
  }
}
