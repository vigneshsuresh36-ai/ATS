import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/db";
import { canRecruit } from "@/lib/roles";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canRecruit(user.role)) throw new ApiError(403, "Only recruiters and admins can view referral employee codes.");
    const employees = (await listUsers()).filter((member) => member.active !== false && member.employeeCode?.trim()).map((member) => ({ code: member.employeeCode!.trim(), name: member.name }));
    return json({ employees });
  } catch (error) { return errResponse(error); }
}
