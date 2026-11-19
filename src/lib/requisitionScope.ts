import { DEPARTMENTS, userCoversDepartment } from "./roles";
import type { AppUser, OrgSettings, Requisition, RequisitionAccessScope } from "./types";

type ScopedRequest = Pick<Requisition, "department" | "lob" | "subDepartment" | "accessScoped">;
const key = (value?: string) => (value ?? "").trim().toLowerCase();

export function departmentOptions(org: Pick<OrgSettings, "customDepartments" | "departmentBusinessUnits">, businessUnit: string) {
  const departments = [...new Set([...DEPARTMENTS, ...(org.customDepartments ?? [])])];
  const mapped = (org.departmentBusinessUnits ?? []).filter((entry) => key(entry.businessUnit) === key(businessUnit));
  return org.departmentBusinessUnits?.length && businessUnit ? departments.filter((department) => mapped.some((entry) => key(entry.department) === key(department))) : departments;
}

export function requiresSubDepartment(department: string, org: Pick<OrgSettings, "businessUnits">) {
  return !!org.businessUnits?.length && key(department) === "finance";
}

export function coversRequisitionScope(user: Pick<AppUser, "departments" | "accessScopes">, request: ScopedRequest) {
  if (user.accessScopes !== undefined) {
    return !!request.lob && user.accessScopes.some((scope) =>
      key(scope.businessUnit) === key(request.lob) &&
      key(scope.department) === key(request.department) &&
      (!scope.subDepartment || key(scope.subDepartment) === key(request.subDepartment))
    );
  }
  return !request.accessScoped && userCoversDepartment(user.departments, request.department);
}

export function canViewScopedRequisition(user: AppUser, request: ScopedRequest & Pick<Requisition, "raisedByEmail">) {
  if (user.role === "HiringManager") {
    return key(user.email) === key(request.raisedByEmail) &&
      (!request.accessScoped && user.accessScopes === undefined || coversRequisitionScope(user, request));
  }
  if (user.role === "DepartmentHead") return coversRequisitionScope(user, request);
  return user.role !== "Employee";
}

export function scopeDepartments(user: AppUser) {
  return user.accessScopes === undefined ? user.departments ?? [] : [...new Set(user.accessScopes.map((scope) => scope.department))];
}

export function parseAccessScopes(input: unknown, org: OrgSettings): RequisitionAccessScope[] | null {
  if (!Array.isArray(input) || input.length > 100) return null;
  const unique = new Map<string, RequisitionAccessScope>();
  for (const entry of input) {
    if (!entry || typeof entry.businessUnit !== "string" || typeof entry.department !== "string" ||
      (entry.subDepartment !== undefined && typeof entry.subDepartment !== "string")) return null;
    const businessUnit = (org.businessUnits ?? []).find((name) => key(name) === key(entry.businessUnit));
    if (!businessUnit) return null;
    const department = departmentOptions(org, businessUnit).find((name) => key(name) === key(entry.department));
    if (!department) return null;
    const subDepartment = key(entry.subDepartment)
      ? (org.subDepartments ?? []).find((item) => key(item.department) === key(department) && key(item.name) === key(entry.subDepartment))?.name
      : undefined;
    if (key(entry.subDepartment) && !subDepartment) return null;
    const scope = { businessUnit, department, ...(subDepartment ? { subDepartment } : {}) };
    unique.set(JSON.stringify(scope), scope);
  }
  const values = [...unique.values()];
  return values.filter((scope) => !scope.subDepartment || !values.some((other) =>
    other.businessUnit === scope.businessUnit && other.department === scope.department && !other.subDepartment
  ));
}
