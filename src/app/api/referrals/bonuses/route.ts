import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, listRequisitions, listUsers, updateRequisition } from "@/lib/db";
import { isRequisitionClosed } from "@/lib/requisitionStatus";

type BonusRow = { row: number; reqId: string; referralBonus: number; employeeReferralEnabled: boolean };
type BonusError = { row: number; reqId: string; message: string };

async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Admin") throw new ApiError(403, "Only an Admin can manage referral bonuses.");
  return user;
}

async function getManagedOpenRoles(email: string) {
  const [requisitions, users] = await Promise.all([listRequisitions(), listUsers()]);
  const recruiterEmails = new Set(users
    .filter((member) => member.role === "Recruiter" && member.managerEmail === email)
    .map((member) => member.email));
  return requisitions.filter((requisition) =>
    !isRequisitionClosed(requisition.status) &&
    (!requisition.recruiterEmail || recruiterEmails.has(requisition.recruiterEmail))
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const requisitions = await getManagedOpenRoles(user.email);
    return json({ requisitions: requisitions.map((requisition) => ({
      id: requisition.id,
      title: requisition.title,
      department: requisition.department,
      location: requisition.location,
      status: requisition.status,
      referralBonus: requisition.referralBonus || 0,
      employeeReferralEnabled: requisition.employeeReferralEnabled === true,
    })) });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await request.json();
    if (!Array.isArray(body.bonuses) || body.bonuses.length === 0) {
      throw new ApiError(400, "Upload a workbook containing at least one referral bonus row.");
    }
    if (body.bonuses.length > 250) throw new ApiError(400, "Upload no more than 250 referral bonus rows at a time.");

    const requisitions = await getManagedOpenRoles(user.email);
    const requisitionById = new Map(requisitions.map((requisition) => [requisition.id, requisition]));
    const seenIds = new Set<string>();
    const errors: BonusError[] = [];
    let updated = 0;

    for (const [index, rawRow] of body.bonuses.entries()) {
      const row = rawRow && typeof rawRow === "object" ? rawRow as Partial<BonusRow> : {};
      const reqId = String(row.reqId || "").trim();
      const referralBonus = Number(row.referralBonus);
      const employeeReferralEnabled = row.employeeReferralEnabled;
      let message = "";
      if (!reqId) message = "Requisition ID is required.";
      else if (seenIds.has(reqId)) message = "Requisition ID is duplicated in this workbook.";
      else if (row.referralBonus === undefined || row.referralBonus === null || String(row.referralBonus).trim() === "") {
        message = "Referral bonus is required; enter 0 to remove a bonus.";
      } else if (typeof employeeReferralEnabled !== "boolean") message = "Set Employee Referral Enabled to TRUE or FALSE.";
      else if (!Number.isSafeInteger(referralBonus) || referralBonus < 0 || referralBonus > 100_000_000) {
        message = "Enter a whole-number bonus from 0 to 100,000,000.";
      } else if (employeeReferralEnabled && referralBonus <= 0) {
        message = "Enter a bonus greater than 0 before enabling referrals for this position.";
      } else if (!requisitionById.has(reqId)) message = "Position is closed, outside your managed team, or not found.";

      if (message) {
        errors.push({ row: Number(row.row) || index + 2, reqId, message });
        continue;
      }
      seenIds.add(reqId);
      const requisition = requisitionById.get(reqId)!;
      try {
        await updateRequisition(reqId, { referralBonus, employeeReferralEnabled });
        await addAudit({
          action: "requisition.referral_bonus.update",
          actorEmail: user.email,
          actingAdminEmail: user.actingAdminEmail,
          entityType: "requisition",
          entityId: reqId,
          detail: `bonus=${referralBonus}; employeeReferralEnabled=${employeeReferralEnabled}`,
        });
        updated += 1;
      } catch {
        errors.push({ row: Number(row.row) || index + 2, reqId, message: `Could not update ${requisition.title}.` });
      }
    }

    return json({ updated, errors }, errors.length ? 207 : 200);
  } catch (error) {
    return errResponse(error);
  }
}