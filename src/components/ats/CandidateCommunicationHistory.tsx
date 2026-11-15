"use client";
import { useState } from "react";

type Entry = { id: string; title: string; subject: string; recipients: string[]; status: string; updatedAt: string };
export function CandidateCommunicationHistory({ candidateId, apiFetch }: { candidateId: string; apiFetch: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/automations?candidateId=${encodeURIComponent(candidateId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load communication history.");
      setEntries(data.tasks || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load communication history."); }
    finally { setBusy(false); }
  }
  return <details className="ats-communication-history" onToggle={(event) => { if (event.currentTarget.open && entries === null && !busy) void load(); }}><summary>Automated communication history</summary><p>Messages and drafts from your LT Recruitment Project automations. Other channels and messages sent outside LT Recruitment Project are not shown.</p>{busy && <p role="status">Loading…</p>}{error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}{entries && (entries.length ? <ul>{entries.map((entry) => <li key={entry.id}><div><strong>{entry.subject || entry.title}</strong><small>To: {entry.recipients.join(", ") || "No recipient"} · {new Date(entry.updatedAt).toLocaleString()}</small></div><span>{entry.status === "sent" ? "Submitted to email provider" : entry.status}</span></li>)}</ul> : <p>No automated email activity for this candidate.</p>)}</details>;
}
