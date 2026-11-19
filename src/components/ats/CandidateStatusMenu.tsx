"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDateTime } from "@/lib/dateFormat";

type Eligible = { id: string; roundName?: string; roundIndex?: number; datetime: string };
type Mode = "candidate" | "interviewer" | "backout";

const TITLES: Record<Mode, string> = {
  candidate: "Candidate requested a reschedule",
  interviewer: "Interviewer requested a reschedule",
  backout: "Candidate backed out",
};
const TERMINAL = new Set(["Candidate Backed Out", "Rejected", "Onboarded"]);

/** Recruiter and admin actions: reschedule requests from either side, and a candidate withdrawing at any point. */
export function CandidateStatusMenu({ candidateId, name, stage, eligible = [], apiFetch, onDone, label = "Update status", accessibleLabel, allowReschedule = true, directBackout = false, directReschedule, showBackout = true, offerBackout = false }: {
  candidateId: string;
  name: string;
  stage: string;
  eligible?: Eligible[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onDone: () => void;
  label?: string;
  accessibleLabel?: string;
  allowReschedule?: boolean;
  directBackout?: boolean;
  directReschedule?: "candidate" | "interviewer";
  showBackout?: boolean;
  offerBackout?: boolean;
}) {
  const fieldId = useId();
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const canRequest = eligible.length > 0;
  const terminal = TERMINAL.has(stage);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", key); };
  }, [menu]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (mode && !el.open) el.showModal();
    if (!mode && el.open) el.close();
  }, [mode]);

  function start(next: Mode) {
    setMenu(false); setReason(""); setError("");
    setTarget(eligible[0]?.id || "");
    setMode(next);
  }
  function close() { if (!busy) { setMode(null); setError(""); } }

  async function submit() {
    if (!mode) return;
    const text = reason.trim();
    if (mode !== "backout" && !text) { setError("Enter the reason, so it is on record."); return; }
    if (mode !== "backout" && !target) { setError("Choose the interview."); return; }
    setBusy(true); setError("");
    try {
      const response = mode === "backout"
        ? await apiFetch(`/api/candidates/${candidateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "candidateBackOut", reason: text }) })
        : await apiFetch("/api/schedule", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target, status: "Reschedule Requested", reason: text, rescheduleRequestedBy: mode === "candidate" ? "Candidate" : "Interviewer" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this update.");
      setMode(null);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this update.");
    } finally {
      setBusy(false);
    }
  }

  if (terminal) return null;
  return <>
    <div className="ats-status-menu" ref={root}>
      <button type="button" className="ats-call-btn" aria-label={accessibleLabel} title={accessibleLabel} aria-haspopup={directBackout || directReschedule ? "dialog" : "menu"} aria-expanded={directBackout || directReschedule ? undefined : menu} disabled={!!directReschedule && !canRequest} onClick={(event) => { if (directBackout || directReschedule) { start(directReschedule || "backout"); return; } const rect = event.currentTarget.getBoundingClientRect(); const height = allowReschedule ? 160 : 60; setMenuPosition({ top: rect.bottom + height + 6 > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 278)) }); setMenu((value) => !value); }}>{label}{!directBackout && !directReschedule && <span aria-hidden="true">▾</span>}</button>
      {menu && menuPosition && createPortal(<div ref={menuRef} className="ats-status-menu-list" role="menu" style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left }}>
        {allowReschedule && <>
        <button type="button" role="menuitem" disabled={!canRequest} title={canRequest ? undefined : "No scheduled interview to reschedule"} onClick={() => start("candidate")}>Candidate requested reschedule</button>
        <button type="button" role="menuitem" disabled={!canRequest} title={canRequest ? undefined : "No scheduled interview to reschedule"} onClick={() => start("interviewer")}>Interviewer requested reschedule</button>
        </>}
        {showBackout && <button type="button" role="menuitem" className="is-danger" onClick={() => start("backout")}>Candidate backed out</button>}
      </div>, document.body)}
    </div>
    <dialog ref={dialog} className="ats-call-dialog" aria-label={mode ? TITLES[mode] : "Update status"} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      {mode && <div className="ats-call-body">
        <h3>{offerBackout && mode === "backout" ? "Candidate offer reject / backout" : TITLES[mode]}</h3>
        <p className="ats-call-sub">{name}</p>
        {mode !== "backout" && <p className="ats-call-sub">The interview will be marked as waiting for a new time. Coordinate with the candidate and panel, then use Reschedule interview in the candidate pipeline.</p>}
        {mode === "backout" && <p className="ats-call-sub">{offerBackout ? "This records that the candidate declined or backed out of the approved offer and makes the opening available again." : "Use this at any point, before or after an interview is scheduled. Any remaining scheduled interviews will be cancelled."}</p>}
        <div className="ats-call-msg">
          {mode !== "backout" && <>
            <label htmlFor={fieldId + "-interview"}>Interview</label>
            <select id={fieldId + "-interview"} value={target} onChange={(event) => setTarget(event.target.value)}>
              {eligible.map((item) => <option key={item.id} value={item.id}>{item.roundName || `Round ${item.roundIndex || 1}`} · {formatDateTime(item.datetime)}</option>)}
            </select>
          </>}
          <label htmlFor={fieldId + "-reason"}>{mode === "backout" ? "Comments (optional)" : "Reason"}</label>
          <textarea id={fieldId + "-reason"} value={reason} maxLength={500} placeholder={mode === "backout" ? "Example: accepted another offer" : "Example: candidate has a family emergency"} onChange={(event) => setReason(event.target.value)} />
        </div>
        {error && <p role="alert" className="ats-call-error">{error}</p>}
        <div className="ats-call-actions">
          <button type="button" onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={mode === "backout" ? "is-danger" : "is-primary"} onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : mode === "backout" ? "Mark as backed out" : "Save request"}</button>
        </div>
      </div>}
    </dialog>
  </>;
}
