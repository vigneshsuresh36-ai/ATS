"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/dateFormat";
import { formatSalaryRange } from "@/lib/salaryFormat";
import { canRecruit } from "@/lib/roles";
import { Chip, prettyStatus, statusColor } from "./ui";
import type { ApprovalStatus, Requisition, Role } from "@/lib/types";

const STATUS_TRANSITIONS: Partial<Record<ApprovalStatus, ApprovalStatus[]>> = {
  Approved: ["On Hold", "Position Closed"],
  "On Hold": ["Position Reopened", "Position Closed"],
  "Position Reopened": ["On Hold", "Position Closed"],
};

export function ReqBoard({
  reqs,
  onOpen,
  role,
  onStatusChange,
}: {
  reqs: (Requisition & {
    candidateCount?: number;
  })[];
  onOpen: (id: string) => void;
  role: Role;
  onStatusChange?: (id: string, status: ApprovalStatus) => Promise<Requisition>;
}) {
  const [rows, setRows] = useState(reqs);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => setRows(reqs), [reqs]);

  const departments = [...new Set(rows.map((row) => row.department).filter(Boolean))].sort();
  const locations = [...new Set(rows.flatMap((row) => row.location.split(",").map((item) => item.trim())).filter(Boolean))].sort();
  const statuses = [...new Set(rows.map((row) => row.status))].sort();
  const filteredRows = rows.filter((row) => {
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || [row.id, row.title, row.raisedByName, row.raisedByEmail, row.department, row.location]
      .some((value) => String(value || "").toLowerCase().includes(search));
    return matchesSearch &&
      (!departmentFilter || row.department === departmentFilter) &&
      (!locationFilter || row.location.split(",").some((location) => location.trim() === locationFilter)) &&
      (!statusFilter || row.status === statusFilter);
  });

  function canChangeStatus(status: ApprovalStatus) {
    return !!STATUS_TRANSITIONS[status]?.length && (role === "Admin" || canRecruit(role)) && !!onStatusChange;
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
    const previousStatus = requisition.status;
    setUpdatingId(requisition.id);
    setRows((current) =>
      current.map((row) =>
        row.id === requisition.id ? { ...row, status } : row
      )
    );
    try {
      const updated = await onStatusChange(requisition.id, status);
      setRows((current) =>
        current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
      );
    } catch (error) {
      setRows((current) =>
        current.map((row) =>
          row.id === requisition.id ? { ...row, status: previousStatus } : row
        )
      );
      window.alert(error instanceof Error ? error.message : "Could not update status.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="ats-req-board">
      <div className="ats-req-board-head">
        <h2 className="ats-heading-section">Requisitions</h2>
        <span className="ats-req-count">
          {filteredRows.length === rows.length
            ? `${rows.filter((row) => ["Approved", "Position Reopened", "Partially Fulfilled"].includes(row.status)).reduce((sum, row) => sum + Math.max(0, row.openings || 0), 0)} open positions · ${rows.length} requisitions`
            : `${filteredRows.length} of ${rows.length}`}
        </span>
      </div>
      {reqs.length === 0 ? (
        <p className="ats-muted">
          No requisitions yet.
          {role === "HiringManager" && " Raise one with + New requisition."}
        </p>
      ) : (
        <>
        <div className="ats-req-filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requisitions, owners, departments..."
            aria-label="Search requisitions"
          />
          <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {departments.map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
          <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Filter by location">
            <option value="">All locations</option>
            {locations.map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status === "Approved" ? "Open" : prettyStatus(status)}</option>)}
          </select>
          {(query || departmentFilter || locationFilter || statusFilter) && (
            <button type="button" className="ats-filter-clear" onClick={() => {
              setQuery("");
              setDepartmentFilter("");
              setLocationFilter("");
              setStatusFilter("");
            }}>Clear</button>
          )}
        </div>
        <div className="ats-table-wrap">
          <table className="ats-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
                <th>Department</th>
                <th>Location</th>
                <th>HM</th>
                <th>Exp</th>
                <th>Salary</th>
                <th className="num">Openings</th>
                <th className="num">Candidates</th>
                <th>Raised</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} onClick={() => onOpen(r.id)}>
                  <td className="mono">{r.id}</td>
                  <td className="title">{r.title}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {canChangeStatus(r.status) ? (
                      <div style={{ position: "relative", display: "inline-block" }}>
                        <button
                          type="button"
                          disabled={updatingId === r.id}
                          onClick={(event) => {
                            const nextOpen = openStatusId === r.id ? null : r.id;
                            setOpenStatusId(nextOpen);
                            setMenuPosition(
                              nextOpen
                                ? {
                                    top: event.currentTarget.getBoundingClientRect().bottom + 6,
                                    left: event.currentTarget.getBoundingClientRect().left,
                                  }
                                : null
                            );
                          }}
                          aria-haspopup="menu"
                          aria-expanded={openStatusId === r.id}
                          style={{
                            border: 0,
                            padding: 0,
                            background: "transparent",
                            cursor: updatingId === r.id ? "wait" : "pointer",
                          }}
                        >
                          <Chip color={statusColor(r.status)}>
                            {r.status === "Approved" ? "Open" : prettyStatus(r.status)} ▼
                          </Chip>
                        </button>
                        {openStatusId === r.id && (
                          <div
                            role="menu"
                            onClick={(event) => event.stopPropagation()}
                            style={{
                              position: "fixed",
                              top: menuPosition?.top,
                              left: menuPosition?.left,
                              zIndex: 10,
                              minWidth: 150,
                              padding: 4,
                              background: "#fff",
                              border: "1px solid #e1ddd4",
                              borderRadius: 8,
                              boxShadow: "0 8px 20px rgba(40, 35, 25, .14)",
                            }}
                          >
                            {(STATUS_TRANSITIONS[r.status] || []).map((status) => (
                              <button
                                key={status}
                                type="button"
                                role="menuitem"
                                onClick={(event) => changeStatus(event, r, status)}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  padding: "7px 9px",
                                  border: 0,
                                  borderRadius: 5,
                                  background:
                                    status === r.status ? "#f4f1eb" : "transparent",
                                  color: statusColor(status),
                                  textAlign: "left",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Chip color={statusColor(r.status)}>
                        {r.status === "Approved" ? "Open" : prettyStatus(r.status)}
                      </Chip>
                    )}
                  </td>
                  <td>{r.department}</td>
                  <td className="loc">{r.location || "—"}</td>
                  <td>{r.raisedByName}</td>
                  <td className="nowrap">{r.level || "—"}</td>
                  <td className="nowrap">
                    {formatSalaryRange(r.salaryMin, r.salaryMax)}
                  </td>
                  <td className="num">{r.openings}</td>
                  <td className="num candidates">{r.candidateCount ?? 0}</td>
                  <td className="nowrap">
                    {r.createdAt
                      ? formatDate(r.createdAt)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length === 0 && <div className="ats-filter-empty">No requisitions match these filters.</div>}
        </>
      )}
      <p className="ats-hint">
        Click a row to open requisition details and hiring process.
      </p>
    </div>
  );
}

