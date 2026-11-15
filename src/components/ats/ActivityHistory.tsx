"use client";

import { useState } from "react";
import type { StatusAuditEvent } from "@/lib/statusAudit";

const localTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

function statusLabel(event: StatusAuditEvent, value: StatusAuditEvent["newValue"]) {
  if ((event.field === "recruiterEmail" || event.field === "recruiterCollaboratorEmails")) return value === null ? "Unassigned" : String(value);
  if (value === null) return "Created";
  const label = String(value).replace(/([a-z])([A-Z])/g, "$1 $2");
  return event.entityType === "interview" ? `Interview ${label}` : label;
}

export function ActivityEvents({ events, showEntity = false }: { events: StatusAuditEvent[]; showEntity?: boolean }) {
  if (!events.length) return <p>No audited changes yet.</p>;
  return (
    <ol className="ats-activity-events">
      {events.map((event) => (
        <li key={event.id}>
          {showEntity && <p>{event.entityType} · {event.entityId}</p>}
          <strong>{(event.field === "recruiterEmail" || event.field === "recruiterCollaboratorEmails") && (event.field === "recruiterEmail" ? "Primary recruiter · " : "Recruiter collaborators · ")}{statusLabel(event, event.previousValue)} → {statusLabel(event, event.newValue)}</strong>
          <dl>
            <div><dt>Changed by</dt><dd>{event.actor.name} ({event.actor.role}){event.actingAs && ` acting as ${event.actingAs.name}`}</dd></div>
            <div><dt>Date</dt><dd><time dateTime={event.changedAt}>{localTime.format(new Date(event.changedAt))}</time></dd></div>
            <div><dt>Reason</dt><dd>{event.reason}</dd></div>
            <div><dt>Source</dt><dd>{event.source}</dd></div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function ActivityHistory({ path, apiFetch }: {
  path: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [events, setEvents] = useState<StatusAuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(path);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load activity history.");
      setEvents(result.activity);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load activity history.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="ats-activity-history" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
      <summary>Activity History</summary>
      {busy ? <p role="status">Loading activity…</p> : error ? <p role="alert">{error}</p> : <ActivityEvents events={events} />}
    </details>
  );
}
