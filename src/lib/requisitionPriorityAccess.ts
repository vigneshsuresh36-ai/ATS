import type { Requisition, Role } from "./types";

export function hidePriorityForRole(requisition: Requisition, role: Role): Requisition {
  if (role !== "DepartmentHead" && role !== "HiringManager") return requisition;
  const { priorityLevel: _priorityLevel, previousPriorityLevel: _previousPriorityLevel, ...visible } = requisition;
  void _priorityLevel;
  void _previousPriorityLevel;
  return visible as Requisition;
}
