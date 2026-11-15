"use client";
import { useEffect, useState } from "react";
import type { CandidateCustomField, OrgSettings } from "@/lib/types";
export function CandidateFieldSettings({ org, apiFetch, onSaved }: { org: OrgSettings | null; apiFetch: (path: string, init?: RequestInit) => Promise<Response>; onSaved: (org: OrgSettings) => void }) {
  const [fields, setFields] = useState<CandidateCustomField[]>(org?.candidateCustomFields || []);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { setFields(org?.candidateCustomFields || []); }, [org?.candidateCustomFields]);
  function change(id: string, patch: Partial<CandidateCustomField>) { setFields((items) => items.map((f) => f.id === id ? { ...f, ...patch } : f)); }
  async function save() { setBusy(true); setMessage(""); try { const response = await apiFetch("/api/org", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setCandidateCustomFields", fields }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save fields."); onSaved(data.org); setMessage("Candidate fields saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save fields."); } finally { setBusy(false); } }
  return (
    <section className="ats-custom-field-settings">
      <header className="ats-custom-field-header"><div><span className="ats-custom-field-eyebrow">CANDIDATE FORM</span><h2>Custom fields</h2><p>Choose the additional information your team collects when adding a candidate.</p></div><span className="ats-custom-field-count">{fields.filter((field) => field.enabled).length} active</span></header>
      <div className="ats-custom-field-content">
        {fields.length === 0 && <div className="ats-custom-field-empty"><strong>No custom fields yet</strong><span>Add a field such as highest qualification or certification.</span></div>}
        {fields.map((field, index) => <div className={`ats-custom-field-row${field.enabled ? "" : " is-disabled"}`} key={field.id}>
          <div className="ats-custom-field-row-head"><strong>Field {index + 1}</strong><button type="button" className="ats-custom-field-remove" onClick={() => setFields((items) => items.filter((item) => item.id !== field.id))} aria-label={`Remove ${field.label || `field ${index + 1}`}`}>Remove</button></div>
          <label className="ats-custom-field-name">Field name<input value={field.label} maxLength={80} onChange={(event) => change(field.id, { label: event.target.value })} placeholder="e.g. Highest qualification" /></label>
          <div className="ats-custom-field-options"><label><input type="checkbox" checked={field.required} onChange={(event) => change(field.id, { required: event.target.checked })} /><span><strong>Required</strong><small>Must be completed when adding a candidate</small></span></label><label><input type="checkbox" checked={field.enabled} onChange={(event) => change(field.id, { enabled: event.target.checked })} /><span><strong>Enabled</strong><small>Show this field on the candidate form</small></span></label></div>
        </div>)}
        <div className="ats-custom-field-actions"><button type="button" className="ats-custom-add" disabled={fields.length >= 30} onClick={() => setFields([...fields, { id: crypto.randomUUID(), label: "", required: false, enabled: true }])}>+ Add field</button><button type="button" className="ats-primary-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button></div>
        <p className="ats-custom-field-hint">Disabled fields no longer appear on the form. Previously saved answers remain on candidate profiles.</p>{message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
