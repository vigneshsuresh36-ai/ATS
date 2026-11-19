"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { DEPARTMENTS, requiresDepartment, ROLE_LABELS } from "@/lib/roles";
import { AccessScopePicker } from "./AccessScopePicker";
import type { AppUser, OrgSettings, RequisitionAccessScope, Role } from "@/lib/types";

type TeamSortField = "employeeCode" | "name" | "email" | "role" | "departments" | "active";
type UserDraft = { employeeCode: string; phone: string; role: Role; departments: string[]; accessScopes?: RequisitionAccessScope[] };
type BulkPreviewRow = {
  row: number;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  departments: string[];
  operation: "Add" | "Update";
  changes: { field: string; before: string; after: string }[];
};
type BulkError = { row: number; employeeCode: string; email: string; message: string };
type DepartmentDetail = { name: string; userCount: number; requisitionCount: number; inUse: boolean };

const ROLES: Role[] = ["Admin", "Recruiter", "HiringManager", "DepartmentHead", "Employee"];
const PAGE_SIZE = 25;
const TEMPLATE_HEADERS = ["Employee Code *", "Employee Name *", "Official Email ID *", "Role Access *", "Department"];

function sameDepartments(left: string[], right: string[]) {
  return left.length === right.length && left.every((department) => right.includes(department));
}

function roleLabel(role: Role) {
  return ROLE_LABELS[role] || role;
}

function roleFromCell(value: string): string {
  const roleAliases: Record<string, string> = {
    "hiring manager": "HiringManager",
    "department head": "DepartmentHead",
  };
  return roleAliases[value.trim().toLowerCase()] || value.trim();
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(workbook, filename);
}

export function TeamView({
  users,
  apiFetch,
  onRefresh,
  onActAs,
  currentEmail,
  employeeReferralsEnabled = false,
  availableDepartments = [],
  departmentDetails = [],
  org,
}: {
  users: AppUser[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onActAs?: (user: AppUser) => void;
  currentEmail: string;
  employeeReferralsEnabled?: boolean;
  availableDepartments?: string[];
  departmentDetails?: DepartmentDetail[];
  org?: OrgSettings | null;
}) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState<TeamSortField>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [employeeCode, setEmployeeCode] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("HiringManager");
  const [departments, setDepartments] = useState<string[]>([]);
  const [accessScopes, setAccessScopes] = useState<RequisitionAccessScope[]>([]);
  const needsScope = (role: Role) => !!org?.businessUnits?.length && (role === "HiringManager" || role === "DepartmentHead");
  const [addBusy, setAddBusy] = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [departmentBusy, setDepartmentBusy] = useState(false);
  const [departmentMessage, setDepartmentMessage] = useState("");
  const [departmentEdits, setDepartmentEdits] = useState<Record<string, string>>({});
  const [editingDepartment, setEditingDepartment] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewRow[]>([]);
  const [bulkErrors, setBulkErrors] = useState<BulkError[]>([]);

  const allDepartments = useMemo(() => [...new Set([...DEPARTMENTS, ...availableDepartments, ...users.flatMap((user) => user.departments || [])])].sort(), [availableDepartments, users]);
  const sortedUsers = useMemo(() => {
    const search = query.trim().toLowerCase();
    return users.filter((user) => {
      const draft = drafts[user.email];
      const nextRole = draft?.role || user.role;
      const nextDepartments = draft?.departments || user.departments || [];
      const matchesSearch = !search || [user.employeeCode, user.name, user.email, roleLabel(nextRole), ...nextDepartments]
        .some((value) => String(value || "").toLowerCase().includes(search));
      return matchesSearch &&
        (!roleFilter || nextRole === roleFilter) &&
        (!departmentFilter || nextDepartments.includes(departmentFilter)) &&
        (!statusFilter || (user.active ? "Active" : "Inactive") === statusFilter);
    }).sort((left, right) => {
      const leftDraft = drafts[left.email];
      const rightDraft = drafts[right.email];
      const leftValue = sortField === "employeeCode" ? leftDraft?.employeeCode || left.employeeCode || "" :
        sortField === "role" ? roleLabel(leftDraft?.role || left.role) :
          sortField === "departments" ? (leftDraft?.departments || left.departments || []).join(", ") :
            sortField === "active" ? (left.active ? "Active" : "Inactive") : left[sortField] || "";
      const rightValue = sortField === "employeeCode" ? rightDraft?.employeeCode || right.employeeCode || "" :
        sortField === "role" ? roleLabel(rightDraft?.role || right.role) :
          sortField === "departments" ? (rightDraft?.departments || right.departments || []).join(", ") :
            sortField === "active" ? (right.active ? "Active" : "Inactive") : right[sortField] || "";
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [departmentFilter, drafts, query, roleFilter, sortDirection, sortField, statusFilter, users]);

  const pageCount = Math.max(1, Math.ceil(sortedUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageUsers = sortedUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstRow = sortedUsers.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(currentPage * PAGE_SIZE, sortedUsers.length);

  function updateDraft(user: AppUser, patch: Partial<UserDraft>) {
    setDrafts((current) => ({
      ...current,
      [user.email]: {
        employeeCode: current[user.email]?.employeeCode ?? user.employeeCode ?? "",
        phone: current[user.email]?.phone ?? user.phone ?? "",
        role: current[user.email]?.role ?? user.role,
        departments: current[user.email]?.departments ?? user.departments ?? [],
        accessScopes: current[user.email]?.accessScopes ?? user.accessScopes,
        ...patch,
      },
    }));
  }

  function changeSort(field: TeamSortField) {
    if (sortField === field) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  function rowNeedsSave(user: AppUser, draft: UserDraft) {
    return draft.employeeCode.trim() !== (user.employeeCode || "") ||
      draft.phone.trim() !== (user.phone || "") ||
      draft.role !== user.role ||
      JSON.stringify(draft.accessScopes ?? []) !== JSON.stringify(user.accessScopes ?? []) ||
      !sameDepartments(draft.departments, user.departments || []);
  }

  async function saveUserAccess(user: AppUser) {
    const draft = drafts[user.email] || {
      employeeCode: user.employeeCode || "",
      phone: user.phone || "",
      role: user.role,
      departments: user.departments || [],
      accessScopes: user.accessScopes,
    };
    if (!draft.employeeCode.trim()) {
      setRowMessages((current) => ({ ...current, [user.email]: "Employee Code is required." }));
      return;
    }
    if (needsScope(draft.role) && !draft.accessScopes?.length) {
      setRowMessages((current) => ({ ...current, [user.email]: "Assign at least one access scope." }));
      return;
    }
    if (!needsScope(draft.role) && requiresDepartment(draft.role) && draft.departments.length === 0) {
      setRowMessages((current) => ({ ...current, [user.email]: "Department is required for the selected role." }));
      return;
    }
    setSavingEmail(user.email);
    setRowMessages((current) => ({ ...current, [user.email]: "" }));
    try {
      const response = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "update", employeeCode: draft.employeeCode.trim(), phone: draft.phone.trim(), name: user.name, email: user.email, role: draft.role, departments: draft.departments, accessScopes: draft.accessScopes }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update team member.");
      setDrafts((current) => { const next = { ...current }; delete next[user.email]; return next; });
      onRefresh();
    } catch (error) {
      setRowMessages((current) => ({ ...current, [user.email]: error instanceof Error ? error.message : "Could not update team member." }));
    } finally {
      setSavingEmail(null);
    }
  }

  async function addMember() {
    setAddMessage("");
    if (!employeeCode.trim() || !name.trim() || !email.trim() || !role) {
      setAddMessage("Employee Code, Employee Name, Official Email ID, and Role Access are required.");
      return;
    }
    if (needsScope(role) && !accessScopes.length) {
      setAddMessage("Assign at least one access scope.");
      return;
    }
    if (!needsScope(role) && requiresDepartment(role) && departments.length === 0) {
      setAddMessage("Department is required for the selected role.");
      return;
    }
    setAddBusy(true);
    try {
      const response = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "create", employeeCode, name, email, phone: phone.trim(), role, departments, ...(needsScope(role) ? { accessScopes } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add team member.");
      setEmployeeCode("");
      setPhone("");
      setName("");
      setEmail("");
      setRole("HiringManager");
      setDepartments([]);
      setAccessScopes([]);
      setAddMessage("Team member added.");
      onRefresh();
    } catch (error) {
      setAddMessage(error instanceof Error ? error.message : "Could not add team member.");
    } finally {
      setAddBusy(false);
    }
  }

  async function addDepartment() {
    setDepartmentMessage("");
    if (!newDepartment.trim()) {
      setDepartmentMessage("Enter a department name.");
      return;
    }
    setDepartmentBusy(true);
    try {
      const response = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addDepartment", department: newDepartment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add department.");
      setDepartmentMessage(result.alreadyExists ? "That department is already available." : "Department added and available in dropdowns.");
      setNewDepartment("");
      onRefresh();
    } catch (error) {
      setDepartmentMessage(error instanceof Error ? error.message : "Could not add department.");
    } finally {
      setDepartmentBusy(false);
    }
  }

  async function updateDepartmentName(department: DepartmentDetail) {
    const newDepartment = (departmentEdits[department.name] || department.name).trim();
    if (!newDepartment || newDepartment === department.name) return;
    setDepartmentBusy(true);
    setDepartmentMessage("");
    try {
      const response = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "editDepartment", department: department.name, newDepartment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not edit department.");
      setDepartmentMessage("Department updated.");
      setEditingDepartment(null);
      setDepartmentEdits((current) => { const next = { ...current }; delete next[department.name]; return next; });
      onRefresh();
    } catch (error) {
      setDepartmentMessage(error instanceof Error ? error.message : "Could not edit department.");
    } finally {
      setDepartmentBusy(false);
    }
  }

  async function removeDepartment(department: DepartmentDetail) {
    if (department.inUse || !window.confirm(`Remove the unused department “${department.name}”?`)) return;
    setDepartmentBusy(true);
    setDepartmentMessage("");
    try {
      const response = await apiFetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeDepartment", department: department.name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove department.");
      setDepartmentMessage("Department removed.");
      setDepartmentEdits((current) => { const next = { ...current }; delete next[department.name]; return next; });
      onRefresh();
    } catch (error) {
      setDepartmentMessage(error instanceof Error ? error.message : "Could not remove department.");
    } finally {
      setDepartmentBusy(false);
    }
  }

  function downloadTemplate() {
    const memberSheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ["", "", "", "", ""]]);
    memberSheet["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 34 }, { wch: 23 }, { wch: 48 }];
    const instructions = XLSX.utils.aoa_to_sheet([
      ["LT Recruitment Project ATS Team Access Template"],
      ["Complete every column marked *."],
      ["Department is required for Hiring Manager, Department Head, and Employee roles."],
      ["Department is optional for Admin and Recruiter roles."],
      ["Use the exact role names: Admin, Recruiter, Hiring Manager, Department Head, Employee."],
      ["List multiple departments separated by commas or semicolons."],
      ["Existing records are matched by Employee Code. Do not change the Official Email ID for an existing Employee Code."],
    ]);
    instructions["!cols"] = [{ wch: 105 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, memberSheet, "Team Members");
    XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
    downloadWorkbook(workbook, "lt-recruitment-project-team-access-template.xlsx");
  }

  async function previewImport(file?: File) {
    if (!file) return;
    setBulkBusy(true);
    setBulkMessage("");
    setBulkErrors([]);
    setBulkPreview([]);
    setBulkFileName(file.name);
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error("Choose an .xlsx or .xls workbook smaller than 5 MB.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error("The workbook has no worksheet.");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
      const members = rows.map((row, index) => {
        const values = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/\*/g, "").trim(), value]));
        const departmentKey = Object.keys(values).find((key) => key === "department" || key.startsWith("department "));
        return {
          row: index + 2,
          employeeCode: String(values["employee code"] || values.employeecode || "").trim(),
          name: String(values["employee name"] || values.name || values["full name"] || "").trim(),
          email: String(values["official email id"] || values["official email"] || values.email || "").trim(),
          role: roleFromCell(String(values["role access"] || values.role || "")),
          departments: String((departmentKey && values[departmentKey]) || values.departments || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean),
        };
      }).filter((member) => member.employeeCode || member.name || member.email || member.role);
      if (!members.length) throw new Error("No team member rows were found below the header row.");

      const response = await apiFetch("/api/team/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", members }) });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result.error || "Could not validate this workbook.");
      setBulkPreview(result.preview || []);
      setBulkErrors(result.errors || []);
      setBulkMessage(`${result.preview?.length || 0} valid row${result.preview?.length === 1 ? "" : "s"} ready to import${result.errors?.length ? `; ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} need attention` : "."}`);
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "Could not preview this workbook.");
    } finally {
      setBulkBusy(false);
    }
  }

  function downloadErrorReport() {
    if (!bulkErrors.length) return;
    const sheet = XLSX.utils.json_to_sheet(bulkErrors.map((error) => ({ "Excel Row": error.row, "Employee Code": error.employeeCode, "Official Email ID": error.email, Error: error.message })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Import Errors");
    downloadWorkbook(workbook, "lt-recruitment-project-team-import-errors.xlsx");
  }

  async function confirmImport() {
    if (!bulkPreview.length || bulkErrors.length) return;
    setBulkBusy(true);
    setBulkMessage("");
    try {
      const members = bulkPreview.map(({ row, employeeCode, name, email, role, departments }) => ({ row, employeeCode, name, email, role, departments }));
      const response = await apiFetch("/api/team/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "commit", members }) });
      const result = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(result.error || "Could not import team access.");
      setBulkErrors(result.errors || []);
      setBulkMessage(`${result.added || 0} added, ${result.updated || 0} updated${result.errors?.length ? `; ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} failed` : "."}`);
      if (!result.errors?.length) {
        setBulkPreview([]);
        setBulkFileName("");
      }
      if (result.added || result.updated) onRefresh();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : "Could not import team access.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function deactivate(user: AppUser) {
    if (!window.confirm(`Remove access for ${user.name}?`)) return;
    const response = await apiFetch(`/api/team?email=${encodeURIComponent(user.email)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) setRowMessages((current) => ({ ...current, [user.email]: result.error || "Could not remove access." }));
    else onRefresh();
  }

  function updateDepartment(user: AppUser, draft: UserDraft, department: string) {
    const next = draft.departments.includes(department)
      ? draft.departments.filter((item) => item !== department)
      : [...draft.departments, department];
    setDrafts((current) => ({ ...current, [user.email]: { ...draft, departments: next } }));
  }

  return (
    <div className="ats-team-access">
      <header className="ats-team-heading">
        <div><h2>Teams &amp; Access</h2><p>Manage employee identities, role permissions, and department access.</p></div>
        <span className="ats-team-total">{users.length} team member{users.length === 1 ? "" : "s"}</span>
      </header>

      <section className="ats-team-department-admin">
        <div><strong>Add department</strong><p>Create a department to organize team members and control access.</p></div>
        <div><input aria-label="New department name" value={newDepartment} maxLength={80} onChange={(event) => setNewDepartment(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addDepartment(); }} placeholder="Type a department name" /><button type="button" className="ats-team-save" disabled={departmentBusy || !newDepartment.trim()} onClick={() => void addDepartment()}>{departmentBusy ? "Adding…" : "Add department"}</button></div>
        {departmentMessage && <small role="status">{departmentMessage}</small>}
        {departmentDetails.length > 0 && <div className="ats-team-custom-departments"><strong>Custom departments</strong>{departmentDetails.map((department) => {
          const draftName = departmentEdits[department.name] ?? department.name;
          const changed = draftName.trim() !== department.name;
          return <div className="ats-team-custom-department" key={department.name}>
            <strong className="ats-team-custom-department-name">{department.name}</strong>
            {department.inUse ? <span className="ats-team-department-lock">In use by {department.userCount} member(s), {department.requisitionCount} requisition(s); locked</span> : editingDepartment === department.name ? <div className="ats-team-custom-department-edit"><input aria-label={`Edit department name ${department.name}`} autoFocus value={draftName} disabled={departmentBusy} onChange={(event) => setDepartmentEdits((current) => ({ ...current, [department.name]: event.target.value }))} /><button type="button" className="ats-team-save" disabled={departmentBusy || !changed || !draftName.trim()} onClick={() => void updateDepartmentName(department)}>Save</button><button type="button" className="ats-team-secondary" disabled={departmentBusy} onClick={() => { setEditingDepartment(null); setDepartmentEdits((current) => { const next = { ...current }; delete next[department.name]; return next; }); }}>Cancel</button></div> : <div><button type="button" className="ats-team-secondary" disabled={departmentBusy} onClick={() => { setDepartmentEdits((current) => ({ ...current, [department.name]: department.name })); setEditingDepartment(department.name); }}>Edit</button><button type="button" className="ats-team-remove" disabled={departmentBusy} onClick={() => void removeDepartment(department)}>Remove</button></div>}
          </div>;
        })}</div>}
      </section>

      <section className="ats-team-directory" aria-label="Team member directory">
        <div className="ats-team-toolbar">
          <div className="ats-team-search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search employee code, name, or email" aria-label="Search team members" />
          </div>
          <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }} aria-label="Filter by role"><option value="">All roles</option>{ROLES.map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select>
          <select value={departmentFilter} onChange={(event) => { setDepartmentFilter(event.target.value); setPage(1); }} aria-label="Filter by department"><option value="">All departments</option>{[...new Set([...DEPARTMENTS, ...allDepartments])].sort().map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} aria-label="Filter by status"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
        </div>
        <div className="ats-team-table-wrap"><table className="ats-team-table">
          <thead><tr>
            {([ ["employeeCode", "Employee Code"], ["name", "Employee Name"], ["email", "Official Email ID"], ["role", "Role Access"], ["departments", "Access scope"], ["active", "Status"] ] as const).map(([field, label]) => <th key={field} scope="col" aria-sort={sortField === field ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => changeSort(field)}>{label}<span aria-hidden="true">{sortField === field ? sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}
            <th scope="col">Phone</th>
            <th scope="col">Actions</th>
          </tr></thead>
          <tbody>{pageUsers.map((user) => {
            const draft = drafts[user.email] || { employeeCode: user.employeeCode || "", phone: user.phone || "", role: user.role, departments: user.departments || [], accessScopes: user.accessScopes };
            const self = user.email.toLowerCase() === currentEmail.toLowerCase();
            const changed = rowNeedsSave(user, draft);
            return <tr key={user.email}>
              <td><input className="ats-team-code-input" aria-label={`Employee Code for ${user.name}`} value={draft.employeeCode} onChange={(event) => updateDraft(user, { employeeCode: event.target.value })} placeholder="Required" /></td>
              <td className="ats-team-name">{user.name}</td>
              <td className="ats-team-email">{user.email}</td>
              <td><select className="ats-team-role-select" aria-label={`Role Access for ${user.name}`} disabled={self} value={draft.role} onChange={(event) => updateDraft(user, { role: event.target.value as Role })}>{ROLES.filter((item) => item !== "Employee" || employeeReferralsEnabled || user.role === "Employee").map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select></td>
              <td>{org && needsScope(draft.role) ? <AccessScopePicker org={org} value={draft.accessScopes || []} disabled={self} onChange={(scopes) => updateDraft(user, { accessScopes: scopes })} /> : <DepartmentPicker options={allDepartments} selected={draft.departments} required={requiresDepartment(draft.role)} disabled={self} label={`Department for ${user.name}`} onToggle={(department) => updateDepartment(user, draft, department)} />}</td>
              <td><span className={`ats-team-status${user.active ? " is-active" : " is-inactive"}`}>{user.active ? "Active" : "Inactive"}</span></td>
              <td><input className="ats-team-code-input" type="tel" inputMode="tel" aria-label={`Phone for ${user.name}`} value={draft.phone} onChange={(event) => updateDraft(user, { phone: event.target.value })} placeholder="+91 98765 43210" /></td>
              <td><div className="ats-team-row-actions">
                {changed && <button type="button" className="ats-team-save" disabled={savingEmail === user.email || !draft.employeeCode.trim() || (needsScope(draft.role) ? !draft.accessScopes?.length : requiresDepartment(draft.role) && !draft.departments.length)} onClick={() => void saveUserAccess(user)}>{savingEmail === user.email ? "Saving…" : "Save"}</button>}
                {onActAs && user.active && <button type="button" className="ats-team-secondary" onClick={() => onActAs(user)}>Act as</button>}
                {!user.active && !self && <button type="button" className="ats-team-secondary" disabled={savingEmail === user.email} onClick={() => void saveUserAccess(user)}>{savingEmail === user.email ? "Saving…" : "Reactivate"}</button>}
                {!self && user.active && <button type="button" className="ats-team-remove" onClick={() => void deactivate(user)}>Remove</button>}
                {rowMessages[user.email] && <small role="status">{rowMessages[user.email]}</small>}
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>
        {!sortedUsers.length && <p className="ats-team-empty">No team members match these filters.</p>}
        {pageCount > 1 && <nav className="ats-team-pagination" aria-label="Team member pages"><span>Showing {firstRow}–{lastRow} of {sortedUsers.length} · Page {currentPage} of {pageCount}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div></nav>}
      </section>

      <div className="ats-team-management-grid">
        <section className="ats-team-panel">
          <div className="ats-team-panel-heading"><div><span className="ats-team-eyebrow">SINGLE ENTRY</span><h3>Add team member</h3><p>Set identity and access for one employee.</p></div></div>
          <div className="ats-team-add-form">
            <label>Employee Code *<input required value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} placeholder="e.g. HB-1042" /></label>
            <label>Employee Name *<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></label>
            <label>Official Email ID *<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
            <label>Phone number<input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" /></label>
            <label>Role Access *<select required value={role} onChange={(event) => setRole(event.target.value as Role)}>{ROLES.filter((item) => item !== "Employee" || employeeReferralsEnabled).map((item) => <option key={item} value={item}>{roleLabel(item)}</option>)}</select></label>
            {org && needsScope(role) ? <div className="ats-team-add-departments"><span>Access scope *</span><AccessScopePicker org={org} value={accessScopes} onChange={setAccessScopes} /></div> : <div className="ats-team-add-departments"><span>Department{requiresDepartment(role) ? " *" : " (optional)"}</span><DepartmentPicker options={allDepartments} selected={departments} required={requiresDepartment(role)} label="Select departments" onToggle={(department) => setDepartments((current) => current.includes(department) ? current.filter((item) => item !== department) : [...current, department])} /></div>}
          </div>
          {addMessage && <p className={`ats-team-feedback${addMessage === "Team member added." ? " is-success" : " is-error"}`} role="status">{addMessage}</p>}
          <div className="ats-team-panel-actions"><button type="button" className="ats-team-save" disabled={addBusy} onClick={() => void addMember()}>{addBusy ? "Adding…" : "Add member"}</button></div>
        </section>

        <section className="ats-team-panel ats-team-bulk-panel">
          <div className="ats-team-panel-heading"><div><span className="ats-team-eyebrow">BULK MANAGEMENT</span><h3>Import team access</h3><p>Preview new members and Employee Code-matched updates before applying changes.</p></div></div>
          <div className="ats-team-bulk-actions"><button type="button" className="ats-team-secondary" onClick={downloadTemplate}>Download Excel Template</button><label className="ats-team-upload">{bulkBusy ? "Checking…" : "Upload Excel"}<input type="file" accept=".xlsx,.xls" disabled={bulkBusy} onChange={(event) => { void previewImport(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
          <p className="ats-team-template-note">Template fields: Employee Code *, Employee Name *, Official Email ID *, Role Access *, Department. Department is required for Hiring Manager, Department Head, and Employee; optional for Admin and Recruiter. Multiple departments may be separated by commas.</p>
          {bulkMessage && <p className="ats-team-feedback" role="status">{bulkMessage}</p>}
          {bulkPreview.length > 0 && <div className="ats-team-preview"><div className="ats-team-preview-heading"><strong>Preview · {bulkFileName}</strong><span>{bulkPreview.filter((row) => row.operation === "Add").length} new · {bulkPreview.filter((row) => row.operation === "Update").length} updates</span></div><div className="ats-team-preview-wrap"><table><thead><tr><th>Row</th><th>Code</th><th>Name</th><th>Official Email</th><th>Role</th><th>Department</th><th>Action / Changes</th></tr></thead><tbody>{bulkPreview.map((row) => <tr key={`${row.row}-${row.employeeCode}`}><td>{row.row}</td><td>{row.employeeCode}</td><td>{row.name}</td><td>{row.email}</td><td>{roleLabel(row.role)}</td><td>{row.departments.join(", ") || "—"}</td><td><strong>{row.operation}</strong>{row.changes.length > 0 && <small>{row.changes.map((change) => `${change.field}: ${change.before} → ${change.after}`).join("; ")}</small>}</td></tr>)}</tbody></table></div></div>}
          {bulkErrors.length > 0 && <div className="ats-team-errors"><div><strong>{bulkErrors.length} row{bulkErrors.length === 1 ? "" : "s"} need correction</strong><button type="button" className="ats-team-secondary" onClick={downloadErrorReport}>Download error report</button></div><div className="ats-team-error-list">{bulkErrors.map((error) => <p key={`${error.row}-${error.employeeCode}-${error.email}`}><strong>Row {error.row}{error.employeeCode ? ` · ${error.employeeCode}` : ""}:</strong> {error.message}</p>)}</div></div>}
          {bulkPreview.length > 0 && <div className="ats-team-panel-actions"><button type="button" className="ats-team-secondary" disabled={bulkBusy} onClick={() => { setBulkPreview([]); setBulkErrors([]); setBulkFileName(""); setBulkMessage(""); }}>Cancel preview</button><button type="button" className="ats-team-save" disabled={bulkBusy || bulkErrors.length > 0} onClick={() => void confirmImport()}>{bulkBusy ? "Importing…" : `Confirm import · ${bulkPreview.length}`}</button></div>}
        </section>
      </div>
    </div>
  );
}

function DepartmentPicker({
  options,
  selected,
  required,
  disabled = false,
  label,
  onToggle,
}: {
  options: string[];
  selected: string[];
  required: boolean;
  disabled?: boolean;
  label: string;
  onToggle: (department: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [opensUp, setOpensUp] = useState(false);
  const pickerRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const picker = pickerRef.current;
      if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) {
        picker.open = false;
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [isOpen]);
  const filteredOptions = options.filter((department) => department.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedLabel = selected.length > 2 ? `${selected.slice(0, 2).join(", ")} +${selected.length - 2} more` : selected.join(", ");
  return <details ref={pickerRef} onToggle={(event) => setIsOpen(event.currentTarget.open)} className={`ats-team-department-picker${opensUp ? " opens-up" : ""}`}><summary aria-label={label} aria-disabled={disabled} onClick={(event) => { if (disabled) { event.preventDefault(); return; } const rect = event.currentTarget.getBoundingClientRect(); setOpensUp(window.innerHeight - rect.bottom < 260 && rect.top > window.innerHeight - rect.bottom); }}><span>{selectedLabel || (required ? "Select at least one department" : "No department")}</span><span className="ats-team-chevron" aria-hidden="true" /></summary><div className="ats-team-department-menu"><input className="ats-team-department-search" type="search" aria-label="Search departments" placeholder="Search departments…" value={search} onChange={(event) => setSearch(event.target.value)} /><div className="ats-team-department-options">{filteredOptions.length ? filteredOptions.map((department) => <label key={department}><input type="checkbox" disabled={disabled} checked={selected.includes(department)} onChange={() => onToggle(department)} />{department}</label>) : <span className="ats-team-no-departments">No matching departments</span>}</div><div className="ats-team-department-footer"><button type="button" onClick={() => { if (pickerRef.current) { pickerRef.current.open = false; pickerRef.current.querySelector("summary")?.focus(); } }}>Apply</button></div></div></details>;
}
