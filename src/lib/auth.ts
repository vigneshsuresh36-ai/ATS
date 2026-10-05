import { NextRequest } from "next/server";
import {
  ensureSeedUsers,
  getUserByEmail,
  listUsers,
  verifyIdToken,
} from "./db";
import type { AppUser, Requisition, Role } from "./types";
import { hasMinRole } from "./roles";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(
  req: NextRequest,
  minRole?: Role
): Promise<AppUser> {
  await ensureSeedUsers();
  const hdr = req.headers.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!token) throw new ApiError(401, "Sign in required.");
  const identity = await verifyIdToken(token);
  if (!identity?.email) throw new ApiError(401, "Invalid session.");
  const authenticatedUser = await getUserByEmail(identity.email);
  if (!authenticatedUser || !authenticatedUser.active) {
    throw new ApiError(
      403,
      `Signed in as ${identity.email} but that email is not on the team. Ask an Admin to add you.`
    );
  }
  const actingAsEmail = req.headers.get("x-ats-act-as")?.trim().toLowerCase();
  let user = authenticatedUser;
  if (actingAsEmail && actingAsEmail !== authenticatedUser.email) {
    if (authenticatedUser.role !== "Admin") {
      throw new ApiError(403, "Only an Admin can act as another user.");
    }
    const target = await getUserByEmail(actingAsEmail);
    if (!target || !target.active) {
      throw new ApiError(404, "The selected team member is unavailable.");
    }
    user = { ...target, actingAdminEmail: authenticatedUser.email };
  }
  if (minRole && !hasMinRole(user.role, minRole)) {
    throw new ApiError(
      403,
      `Your role (${user.role}) cannot do that.`
    );
  }
  return user;
}

export async function requireManagedRequisitionAccess(
  user: AppUser,
  requisition: Requisition
) {
  if (user.role !== "Admin" || !requisition.recruiterEmail) return;
  const managedRecruiters = await listUsers();
  const assignedToTeam = managedRecruiters.some(
    (member) =>
      member.role === "Recruiter" &&
      member.managerEmail === user.email &&
      member.email === requisition.recruiterEmail
  );
  if (!assignedToTeam) {
    throw new ApiError(403, "This requisition is outside your managed team.");
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function errResponse(e: unknown) {
  if (e instanceof ApiError) return json({ error: e.message }, e.status);
  console.error(e);
  return json({ error: e instanceof Error ? e.message : "Server error" }, 500);
}
