import { ApiError, requireUser } from "@/lib/auth";
import { getOrg } from "@/lib/db";

export async function requireVendorsSpendUser(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Admin" && user.role !== "Recruiter") throw new ApiError(403, "Vendors & Spend is available to Admins and Recruiters.");
  if (!(await getOrg()).vendorsSpendEnabled) throw new ApiError(404, "Vendors & Spend is not enabled for this organization.");
  return user;
}