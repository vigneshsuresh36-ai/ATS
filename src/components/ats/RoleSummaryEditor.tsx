"use client";
import { useState } from "react";
import type { Requisition } from "@/lib/types";
import { DEPARTMENTS, LOCATIONS } from "@/lib/roles";

export function RoleSummaryEditor({ req, apiFetch, onCancel, onSaved, officeLocations = [] }: { req: Requisition; apiFetch: (path: string, init?: RequestInit) => Promise<Response>; onCancel: () => void; onSaved: () => void; officeLocations?: { name: string; city?: string }[] }) {
  const [draft, setDraft] = useState({ department: req.department, location: req.location, employment: req.employment, level: req.level, priority: req.priority, salaryMin: String(req.salaryMin ?? 0), salaryMax: String(req.salaryMax ?? 0), openings: String(req.openings) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const salaryMin = Number(draft.salaryMin), salaryMax = Number(draft.salaryMax), openings = Number(draft.openings);
    if (![salaryMin, salaryMax, openings].every(Number.isSafeInteger) || salaryMin < 0 || salaryMax < salaryMin || openings < 1) { setError("Enter a valid salary range and a positive number of openings."); return; }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/requisitions/${req.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateRoleSummary", ...draft, salaryMin, salaryMax, openings }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save role details.");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save role details."); }
    finally { setBusy(false); }
  }
  return <form className="ats-role-summary-form" onSubmit={save}>
    <label>Department<select required value={draft.department} onChange={(e) => update("department", e.target.value)}>{[...new Set([draft.department, ...DEPARTMENTS])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}</select></label>
    <label>Location<input required list="ats-role-location-options" value={draft.location} onChange={(e) => update("location", e.target.value)} /><datalist id="ats-role-location-options">{[...new Set([...LOCATIONS, ...officeLocations.map((office) => office.city ? `${office.name} · ${office.city}` : office.name)])].map((v) => <option key={v} value={v} />)}</datalist></label>
    <label>Employment<select required value={draft.employment} onChange={(e) => update("employment", e.target.value)}>{[...new Set([draft.employment, "Full-time", "Contract", "Intern"])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}</select></label>
    <label>Experience<input required value={draft.level} onChange={(e) => update("level", e.target.value)} placeholder="e.g. 2-5 years" /></label>
    <label>Salary from (₹)<input required type="number" min="0" step="1" value={draft.salaryMin} onChange={(e) => update("salaryMin", e.target.value)} /></label>
    <label>Salary to (₹)<input required type="number" min="0" step="1" value={draft.salaryMax} onChange={(e) => update("salaryMax", e.target.value)} /></label>
    <label>Joining timeline<input required value={draft.priority} onChange={(e) => update("priority", e.target.value)} placeholder="e.g. 15-30 days" /></label>
    <label>Openings<input required type="number" min="1" step="1" value={draft.openings} onChange={(e) => update("openings", e.target.value)} /></label>
    <p className="ats-role-summary-owner">Hiring manager: {req.raisedByName} · The request owner remains unchanged.</p>
    {error && <p className="ats-role-summary-error" role="alert">{error}</p>}
    <div className="ats-role-summary-buttons"><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
  </form>;
}
