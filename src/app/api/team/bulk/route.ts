import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { getOrg, listUsers, upsertUser } from "@/lib/db";
import { canManageTeam, DEPARTMENTS, requiresDepartment, ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/lib/types";

const ALLOWED_ROLES: Role[] = ["Admin", "Recruiter", "HiringManager", "DepartmentHead", "Employee"];

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (!canManageTeam(user.role)) throw new ApiError(403, "Admin only.");
    const body = await request.json();
    if (!Array.isArray(body.members) || body.members.length === 0) {
      throw new ApiError(400, "Upload a workbook containing at least one team member.");
    }
    if (body.members.length > 250) throw new ApiError(400, "Upload no more than 250 team members at a time.");
    const mode = body.mode === "preview" ? "preview" : "commit";
    const org = await getOrg();
    const referralsEnabled = org.employeeReferralsEnabled === true;
    const allowedDepartments = [...DEPARTMENTS, ...(org.customDepartments || [])];
    const existingUsers = await listUsers(true);
    const usersByCode = new Map(existingUsers.filter((member) => member.employeeCode).map((member) => [member.employeeCode!.trim().toLowerCase(), member]));
    const usersByEmail = new Map(existingUsers.map((member) => [member.email.toLowerCase(), member]));
    const seenCodes = new Set<string>();
    const seenEmails = new Set<string>();
    const errors: { row: number; employeeCode: string; email: string; message: string }[] = [];
    const preview: { row: number; employeeCode: string; name: string; email: string; role: Role; departments: string[]; operation: "Add" | "Update"; changes: { field: string; before: string; after: string }[] }[] = [];

    for (const [index, rawMember] of body.members.entries()) {
      const member = rawMember && typeof rawMember === "object" ? rawMember as Record<string, unknown> : {};
      const row = Number(member.row) || index + 2;
      const employeeCode = String(member.employeeCode || "").trim();
      const email = String(member?.email || "").trim().toLowerCase();
      const name = String(member?.name || "").trim();
      const rawRole = String(member?.role || "").trim();
      const roleAlias: Record<string, Role> = {
        "hiring manager": "HiringManager",
        "department head": "DepartmentHead",
      };
      const role = (roleAlias[rawRole.toLowerCase()] || rawRole) as Role;
      const departments = Array.isArray(member?.departments)
        ? [...new Set(member.departments.map((item: unknown) => String(item).trim()).filter(Boolean))]
        : [...new Set(String(member?.departments || "").split(/[;,]/).map((item: string) => item.trim()).filter(Boolean))];

      let message = "";
      if (!employeeCode) message = "Employee Code is required.";
      else if (employeeCode.length > 50) message = "Employee Code must be 50 characters or fewer.";
      else if (seenCodes.has(employeeCode.toLowerCase())) message = "Employee Code is duplicated in this workbook.";
      if (employeeCode) seenCodes.add(employeeCode.toLowerCase());
      if (!message) {
        if (!name) message = "Employee Name is required.";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message = "Enter a valid email address.";
        else if (seenEmails.has(email)) message = "Official Email ID is duplicated in this workbook.";
        else if (!rawRole) message = "Role Access is required.";
        else if (!ALLOWED_ROLES.includes(role)) message = "Choose Admin, Recruiter, HiringManager, DepartmentHead, or Employee.";
        else if (role === "Employee" && !referralsEnabled) message = "Enable Employee Referrals before adding employees.";
        else if (requiresDepartment(role) && departments.length === 0) message = "Department is required for the selected role.";
        else if (departments.some((department: string) => !allowedDepartments.some((allowed) => allowed.toLowerCase() === department.toLowerCase()))) message = "One or more departments are not recognized.";
      }
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seenEmails.add(email);

      if (message) {
        errors.push({ row, employeeCode, email, message });
        continue;
      }
      const existing = usersByCode.get(employeeCode.toLowerCase());
      const emailOwner = usersByEmail.get(email);
      if (existing && existing.email.toLowerCase() !== email) {
        errors.push({ row, employeeCode, email, message: "Official Email ID cannot be changed for an existing Employee Code." });
        continue;
      }
      if (!existing && emailOwner) {
        errors.push({ row, employeeCode, email, message: "Official Email ID already exists. Match the existing Employee Code to update this member." });
        continue;
      }
      const changes = existing ? [
        ["Employee Name", existing.name, name],
        ["Role Access", ROLE_LABELS[existing.role], ROLE_LABELS[role]],
        ["Department", (existing.departments || []).join(", ") || "—", departments.join(", ") || "—"],
      ].filter(([, before, after]) => before !== after).map(([field, before, after]) => ({ field, before, after })) : [];
      if (existing && !existing.active) changes.push({ field: "Status", before: "Inactive", after: "Active" });
      preview.push({ row, employeeCode, name, email, role, departments, operation: existing ? "Update" : "Add", changes });
    }

    if (mode === "preview") {
      return json({ preview, errors, validCount: preview.length }, errors.length ? 207 : 200);
    }
    if (errors.length) return json({ added: 0, updated: 0, errors, preview, users: existingUsers }, 207);

    let added = 0;
    let updated = 0;
    for (const member of preview) {
      try {
        const existing = usersByCode.get(member.employeeCode.toLowerCase());
        await upsertUser({
          email: member.email,
          employeeCode: member.employeeCode,
          name: member.name,
          role: member.role,
          title: existing?.title || ROLE_LABELS[member.role],
          departments: member.role === "Admin" ? allowedDepartments : member.departments,
          ...(member.role === "Recruiter" ? { managerEmail: existing?.managerEmail || user.email } : {}),
          active: true,
        });
        if (existing) updated += 1;
        else added += 1;
      } catch {
        errors.push({ row: member.row, employeeCode: member.employeeCode, email: member.email, message: "Could not save this team member." });
      }
    }

    return json({ added, updated, errors, users: await listUsers() }, errors.length ? 207 : 200);
  } catch (error) {
    return errResponse(error);
  }
}