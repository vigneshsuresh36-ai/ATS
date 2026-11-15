"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { canRecruit } from "@/lib/roles";
import { canEditRequisitionPriority, isRequisitionClosed } from "@/lib/requisitionStatus";
import { joiningCountdownLabel, joiningTimeline } from "@/lib/joiningTimeline";
import { Chip, prettyStatus, statusColor } from "./ui";
import type { ApprovalStatus, Requisition, Role } from "@/lib/types";
import type { ReactNode } from "react";

const STATUS_TRANSITIONS: Partial<Record<ApprovalStatus, ApprovalStatus[]>> = {
  Approved: ["On Hold", "Position Closed"],
  "On Hold": ["Position Reopened", "Position Closed"],
  "Position Reopened": ["On Hold", "Position Closed"],
};

type SortField = "title" | "id" | "department" | "location" | "raisedByName" | "openings" | "candidateCount" | "priorityLevel" | "status" | "createdAt";

function priorityLabel(requisition: Requisition, role: Role) {
  if (requisition.status === "PendingApproval" || requisition.status === "Rejected") return "—";
  if (!isRequisitionClosed(requisition.status) && ["P1", "P2", "P3", "P4"].includes(requisition.priorityLevel || "")) return requisition.priorityLevel!;
  if (role === "DepartmentHead" && ["P1", "P2", "P3", "P4"].includes(requisition.previousPriorityLevel || "")) return `${requisition.previousPriorityLevel} (previous)`;
  return isRequisitionClosed(requisition.status) ? "—" : "Not set";
}

export function ReqBoard({
  heading,
  reqs,
  onOpen,
  role,
  onStatusChange,
  onPriorityChange,
}: {
  heading?: ReactNode;
  reqs: (Requisition & {
    candidateCount?: number;
  })[];
  onOpen: (id: string) => void;
  role: Role;
  onStatusChange?: (id: string, status: ApprovalStatus, reason: string) => Promise<Requisition>;
  onPriorityChange?: (id: string, priorityLevel: string) => Promise<Requisition>;
}) {
  const [rows, setRows] = useState(reqs);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const showPriority = role !== "DepartmentHead" && role !== "HiringManager";
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    setRows(reqs);
    setPage(1);
  }, [reqs]);

  useEffect(() => setPage(1), [query, departmentFilter, locationFilter, statusFilter, priorityFilter]);

  useEffect(() => {
    if (!openStatusId) return;
    const close = () => { setOpenStatusId(null); setMenuPosition(null); };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".ats-req-status-menu, .ats-req-status-button")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openStatusId]);

  const departments = [...new Set(rows.map((row) => row.department).filter(Boolean))].sort();
  const locations = [...new Set(rows.flatMap((row) => row.location.split(",").map((item) => item.trim())).filter(Boolean))].sort();
  const statuses = [...new Set(rows.map((row) => row.status))].sort();
  const priorities = [...new Set(rows.map((row) => priorityLabel(row, role)))].sort();
  const filteredRows = rows.filter((row) => {
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || [row.id, row.title, row.raisedByName, row.raisedByEmail, row.department, row.location]
      .some((value) => String(value || "").toLowerCase().includes(search));
    return matchesSearch &&
      (!departmentFilter || row.department === departmentFilter) &&
      (!locationFilter || row.location.split(",").some((location) => location.trim() === locationFilter)) &&
      (!statusFilter || row.status === statusFilter) &&
      (!showPriority || !priorityFilter || priorityLabel(row, role) === priorityFilter);
  });
  const sortedRows = [...filteredRows].sort((a, b) => {
    let comparison: number;
    if (sortField === "openings" || sortField === "candidateCount") {
      const left = sortField === "openings" ? a.openings : a.candidateCount || 0;
      const right = sortField === "openings" ? b.openings : b.candidateCount || 0;
      comparison = left - right;
    } else {
      const left = sortField === "priorityLevel" ? priorityLabel(a, role) : a[sortField] || "";
      const right = sortField === "priorityLevel" ? priorityLabel(b, role) : b[sortField] || "";
      comparison = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visibleRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const firstVisibleRow = sortedRows.length ? (page - 1) * pageSize + 1 : 0;
  const lastVisibleRow = Math.min(page * pageSize, sortedRows.length);
  const openPositions = rows
    .filter((row) => ["Approved", "Position Reopened", "Partially Fulfilled"].includes(row.status))
    .reduce((sum, row) => sum + Math.max(0, row.openings || 0), 0);
  const candidateTotal = rows.reduce((sum, row) => sum + (row.candidateCount || 0), 0);
  const pendingCount = rows.filter((row) => row.status === "PendingApproval").length;
  const fulfilledCount = rows.filter((row) => row.status === "Position Fulfilled").length;

  function canChangeStatus(status: ApprovalStatus) {
    return !!STATUS_TRANSITIONS[status]?.length && (role === "Admin" || canRecruit(role)) && !!onStatusChange;
  }

  function changeSort(field: SortField) {
    if (field === sortField) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  async function changeStatus(
    event: React.MouseEvent,
    requisition: (typeof rows)[number],
    status: ApprovalStatus
  ) {
    event.stopPropagation();
    setOpenStatusId(null);
    setMenuPosition(null);
    if (!onStatusChange) return;
    if (
      status === "Position Closed" &&
      !window.confirm(
        "Are you sure you want to close this position? This will mark the requisition as no longer active."
      )
    ) {
      return;
    }
    const reason = window.prompt(`Reason for changing this requisition to ${status}:`)?.trim();
    if (!reason) return;
    if (reason.length > 500) { window.alert("Use a reason of up to 500 characters."); return; }
    const previousStatus = requisition.status;
    const previousPriorityLevel = requisition.priorityLevel;
    setUpdatingId(requisition.id);
    setRows((current) =>
      current.map((row) =>
        row.id === requisition.id
          ? { ...row, status, ...(isRequisitionClosed(status) ? { priorityLevel: "-" } : {}) }
          : row
      )
    );
    try {
      const updated = await onStatusChange(requisition.id, status, reason);
      setRows((current) =>
        current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
      );
    } catch (error) {
      setRows((current) =>
        current.map((row) =>
          row.id === requisition.id
            ? { ...row, status: previousStatus, priorityLevel: previousPriorityLevel }
            : row
        )
      );
      window.alert(error instanceof Error ? error.message : "Could not update status.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function changePriority(event: React.ChangeEvent<HTMLSelectElement>, requisition: (typeof rows)[number]) {
    event.stopPropagation();
    const priorityLevel = event.target.value;
    if (!onPriorityChange || !["P1", "P2", "P3", "P4"].includes(priorityLevel)) return;
    const previousPriorityLevel = requisition.priorityLevel;
    setUpdatingId(requisition.id);
    setRows((current) => current.map((row) => row.id === requisition.id ? { ...row, priorityLevel } : row));
    try {
      const updated = await onPriorityChange(requisition.id, priorityLevel);
      setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
    } catch (error) {
      setRows((current) => current.map((row) => row.id === requisition.id ? { ...row, priorityLevel: previousPriorityLevel } : row));
      window.alert(error instanceof Error ? error.message : "Could not update priority.");
    } finally {
      setUpdatingId(null);
    }
  }

  const filters = (
    <aside className="ats-req-filters" aria-label="Filter and sort hiring requests">
      <div className="ats-req-filter-heading"><strong>Filters</strong>{(query || departmentFilter || locationFilter || statusFilter || priorityFilter) && <button type="button" className="ats-filter-clear" onClick={() => { setQuery(""); setDepartmentFilter(""); setLocationFilter(""); setStatusFilter(""); setPriorityFilter(""); }}>Reset all</button>}</div>
      <label>Search
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search requisitions, owners, departments..."
        aria-label="Search requisitions"
      /></label>
      <label>Department
      <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
        <option value="">All departments</option>
        {departments.map((department) => <option key={department} value={department}>{department}</option>)}
      </select></label>
      <label>Location
      <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Filter by location">
        <option value="">All locations</option>
        {locations.map((location) => <option key={location} value={location}>{location}</option>)}
      </select></label>
      <label>Status
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>
        {statuses.map((status) => <option key={status} value={status}>{status === "Approved" ? "Open" : prettyStatus(status)}</option>)}
      </select></label>
      {showPriority && <label>Priority
      <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filter by priority">
        <option value="">All priorities</option>
        {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
      </select></label>}
      <label>Sort by<select value={sortField} onChange={(event) => { setSortField(event.target.value as SortField); setPage(1); }} aria-label="Sort requisitions">
        {([ ["title", "Job title"], ["id", "Requisition ID"], ["department", "Department"], ["location", "Location"], ["raisedByName", "Hiring manager"], ["openings", "Openings"], ["candidateCount", "Candidates"], ["priorityLevel", "Priority"], ["status", "Status"], ["createdAt", "Date created"] ] as const).filter(([value]) => showPriority || value !== "priorityLevel").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button type="button" className="ats-req-sort-direction" onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")} aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}>Sort order: {sortDirection === "asc" ? "Ascending ↑" : "Descending ↓"}</button>
    </aside>
  );

  return (
    <div className="ats-req-board">
      <div className="ats-req-sticky">
        {heading}
      <div className="ats-req-intro">
        <div>
          <span className="ats-req-eyebrow">LT RECRUITMENT PROJECT · TALENT WORKSPACE</span>
          <h2 className="ats-heading-section">Requisitions</h2>
          <p>Keep every role, hiring team, and candidate pipeline in view.</p>
        </div>
        <span className="ats-req-count">{filteredRows.length} of {rows.length} roles</span>
      </div>
      <div className="ats-req-overview" aria-label="Requisition overview">
        <div><span className={`ats-req-metric-dot${openPositions === 0 ? " is-zero" : ""}`} aria-hidden="true" /><strong>{openPositions}</strong><span>Open positions</span><small>Approved roles accepting candidates</small></div>
        <div><span className={`ats-req-metric-dot${candidateTotal === 0 ? " is-zero" : ""}`} aria-hidden="true" /><strong>{candidateTotal}</strong><span>Candidate pipeline</span><small>Across all requisitions</small></div>
        <div><span className={`ats-req-metric-dot${pendingCount === 0 ? " is-zero" : ""}`} aria-hidden="true" /><strong>{pendingCount}</strong><span>Pending approvals</span><small>Waiting for a department decision</small></div>
        <div><span className={`ats-req-metric-dot${fulfilledCount === 0 ? " is-zero" : ""}`} aria-hidden="true" /><strong>{fulfilledCount}</strong><span>Positions fulfilled</span><small>Requisitions marked fulfilled</small></div>
      </div>
      {reqs.length > 0 && <div className="ats-req-layout">{filters}</div>}
      </div>
      {reqs.length === 0 ? (
        <div className="ats-req-empty">
          <span className="ats-req-empty-mark" aria-hidden="true">HB</span>
          <h3>No requisitions yet</h3>
          <p>{role === "HiringManager" ? "Raise a new role to start building your candidate pipeline." : "New roles will appear here as they enter the hiring process."}</p>
        </div>
      ) : (
        <div className="ats-req-layout">
        <div className="ats-req-results">
        <div className="ats-req-table-toolbar">
          <div><strong>All hiring requests</strong><span>Showing {firstVisibleRow}–{lastVisibleRow} of {sortedRows.length}</span></div>
        </div>
        <div className="ats-req-table-wrap">
          <table className={`ats-req-table${showPriority ? "" : " ats-req-table-no-priority"}`}>
            <thead><tr>
              {([
                ["title", "Role / Requisition"], ["department", "Department"], ["location", "Location"], ["raisedByName", "Hiring manager"], ["openings", "Openings"], ["candidateCount", "Candidates"], ["priorityLevel", "Priority"], ["status", "Status"],
              ] as const).filter(([field]) => showPriority || field !== "priorityLevel").map(([field, label]) => (
                <th key={field} className={field === "priorityLevel" ? "ats-req-fixed-priority" : field === "status" ? "ats-req-fixed-status" : undefined} scope="col" aria-sort={sortField === field ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort(field)}>{label}<span aria-hidden="true">{sortField === field ? sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</span></button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {visibleRows.map((r) => (
                <tr key={r.id} className="ats-req-table-row" tabIndex={0} aria-label={`Open requisition ${r.title}, ${r.id}`} onClick={() => onOpen(r.id)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(r.id); } }}>
                  <td className="ats-req-table-title"><strong>{r.title}</strong><span className="ats-req-role-id">{r.id}</span>{(() => { const target = joiningTimeline(r); return target && target.status !== "on-track" ? <span className={`ats-joining-target is-${target.status}`} data-due-today={target.remainingDays === 0 ? "" : undefined}>{joiningCountdownLabel(target.remainingDays)}</span> : null; })()}</td>
                  <td>{r.department || "—"}</td><td title={r.location || undefined}>{(r.location || "").split(",").filter((city) => city.trim()).length > 1 ? "Multiple" : r.location || "—"}</td>
                  <td><div className="ats-req-manager"><span aria-hidden="true">{(r.raisedByName || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div><strong>{r.raisedByName || "Unassigned"}</strong><small>Hiring manager</small></div></div></td>
                  <td className="ats-req-table-number">{r.openings}</td><td className="ats-req-table-number">{r.candidateCount ?? 0}</td>
                  {showPriority && <td className="ats-req-fixed-priority" onClick={(event) => event.stopPropagation()}>{isRequisitionClosed(r.status) || r.status === "PendingApproval" || r.status === "Rejected" ? <span className="ats-req-table-muted">{priorityLabel(r, role)}</span> : role === "Admin" && onPriorityChange && canEditRequisitionPriority(r.status) ? <select className="ats-req-priority-select" value={["P1", "P2", "P3", "P4"].includes(r.priorityLevel || "") ? r.priorityLevel : ""} onChange={(event) => void changePriority(event, r)} disabled={updatingId === r.id} aria-label={`Priority for ${r.title}`}><option value="" disabled>Set priority</option>{["P1", "P2", "P3", "P4"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select> : <span className="ats-req-priority-value">{priorityLabel(r, role)}</span>}</td>}
                  <td className="ats-req-fixed-status" onClick={(event) => event.stopPropagation()}>
                    {canChangeStatus(r.status) ? (
                      <button type="button" className="ats-req-status-button" disabled={updatingId === r.id} onClick={(event) => {
                        const nextOpen = openStatusId === r.id ? null : r.id;
                        setOpenStatusId(nextOpen);
                        const rect = event.currentTarget.getBoundingClientRect();
                        const menuHeight = (STATUS_TRANSITIONS[r.status]?.length || 0) * 34 + 8;
                        setMenuPosition(nextOpen ? { top: rect.bottom + 6 + menuHeight > window.innerHeight ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 168)) } : null);
                      }} aria-haspopup="menu" aria-expanded={openStatusId === r.id}>
                        <Chip color={statusColor(r.status)}>{r.status === "Approved" ? "Open" : prettyStatus(r.status)} <span aria-hidden="true">⌄</span></Chip>
                      </button>
                    ) : <Chip color={statusColor(r.status)}>{r.status === "Approved" ? "Open" : prettyStatus(r.status)}</Chip>}
                    {openStatusId === r.id && menuPosition && createPortal(<div role="menu" className="ats-req-status-menu" style={{ top: menuPosition.top, left: menuPosition.left }}>{(STATUS_TRANSITIONS[r.status] || []).map((status) => <button key={status} type="button" role="menuitem" onClick={(event) => changeStatus(event, r, status)}>{status}</button>)}</div>, document.body)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length === 0 && <div className="ats-filter-empty">No requisitions match these filters.</div>}
        {sortedRows.length > 0 && <nav className="ats-req-pagination" aria-label="Requisition table pages"><span>Page {page} of {pageCount}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button></div></nav>}
        </div>
        </div>
      )}
    </div>
  );
}

