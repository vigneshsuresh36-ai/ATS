import { parseAccessScopes } from "@/lib/requisitionScope";
import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, deactivateUser, getOrg, getUserByEmail, listRequisitions, listUsers, saveOrg, upsertUser } from "@/lib/db";
import { canManageTeam, DEPARTMENTS, requiresDepartment, ROLE_LABELS } from "@/lib/roles";
import type { Role } from "@/lib/types";

const ALLOWED_ROLES: Role[] = ["Admin", "Recruiter", "HiringManager", "DepartmentHead", "Employee"];

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canManageTeam(user.role)) {
      const org = await getOrg();
      return json({ users: [user], departments: [...new Set([...DEPARTMENTS, ...(org.customDepartments || [])])], roleLabels: ROLE_LABELS });
    }
    const org = await getOrg();
    const [users, requisitions] = await Promise.all([listUsers(true), listRequisitions()]);
    const departments = [...new Set([...DEPARTMENTS, ...(org.customDepartments || [])])];
    const departmentDetails = (org.customDepartments || []).map((department) => {
      const userCount = users.filter((member) => member.departments?.some((item) => item.toLowerCase() === department.toLowerCase())).length;
      const requisitionCount = requisitions.filter((requisition) => requisition.department.toLowerCase() === department.toLowerCase()).length;
      return { name: department, userCount, requisitionCount, inUse: userCount > 0 || requisitionCount > 0 };
    });
    return json({
      users,
      departments,
      departmentDetails,
      roleLabels: ROLE_LABELS,
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canManageTeam(user.role)) throw new ApiError(403, "Admin only.");
    const body = await req.json();
    if (body.action === "addDepartment") {
      const department = String(body.department || "").trim().replace(/\s+/g, " ");
      if (!department || department.length > 80 || /[\u0000-\u001f]/.test(department)) {
        throw new ApiError(400, "Enter a department name from 1 to 80 characters.");
      }
      const org = await getOrg();
      const departments = [...new Set([...DEPARTMENTS, ...(org.customDepartments || [])])];
      const existing = departments.find((item) => item.toLowerCase() === department.toLowerCase());
      if (existing) return json({ department: existing, departments, alreadyExists: true });
      const customDepartments = [...(org.customDepartments || []), department];
      await saveOrg({ customDepartments });
      await addAudit({
        action: "team.department.create",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "department",
        entityId: department,
      });
      return json({ department, departments: [...DEPARTMENTS, ...customDepartments] }, 201);
    }
    if (body.action === "editDepartment" || body.action === "removeDepartment") {
      const department = String(body.department || "").trim().replace(/\s+/g, " ");
      const org = await getOrg();
      const customDepartments = org.customDepartments || [];
      const existing = customDepartments.find((item) => item.toLowerCase() === department.toLowerCase());
      if (!existing) throw new ApiError(404, "Custom department not found. Built-in departments cannot be edited or removed.");
      if ((org.subDepartments || []).some((item) => item.department.toLowerCase() === existing.toLowerCase())) throw new ApiError(409, "Remove the department’s sub-departments in Hiring Workflow before editing or removing it.");
      if (org.departmentBusinessUnits?.some((link) => link.department === existing)) throw new ApiError(409, "Unlink this department from its business units first.");
      const [users, requisitions] = await Promise.all([listUsers(true), listRequisitions()]);
      const userCount = users.filter((member) => member.departments?.some((item) => item.toLowerCase() === existing.toLowerCase())).length;
      const requisitionCount = requisitions.filter((requisition) => requisition.department.toLowerCase() === existing.toLowerCase()).length;
      if (userCount > 0 || requisitionCount > 0) {
        throw new ApiError(409, `This department is in use by ${userCount} team member(s) and ${requisitionCount} requisition(s), so it cannot be edited or removed.`);
      }

      let nextDepartments: string[];
      let savedDepartment = "";
      if (body.action === "editDepartment") {
        savedDepartment = String(body.newDepartment || "").trim().replace(/\s+/g, " ");
        if (!savedDepartment || savedDepartment.length > 80 || /[\u0000-\u001f]/.test(savedDepartment)) {
          throw new ApiError(400, "Enter a department name from 1 to 80 characters.");
        }
        const duplicate = [...DEPARTMENTS, ...customDepartments.filter((item) => item !== existing)]
          .find((item) => item.toLowerCase() === savedDepartment.toLowerCase());
        if (duplicate) throw new ApiError(409, "A department with that name already exists.");
        nextDepartments = customDepartments.map((item) => item === existing ? savedDepartment : item);
      } else {
        nextDepartments = customDepartments.filter((item) => item !== existing);
      }
      await saveOrg({ customDepartments: nextDepartments });
      await addAudit({
        action: body.action === "editDepartment" ? "team.department.update" : "team.department.remove",
        actorEmail: user.email,
        actingAdminEmail: user.actingAdminEmail,
        entityType: "department",
        entityId: existing,
        detail: body.action === "editDepartment" ? savedDepartment : "Removed",
      });
      return json({ departments: [...DEPARTMENTS, ...nextDepartments], department: savedDepartment || existing });
    }
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const employeeCode = String(body.employeeCode || "").trim();
    const rawRole = String(body.role || "").trim();
    const phoneInput = body.phone === undefined ? undefined : String(body.phone).trim();
    if (phoneInput && !/^\+?[0-9\s-]{7,16}$/.test(phoneInput)) throw new ApiError(400, "Enter a valid phone number, for example +91 98765 43210.");
    if (!employeeCode || !name || !email || !rawRole) {
      throw new ApiError(400, "Employee Code, Employee Name, Official Email ID, and Role Access are required.");
    }
    if (employeeCode.length > 50) throw new ApiError(400, "Employee Code must be 50 characters or fewer.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid Official Email ID.");
    const role = rawRole as Role;
    if (!ALLOWED_ROLES.includes(role)) {
      throw new ApiError(400, "Invalid role.");
    }
    const org = await getOrg();
    if (role === "Employee" && !org.employeeReferralsEnabled) {
      throw new ApiError(403, "Enable the Employee Referrals add-on before adding employees.");
    }
    const allowedDepartments = [...DEPARTMENTS, ...(org.customDepartments || [])];
    const existingAccount = await getUserByEmail(email);
    const scopedRole = role === "HiringManager" || role === "DepartmentHead";
    const scopeInput = body.accessScopes ?? existingAccount?.accessScopes;
    const accessScopes = scopedRole && scopeInput !== undefined ? parseAccessScopes(scopeInput, org) : undefined;
    if (accessScopes === null || scopedRole && !accessScopes?.length && (scopeInput !== undefined || org.businessUnits?.length)) {
      throw new ApiError(400, "Assign at least one valid business unit and department scope.");
    }
    const departmentValues: unknown[] = Array.isArray(body.departments)
      ? body.departments
      : String(body.departments || "").split(/[;,]/);
    const departments = accessScopes?.length ? [...new Set(accessScopes.map((scope) => scope.department))] : [...new Set(departmentValues.map((item) => String(item).trim()).filter(Boolean))];
    if (requiresDepartment(role) && departments.length === 0) {
      throw new ApiError(400, "Department is required for the selected role.");
    }
    if (departments.some((department) => !allowedDepartments.some((allowed) => allowed.toLowerCase() === department.toLowerCase()))) {
      throw new ApiError(400, "One or more departments are not recognized.");
    }
    if (body.intent === "create" && existingAccount) throw new ApiError(409, "Official Email ID already exists.");
    if (body.intent === "update" && !existingAccount) throw new ApiError(404, "Team member not found.");
    const duplicateCode = (await listUsers(true)).find((member) =>
      member.employeeCode?.trim().toLowerCase() === employeeCode.toLowerCase() && member.email.toLowerCase() !== email
    );
    if (duplicateCode) throw new ApiError(409, "Employee Code already exists.");
    const saved = await upsertUser({
      email,
      employeeCode,
      name,
      role,
      title: String(body.title || ROLE_LABELS[role]),
      ...(phoneInput !== undefined ? { phone: phoneInput } : {}),
      departments: role === "Admin" ? allowedDepartments : departments,
      ...(accessScopes ? { accessScopes } : !scopedRole && existingAccount?.accessScopes !== undefined ? { accessScopes: [] } : {}),
      ...(role === "Recruiter" ? { managerEmail: user.email } : {}),
      active: true,
    });
    return json({ user: saved, users: await listUsers() }, 201);
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canManageTeam(user.role)) throw new ApiError(403, "Admin only.");
    const email = new URL(req.url).searchParams.get("email");
    if (!email) throw new ApiError(400, "email required.");
    await deactivateUser(email);
    return json({ users: await listUsers() });
  } catch (e) {
    return errResponse(e);
  }
}
