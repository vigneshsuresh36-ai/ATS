"use client";

import { useState } from "react";
import type { StatusAuditEvent } from "@/lib/statusAudit";
import { ActivityEvents } from "./ActivityHistory";
import { DateTimeField } from "./DateTimeField";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function StatusAuditReport({ apiFetch }: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [filters, setFilters] = useState({ type: "", id: "", source: "", from: "", to: "" });
  const [events, setEvents] = useState<StatusAuditEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(download = false) {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(filters);
      const activity: StatusAuditEvent[] = [];
      let cursor: string | null = null;
      do {
        if (cursor) params.set("cursor", cursor);
        const response = await apiFetch(`/api/status-audit?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load audit history.");
        activity.push(...data.activity);
        cursor = data.nextCursor;
      } while (cursor);
      setEvents(activity);
      if (download) {
        const rows = [
          ["Entity type", "Record ID", "Field", "Previous value", "New value", "Actor ID", "Actor name", "Actor role", "Acting as ID", "Acting as name", "Acting as role", "UTC timestamp", "Reason", "Source", "Correlation ID"],
          ...activity.map((event) => [
            event.entityType, event.entityId, event.field, event.previousValue, event.newValue,
            event.actor.id, event.actor.name, event.actor.role, event.actingAs?.id, event.actingAs?.name, event.actingAs?.role,
            event.changedAt, event.reason, event.source, event.correlationId,
          ]),
        ];
        const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "ats-status-audit.csv";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load audit history.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ats-activity-history">
      <summary>Status Audit</summary>
      <form className="ats-audit-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label>Entity
          <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="">All entities</option><option value="requisition">Requisition</option><option value="interview">Interview</option>
          </select>
        </label>
        <label>Record ID<input value={filters.id} onChange={(event) => setFilters({ ...filters, id: event.target.value })} /></label>
        <label>Source
          <select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}>
            <option value="">All sources</option>
            {["Manual", "API", "AI", "Automation", "System"].map((source) => <option key={source}>{source}</option>)}
          </select>
        </label>
        <label>From (UTC)<DateTimeField type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label>To (UTC)<DateTimeField type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
        <button type="submit" className="ats-primary-button" disabled={busy}>Apply filters</button>
        <button type="button" className="ats-primary-button" disabled={busy} onClick={() => void load(true)}>Export CSV</button>
      </form>
      {busy && <p role="status">Loading audit history…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && events && <ActivityEvents events={events} showEntity />}
    </details>
  );
}
