"use client";
import { useEffect, useRef, useState } from "react";
import { CALL_OUTCOMES, dialNumber, displayNumber, type CallOutcome } from "@/lib/callLog";
import { formatDateTime } from "@/lib/dateFormat";
import { MESSAGE_FOR_OUTCOME, MESSAGE_LABELS, buildMessage, mailLink, whatsappLink, type MessageKind } from "@/lib/messageTemplates";

type CallEntry = { id: string; type?: string; outcome: string; note: string; author: string; createdAt: string };
type Props = {
  candidate: { id: string; name: string; phone?: string; email?: string; stage: string };
  roleTitle?: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** "icon" is the compact pipeline-row button. */
  variant?: "default" | "compact" | "icon";
};
const NO_CALL_STAGES = ["Rejected", "Social CV Reject", "Candidate Backed Out"];

export function CallCandidate({ candidate, apiFetch, roleTitle, variant = "default" }: Props) {
  const [kind, setKind] = useState<MessageKind | "">("");
  const [draft, setDraft] = useState("");
  function pickKind(next: MessageKind) { setKind(next); setDraft(buildMessage(next, { name: candidate.name, role: roleTitle })); }
  const dial = dialNumber(candidate.phone);
  const blocked = NO_CALL_STAGES.includes(candidate.stage);
  const disabledReason = !dial ? "No phone number on file" : blocked ? "Candidate is no longer in the process" : "";
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome>("Connected");
  const [note, setNote] = useState("");
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    apiFetch(`/api/candidates/${candidate.id}/calls`).then(async (response) => {
      const result = await response.json();
      if (response.ok && active) setCalls(result.calls);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [open, apiFetch, candidate.id]);

  function close() { setOpen(false); setError(""); setNote(""); setOutcome("Connected"); setCopied(false); setQr(""); setKind(""); setDraft(""); }
  async function copyNumber() {
    try { await navigator.clipboard.writeText(dial); setCopied(true); } catch { setError("Could not copy. Select the number and copy it manually."); }
  }
  async function toggleQr() {
    if (qr) { setQr(""); return; }
    try {
      const QRCode = (await import("qrcode")).default;
      setQr(await QRCode.toDataURL(`tel:${dial}`, { margin: 1, width: 220 }));
    } catch { setError("Could not create the QR code."); }
  }
  async function save() {
    setSaving(true); setError("");
    try {
      const response = await apiFetch(`/api/candidates/${candidate.id}/calls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome, note }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the call.");
      setCalls((previous) => [result.call, ...previous]);
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the call."); }
    finally { setSaving(false); }
  }

  return <>
    <button type="button" className={`ats-call-btn${variant === "compact" ? " is-compact" : ""}${variant === "icon" ? " is-icon" : ""}`} disabled={!!disabledReason} title={disabledReason || `Call ${candidate.name}`} aria-label={`Call ${candidate.name}`} onClick={() => setOpen(true)}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>{variant === "icon" ? null : "Call"}
    </button>
    <dialog ref={dialog} className="ats-call-dialog" aria-labelledby={`call-title-${candidate.id}`} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      {open && <div className="ats-call-body">
        <h3 id={`call-title-${candidate.id}`}>Call candidate</h3>
        <p className="ats-call-sub">The call goes through your own phone. It does not cost the company anything.</p>
        <div className="ats-call-who"><span className="ats-call-avatar">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{candidate.name}</strong><small>{displayNumber(dial)}</small></span></div>
        <a className="ats-call-now" href={`tel:${dial}`}>Call now</a>
        <button type="button" className="ats-call-alt" onClick={() => void toggleQr()}>{qr ? "Hide QR code" : "Send to my phone (scan QR)"}</button>
        {qr && <div className="ats-call-qr"><img src={qr} alt={`QR code to call ${candidate.name}`} width={180} height={180} /><span>Scan with your phone camera to open the dialer with this number.</span></div>}
        <button type="button" className="ats-call-copy" onClick={() => void copyNumber()}>{copied ? "Number copied" : "Copy number"}</button>
        <p className="ats-call-hint">Call now opens the dialer on this device, or your call-from-browser extension if you use one. To call from your phone instead, scan the QR code.</p>
        <fieldset className="ats-call-outcomes"><legend>How did it go?</legend>
          {CALL_OUTCOMES.map((item) => <label key={item} className={outcome === item ? "is-on" : ""}><input type="radio" name={`call-outcome-${candidate.id}`} checked={outcome === item} onChange={() => { setOutcome(item); if (!kind || kind === MESSAGE_FOR_OUTCOME[outcome]) pickKind(MESSAGE_FOR_OUTCOME[item]); }} />{item}</label>)}
        </fieldset>
        <div className="ats-call-msg">
          <label htmlFor={`call-msg-kind-${candidate.id}`}>Send a follow-up (optional)</label>
          <select id={`call-msg-kind-${candidate.id}`} value={kind} onChange={(event) => { const next = event.target.value as MessageKind | ""; if (next) pickKind(next); else { setKind(""); setDraft(""); } }}>
            <option value="">No message</option>
            {(Object.keys(MESSAGE_LABELS) as MessageKind[]).map((key) => <option key={key} value={key}>{MESSAGE_LABELS[key]}</option>)}
          </select>
          {kind && <>
            <textarea aria-label="Message text" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="ats-call-msg-actions">
              <a href={whatsappLink(dial, draft)} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
              {candidate.email && <a href={mailLink(candidate.email, `Your application${roleTitle ? ` for ${roleTitle}` : ""}`, draft)}>Open in email</a>}
            </div>
            <small>Opens the message pre-written. You press send.</small>
          </>}
        </div>
        <label className="ats-call-note" htmlFor={`call-note-${candidate.id}`}>Note (optional)</label>
        <textarea id={`call-note-${candidate.id}`} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Example: confirmed notice period is 10 days" />
        {error && <p role="alert" className="ats-call-error">{error}</p>}
        <div className="ats-call-actions"><button type="button" onClick={close} disabled={saving}>Cancel</button><button type="button" className="is-primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save to history"}</button></div>
        {calls.length > 0 && <div className="ats-call-history"><strong>Previous calls ({calls.length})</strong><ol>{calls.slice(0, 5).map((call) => <li key={call.id}><span><b>{call.type === "email" ? "Email" : "Call"} · {call.outcome}</b> · {call.author}</span><time dateTime={call.createdAt}>{formatDateTime(call.createdAt, "Date not recorded")}</time>{call.note && <p>{call.note}</p>}</li>)}</ol></div>}
      </div>}
    </dialog>
  </>;
}
