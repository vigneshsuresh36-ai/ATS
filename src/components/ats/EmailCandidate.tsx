"use client";
import { useEffect, useRef, useState } from "react";
import { MESSAGE_LABELS, buildMessage, gmailLink, type MessageKind } from "@/lib/messageTemplates";

type Props = {
  candidate: { id: string; name: string; email?: string };
  roleTitle?: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** "icon" is the small button beside a name in a list. */
  variant?: "default" | "icon";
};

const ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
  </svg>
);

type Sender = { name: string; phone: string };
let senderCache: Sender | null = null;

/** Opens a short email panel with ready templates, then Gmail with the candidate's address filled in. */
export function EmailCandidate({ candidate, roleTitle, apiFetch, variant = "default" }: Props) {
  const email = (candidate.email || "").trim();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MessageKind>("unableToConnect");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [sender, setSender] = useState<Sender | null>(senderCache);
  const dialog = useRef<HTMLDialogElement>(null);
  const cls = `ats-call-btn${variant === "icon" ? " is-icon" : ""}`;
  const label = `Email ${candidate.name}`;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open || senderCache) return;
    let active = true;
    apiFetch("/api/me").then(async (response) => {
      const result = await response.json();
      if (response.ok && active) {
        senderCache = { name: result.user?.name || "", phone: result.user?.phone || "" };
        setSender(senderCache);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [open, apiFetch]);

  useEffect(() => {
    if (!open || edited) return;
    setSubject(`Your application${roleTitle ? ` for ${roleTitle}` : ""}`);
    setBody(buildMessage(kind, { name: candidate.name, role: roleTitle, recruiter: sender?.name, phone: sender?.phone }));
  }, [open, kind, sender, candidate.name, roleTitle, edited]);

  function close() { setOpen(false); setEdited(false); setKind("unableToConnect"); }

  if (!email) {
    return <button type="button" className={cls} disabled title="No email address on file" aria-label={label}>{ICON}{variant === "icon" ? null : "Email"}</button>;
  }
  return <>
    <button type="button" className={cls} title={`${label} (${email})`} aria-label={label} onClick={() => setOpen(true)}>{ICON}{variant === "icon" ? null : "Email"}</button>
    <dialog ref={dialog} className="ats-call-dialog" aria-label="Email candidate" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === dialog.current) close(); }}>
      {open && <div className="ats-call-body">
        <h3>Email candidate</h3>
        <p className="ats-call-sub">Pick a template, edit it if you like, then open it in Gmail. You press send.</p>
        <div className="ats-call-who"><span className="ats-call-avatar">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{candidate.name}</strong><small>{email}</small></span></div>
        <div className="ats-call-msg">
          <label htmlFor="mail-kind">Template</label>
          <select id="mail-kind" value={kind} onChange={(event) => { setKind(event.target.value as MessageKind); setEdited(false); }}>
            {(Object.keys(MESSAGE_LABELS) as MessageKind[]).map((key) => <option key={key} value={key}>{MESSAGE_LABELS[key]}</option>)}
          </select>
          <label htmlFor="mail-subject">Subject</label>
          <input id="mail-subject" className="ats-mail-input" value={subject} onChange={(event) => { setSubject(event.target.value); setEdited(true); }} />
          <label htmlFor="mail-body">Message</label>
          <textarea id="mail-body" value={body} onChange={(event) => { setBody(event.target.value); setEdited(true); }} />
          {sender && !sender.phone && <small className="ats-mail-warn">Your phone number isn&apos;t saved yet, so call-back templates will not include it. Ask an admin to add it in Teams &amp; Access.</small>}
        </div>
        <div className="ats-call-actions">
          <button type="button" onClick={close}>Cancel</button>
          <a className="ats-mail-primary" href={gmailLink(email, subject, body)} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(close, 150)}>Open in Gmail</a>
        </div>
      </div>}
    </dialog>
  </>;
}
