"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Candidate, DojChangeHistory, JoiningStatus, JoiningStatusHistory } from "@/lib/types";

type JoiningRow = Candidate & {
  requisitionTitle: string;
  department: string;
  requisitionLocation: string;
  recruiterName: string;
  recruiterEmail: string;
  offerStatus: string;
  offerReleasedAt: string;
  isActive: boolean;
};

type Summary = {
  expectedJoiners: number;
  joiningThisWeek: number;
  dojRescheduled: number;
  joinedThisMonth: number;
  noShows: number;
};

type QuickFilter = "All" | "Expected Joiners" | "Upcoming" | "Joining This Week" | "Rescheduled" | "Joined" | "No-Show";
type SortField = "name" | "requisitionTitle" | "department" | "location" | "recruiterName" | "offerStatus" | "initialDoj" | "currentDoj" | "joiningStatus";
type Modal = "doj" | "history" | null;

const JOINING_STATUSES: JoiningStatus[] = ["Joined", "No-Show", "Candidate Withdrawn"];
const DOJ_REASONS = ["Notice Period Extension", "Personal Reasons", "Documentation Pending", "Business Requirement", "Other"];

function JoiningStatusMenu({ row, disabled, onSelect }: { row: JoiningRow; disabled: boolean; onSelect: (status: JoiningStatus) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const current = row.joiningStatus || "Awaiting Confirmation";
  useEffect(() => {
    if (!position) return;
    function dismiss(event: MouseEvent) { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setPosition(null); }
    function keydown(event: KeyboardEvent) { if (event.key === "Escape") { setPosition(null); trigger.current?.focus(); } }
    function scroll() { setPosition(null); }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", keydown);
    window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", keydown); window.removeEventListener("scroll", scroll, true); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className={`ats-joining-status-select is-${current.toLowerCase().replace(/[^a-z]+/g, "-")}`} aria-label={`Joining status for ${row.name}: ${current}`} aria-haspopup="menu" aria-expanded={!!position} disabled={disabled} onClick={() => { if (position) { setPosition(null); return; } const rect = trigger.current!.getBoundingClientRect(); setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 208)), top: rect.bottom + 120 > window.innerHeight ? Math.max(8, rect.top - 120) : rect.bottom + 4 }); }}><span>{current}</span><span aria-hidden="true">⌄</span></button>
    {position && createPortal(<div ref={menu} className="ats-joining-status-menu" role="menu" aria-label={`Set joining status for ${row.name}`} style={{ top: position.top, left: position.left }}>{JOINING_STATUSES.map((item) => <button type="button" role="menuitem" key={item} onClick={() => { setPosition(null); onSelect(item); }}>{item}</button>)}</div>, document.body)}
  </>;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value?: string) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function weekBounds() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return [dateKey(start), dateKey(end)];
}

export function OfferJoiningView({
  rows,
  summary,
  apiFetch,
  onOpenCandidate,
  onRefresh,
}: {
  rows: JoiningRow[];
  summary: Summary;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onOpenCandidate: (candidateId: string) => void;
  onRefresh: () => void;
}) {
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("All");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [recruiter, setRecruiter] = useState("");
  const [offerStatus, setOfferStatus] = useState("");
  const [joiningStatus, setJoiningStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState<SortField>("currentDoj");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<JoiningRow | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [revisedDoj, setRevisedDoj] = useState("");
  const [dojReason, setDojReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [history, setHistory] = useState<{ dojHistory: DojChangeHistory[]; statusHistory: JoiningStatusHistory[] }>({ dojHistory: [], statusHistory: [] });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const departments = useMemo(() => [...new Set(rows.map((row) => row.department).filter(Boolean))].sort(), [rows]);
  const locations = useMemo(() => [...new Set(rows.map((row) => row.location || row.requisitionLocation).filter(Boolean))].sort(), [rows]);
  const recruiters = useMemo(() => [...new Set(rows.map((row) => row.recruiterName).filter(Boolean))].sort(), [rows]);
  const offerStatuses = useMemo(() => [...new Set(rows.map((row) => row.offerStatus).filter(Boolean))].sort(), [rows]);

  useEffect(() => setPage(1), [quickFilter, query, department, location, recruiter, offerStatus, joiningStatus, dateFrom, dateTo, pageSize]);
  useEffect(() => setPage(1), [rows]);

  const filteredRows = rows.filter((row) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || [row.name, row.email, row.requisitionTitle, row.department, row.location, row.recruiterName]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    const active = row.isActive;
    const currentDoj = row.currentDoj || "";
    const [weekStart, weekEnd] = weekBounds();
    const today = dateKey(new Date());
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekKey = dateKey(nextWeek);
    const quickMatch = quickFilter === "All" ||
      (quickFilter === "Expected Joiners" && active) ||
      (quickFilter === "Upcoming" && active && currentDoj >= today) ||
      (quickFilter === "Joining This Week" && active && currentDoj >= weekStart && currentDoj < weekEnd) ||
      (quickFilter === "Rescheduled" && active && (row.dojChangeCount || 0) > 0) ||
      (quickFilter === "Joined" && row.joiningStatus === "Joined") ||
      (quickFilter === "No-Show" && row.joiningStatus === "No-Show");
    return matchesQuery && quickMatch &&
      (!department || row.department === department) &&
      (!location || row.location === location || row.requisitionLocation === location) &&
      (!recruiter || row.recruiterName === recruiter) &&
      (!offerStatus || row.offerStatus === offerStatus) &&
      (!joiningStatus || row.joiningStatus === joiningStatus) &&
      (!dateFrom || currentDoj >= dateFrom) &&
      (!dateTo || currentDoj <= dateTo) &&
      (quickFilter !== "Upcoming" || currentDoj < nextWeekKey);
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const leftValue = sortField === "location" ? left.location || left.requisitionLocation : left[sortField];
    const rightValue = sortField === "location" ? right.location || right.requisitionLocation : right[sortField];
    const comparison = String(leftValue || "").localeCompare(String(rightValue || ""), undefined, { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? comparison : -comparison;
  });
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visibleRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = !!(query || department || location || recruiter || offerStatus || joiningStatus || dateFrom || dateTo || quickFilter !== "All");

  function resetFilters() {
    setQuickFilter("All");
    setQuery("");
    setDepartment("");
    setLocation("");
    setRecruiter("");
    setOfferStatus("");
    setJoiningStatus("");
    setDateFrom("");
    setDateTo("");
  }

  function openUpdate(row: JoiningRow) {
    setSelected(row);
    setRevisedDoj(row.currentDoj || row.initialDoj || row.tentativeDoj || "");
    setDojReason("");
    setRemarks("");
    setError("");
    setModal("doj");
  }

  async function changeStatus(row: JoiningRow, nextStatus: JoiningStatus) {
    if (nextStatus === (row.joiningStatus || "Awaiting Confirmation")) return;
    setError("");
    setMessage("");
    setUpdatingStatusId(row.id);
    try {
      const response = await apiFetch(`/api/offer-joining/${encodeURIComponent(row.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateStatus", status: nextStatus }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update joining status.");
      setMessage("Joining status updated successfully.");
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update joining status."); }
    finally { setUpdatingStatusId(null); }
  }

  async function openHistory(row: JoiningRow) {
    setSelected(row);
    setHistoryLoading(true);
    setError("");
    setModal("history");
    try {
      const response = await apiFetch(`/api/offer-joining/${encodeURIComponent(row.id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load joining history.");
      setHistory({ dojHistory: data.dojHistory || [], statusHistory: data.statusHistory || [] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load joining history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveDoj() {
    if (!selected || !revisedDoj || !dojReason || revisedDoj === selected.currentDoj) {
      setError("Choose a different revised DOJ and a reason for the change.");
      return;
    }
    if (dojReason === "Other" && !remarks.trim()) {
      setError("Remarks are required when the reason is Other.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await apiFetch(`/api/offer-joining/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateDoj", revisedDoj, reason: dojReason, remarks }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update Date of Joining.");
      setModal(null);
      setMessage("Date of Joining updated successfully.");
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update Date of Joining.");
    } finally {
      setSaving(false);
    }
  }

  function sortBy(field: SortField) {
    if (field === sortField) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  }

  const sortButton = (field: SortField, label: string) => (
    <button type="button" className="ats-joining-sort" onClick={() => sortBy(field)}>{label}{sortField === field ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</button>
  );

  return (
    <section className="ats-offer-joining">
      <header className="ats-joining-intro">
        <div><span className="ats-joining-eyebrow">LT RECRUITMENT PROJECT · TALENT WORKSPACE</span><h2 className="ats-heading-section">Offer &amp; Joining</h2><p>Track offers, upcoming joiners, and joining progress across your organization.</p></div>
        <span className="ats-joining-count">{filteredRows.length} of {rows.length} candidates</span>
      </header>
      <div className="ats-joining-summary" aria-label="Offer and joining summary">
        <button type="button" className={quickFilter === "Expected Joiners" ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === "Expected Joiners" ? "All" : "Expected Joiners")}><span>Expected Joiners</span><strong>{summary.expectedJoiners}</strong></button>
        <button type="button" className={quickFilter === "Joining This Week" ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === "Joining This Week" ? "All" : "Joining This Week")}><span>Joining This Week</span><strong>{summary.joiningThisWeek}</strong></button>
        <button type="button" className={quickFilter === "Rescheduled" ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === "Rescheduled" ? "All" : "Rescheduled")}><span>DOJ Rescheduled</span><strong>{summary.dojRescheduled}</strong></button>
        <button type="button" className={quickFilter === "Joined" ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === "Joined" ? "All" : "Joined")}><span>Joined This Month</span><strong>{summary.joinedThisMonth}</strong></button>
        <button type="button" className={quickFilter === "No-Show" ? "is-active" : ""} onClick={() => setQuickFilter(quickFilter === "No-Show" ? "All" : "No-Show")}><span>No-Shows</span><strong>{summary.noShows}</strong></button>
      </div>
      <div className="ats-joining-quick-filters" role="group" aria-label="Quick filters">
        {(["All", "Upcoming", "Joining This Week", "Rescheduled", "Joined", "No-Show"] as QuickFilter[]).map((filter) => <button type="button" key={filter} className={quickFilter === filter ? "is-active" : ""} onClick={() => setQuickFilter(filter)}>{filter}</button>)}
      </div>
      <div className="ats-joining-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates" aria-label="Search candidate" />
        <select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department"><option value="">All departments</option>{departments.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={location} onChange={(event) => setLocation(event.target.value)} aria-label="Filter by location"><option value="">All locations</option>{locations.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={recruiter} onChange={(event) => setRecruiter(event.target.value)} aria-label="Filter by recruiter"><option value="">All recruiters</option>{recruiters.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={offerStatus} onChange={(event) => setOfferStatus(event.target.value)} aria-label="Filter by offer status"><option value="">All offer statuses</option>{offerStatuses.map((item) => <option key={item}>{item}</option>)}</select>
        <select value={joiningStatus} onChange={(event) => setJoiningStatus(event.target.value)} aria-label="Filter by joining status"><option value="">All joining statuses</option>{["Awaiting Confirmation", "Confirmed", "Rescheduled", ...JOINING_STATUSES].map((item) => <option key={item}>{item}</option>)}</select>
        <label>DOJ from<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>DOJ to<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        {hasFilters && <button type="button" className="ats-joining-clear" onClick={resetFilters}>Clear filters</button>}
      </div>
      {message && <p className="ats-joining-message" role="status">{message}<button type="button" aria-label="Dismiss message" onClick={() => setMessage("")}>×</button></p>}
      {error && !modal && <p className="ats-joining-error" role="alert">{error}</p>}
      <div className="ats-joining-table-scroll">
        <table className="ats-joining-table">
          <thead><tr>
            <th>{sortButton("name", "Candidate Name")}</th><th>{sortButton("requisitionTitle", "Job Position")}</th><th>{sortButton("department", "Department")}</th><th>{sortButton("location", "Location")}</th><th>{sortButton("recruiterName", "Assigned Recruiter")}</th><th>{sortButton("offerStatus", "Offer Status")}</th><th>{sortButton("initialDoj", "Initial DOJ")}</th><th>{sortButton("currentDoj", "Current DOJ")}</th><th className="ats-joining-fixed-status">{sortButton("joiningStatus", "Joining Status")}</th><th className="ats-joining-fixed-actions">Actions</th>
          </tr></thead>
          <tbody>{visibleRows.map((row) => (
            <tr key={row.id}>
              <td><button type="button" className="ats-joining-candidate-link" onClick={() => onOpenCandidate(row.id)}>{row.name}</button></td>
              <td>{row.requisitionTitle}</td><td>{row.department}</td><td>{row.location || row.requisitionLocation || "—"}</td><td>{row.recruiterName}</td>
              <td><span className="ats-joining-offer-status">{row.offerStatus}</span></td><td>{displayDate(row.initialDoj || row.tentativeDoj)}</td><td>{displayDate(row.currentDoj || row.initialDoj || row.tentativeDoj)}</td>
              <td className="ats-joining-fixed-status"><JoiningStatusMenu row={row} disabled={!row.isActive || updatingStatusId === row.id} onSelect={(nextStatus) => void changeStatus(row, nextStatus)} /></td>
              <td className="ats-joining-fixed-actions"><div className="ats-joining-actions"><button type="button" onClick={() => onOpenCandidate(row.id)}>View</button><button type="button" aria-label={`Update joining date for ${row.name}`} disabled={!row.isActive || !(row.currentDoj || row.initialDoj || row.tentativeDoj)} onClick={() => openUpdate(row)}>Update</button><button type="button" onClick={() => void openHistory(row)}>History</button></div></td>
            </tr>
          ))}</tbody>
        </table>
        {!visibleRows.length && <div className="ats-joining-empty">{rows.length ? "No candidates match these filters." : "No candidates are eligible for Offer & Joining yet."}</div>}
      </div>
      <footer className="ats-joining-pagination">
        <span>{sortedRows.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sortedRows.length)} of ${sortedRows.length}` : "0 candidates"}</span>
        <label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
      </footer>

      {modal && selected && (
        <div className="ats-joining-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className="ats-joining-modal" role="dialog" aria-modal="true" aria-labelledby="ats-joining-modal-title">
            <header><div><h3 id="ats-joining-modal-title">{modal === "history" ? "DOJ Change History" : "Update date of joining"}</h3><p>{selected.name} · {selected.requisitionTitle}</p></div><button type="button" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></header>
            {modal === "doj" && <div className="ats-joining-form">
              <label>Initial DOJ<input value={displayDate(selected.initialDoj || selected.tentativeDoj)} readOnly /></label>
              <label>Current DOJ<input value={displayDate(selected.currentDoj || selected.initialDoj || selected.tentativeDoj)} readOnly /></label>
              <label>Revised DOJ *<input type="date" value={revisedDoj} onChange={(event) => setRevisedDoj(event.target.value)} /></label>
              <label>Reason for Change *<select value={dojReason} onChange={(event) => setDojReason(event.target.value)}><option value="">Choose a reason</option>{DOJ_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="is-wide">Remarks{dojReason === "Other" ? " *" : ""}<textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={2000} /></label>
            </div>}
            {modal === "history" && <div className="ats-joining-history">
              {historyLoading ? <p>Loading history…</p> : <>
                <h4>DOJ Changes</h4>
                {history.dojHistory.length ? <div className="ats-joining-history-list">{history.dojHistory.map((item) => <article key={item.id}><strong>{displayDate(item.previousDoj)} → {displayDate(item.revisedDoj)}</strong><span>{item.reason}{item.remarks ? ` · ${item.remarks}` : ""}</span><small>{item.updatedBy} · {new Date(item.updatedAt).toLocaleString()}</small></article>)}</div> : <p>No DOJ changes recorded.</p>}
                <h4>Status Changes</h4>
                {history.statusHistory.length ? <div className="ats-joining-history-list">{history.statusHistory.map((item) => <article key={item.id}><strong>{item.previousStatus} → {item.newStatus}</strong><span>{[item.reason, item.remarks].filter(Boolean).join(" · ") || "—"}</span><small>{item.updatedBy} · {new Date(item.updatedAt).toLocaleString()}</small></article>)}</div> : <p>No joining status changes recorded.</p>}
              </>}
            </div>}
            {error && <p className="ats-joining-error" role="alert">{error}</p>}
            {modal !== "history" && <footer><button type="button" className="ats-joining-cancel" disabled={saving} onClick={() => setModal(null)}>Cancel</button><button type="button" className="ats-primary-button" disabled={saving} onClick={() => void saveDoj()}>{saving ? "Saving…" : "Save Changes"}</button></footer>}
          </section>
        </div>
      )}
    </section>
  );
}
