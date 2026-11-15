import type { Role } from "./types";

export const ROLE_RANK: Record<Role, number> = {
  Employee: 0,
  HiringManager: 1,
  DepartmentHead: 2,
  Recruiter: 3,
  Admin: 4,
};

export const ROLE_LABELS: Record<Role, string> = {
  Employee: "Employee",
  Admin: "Admin",
  Recruiter: "Recruiter",
  HiringManager: "Hiring Manager",
  DepartmentHead: "Department Head",
};

export function hasMinRole(role: Role | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Recruiters and Admins can run recruiting after approval. */
export function canRecruit(role: Role): boolean {
  return role === "Recruiter" || role === "Admin";
}

export function canManageTeam(role: Role): boolean {
  return role === "Admin";
}

export function requiresDepartment(role: Role): boolean {
  return role === "HiringManager" || role === "DepartmentHead" || role === "Employee";
}

export function canRaiseReq(role: Role): boolean {
  return role === "HiringManager" || role === "Admin";
}

export function canApprove(role: Role): boolean {
  return role === "DepartmentHead" || role === "Admin";
}

export const DEPARTMENTS = [
  "Technology",
  "Data",
  "IT",
  "Finance",
  "Operations",
  "Sales",
  "Human Resource",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const LOCATIONS = [
  "Bengaluru",
  "Gurgaon",
  "Hyderabad",
  "Chennai",
] as const;

export type LocationCity = (typeof LOCATIONS)[number];

export function userCoversDepartment(
  departments: string[] | undefined,
  department: string
): boolean {
  const list = departments || [];
  return list.map((d) => d.toLowerCase()).includes(department.toLowerCase());
}
