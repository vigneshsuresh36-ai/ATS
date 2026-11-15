"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { WORKFLOWS, type AutomationSettings, type AutomationTask, type WorkflowConfig, type WorkflowId } from "@/lib/automationTypes";
import { WorkspaceIcon } from "./WorkspaceIcon";

export type AutomationViewData = { settings: AutomationSettings & { lastRunAt?: string }; tasks: AutomationTask[]; integrations: { ai: boolean; email: boolean; scheduler: boolean } };
export function AutomationsView({ apiFetch, onReq, onCand, initialData }: { apiFetch: (p: string, init?: RequestInit) => Promise<Response>; onReq: (id: string) => void; onCand: (id: string) => void; initialData?: AutomationViewData }) {
  const [data, setData] = useState<AutomationViewData | null>(initialData || null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ id: WorkflowId; value: WorkflowConfig } | null>(null);
  const [review, setReview] = useState<AutomationTask | null>(null);
  const [showAll, setShowAll] = useState(false);
  const activity = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    const res = await apiFetch("/api/automations"); const value = await res.json();
    if (!res.ok) throw new Error(value.error || "Could not load automations.");
    setData(value); setError("");
  }, [apiFetch]);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  const dialogOpen = Boolean(config || review);
  useEffect(() => { if (dialogOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [dialogOpen]);
  async function mutate(body: unknown, method = "POST") {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await apiFetch("/api/automations", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json(); if (!res.ok) throw new Error(result.error || "Could not complete the action.");
      await load(); setConfig(null); setReview(null);
      setNotice(result.prepared !== undefined ? `${result.prepared} new items prepared. Existing tasks were checked for changes.` : "Changes saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  const pending = data?.tasks.filter((t) => t.status === "pending") || [];
  const failed = data?.tasks.filter((t) => t.status === "failed" || t.status === "sending") || [];
  const sent = data?.tasks.filter((t) => t.status === "sent") || [];
  const activityRows = data?.tasks.filter((t) => t.status !== "pending") || [];
  return <section className="premium-automations">
    <div className="premium-page-intro"><div><span className="premium-eyebrow">WORKSPACE AUTOMATIONS</span><h2>Make room for people.</h2><p>Routine follow-ups handled. Important decisions stay with you.</p></div><div className="premium-intro-actions"><button className="premium-button" disabled={busy || !data} onClick={() => mutate({ action: "run" })}>{busy ? "Working…" : "Run enabled workflows"}<WorkspaceIcon name="bolt" size={16} /></button><button className="premium-text-button" onClick={() => activity.current?.scrollIntoView({ behavior: "smooth" })}>Activity log <WorkspaceIcon name="arrow" size={15} /></button></div></div>
    {error && <div className="premium-error" role="alert">{error}{!data && <button onClick={() => load().catch((e) => setError(e.message))}>Retry</button>}</div>}
    {notice && <p className="premium-notice" role="status">{notice}</p>}
    {!data ? !error && <p role="status">Loading your workflows…</p> : <>
      <div className="premium-integrations" aria-label="Connection status">{[["AI", data.integrations.ai], ["Email", data.integrations.email], ["Runner authorization", data.integrations.scheduler]].map(([label, ready]) => <span key={String(label)}><i className={ready ? "is-ready" : ""} />{label}: {ready ? "Configured" : "Setup needed"}</span>)}<details><summary>Connection help</summary><p>Ask your Admin to connect AI and email and configure the background runner. Until then, you can configure workflows and prepare message drafts. No email is sent without a configured provider.</p></details></div>
      <div className="premium-stat-strip">{[[sent.length, "Messages submitted"], [pending.length, "Awaiting review"], [failed.length, "Need attention"]].map(([count, label]) => <div key={String(label)}><strong>{count}</strong><span>{label}</span></div>)}</div>
      <div className="premium-automation-columns"><div><div className="premium-section-heading"><h3>Your workflows</h3><span><i className="premium-status-dot" />{WORKFLOWS.filter((w) => w.id !== "briefs" && data.settings[w.id].enabled).length} enabled</span></div><div className="premium-workflow-grid">{WORKFLOWS.filter((w) => w.id !== "briefs").map((w) => {
        const value = data.settings[w.id];
        const hint = w.id === "feedback" ? `${value.delayHours}h reminder / ${value.escalationHours}h escalation` : w.id === "approvals" ? `After ${value.delayHours} hours` : w.id === "joining" ? `${Math.round(value.delayHours / 24)} and 2 days before joining` : w.id === "interviewReminders" ? `Within ${value.delayHours}h of interview` : w.id === "intake" ? "Review before saving" : "Review before sending";
        return <article className="premium-workflow-card" key={w.id}><div className="premium-workflow-top"><WorkspaceIcon name={w.icon} size={23} /><div><h4>{w.title}</h4><p>{w.description}</p></div><button role="switch" aria-checked={value.enabled} aria-label={`${value.enabled ? "Pause" : "Enable"} ${w.title}`} disabled={busy} className={`premium-switch${value.enabled ? " is-on" : ""}`} onClick={() => mutate({ workflow: w.id, config: { enabled: !value.enabled } }, "PATCH")}><span /></button></div><footer><span>{hint}{value.autoSend && <small>Automatic sending</small>}</span><button className="premium-text-button" disabled={busy} onClick={() => { setError(""); setConfig({ id: w.id, value: { ...value } }); }}>Configure <WorkspaceIcon name="arrow" size={14} /></button></footer></article>;
      })}</div><p className="premium-muted premium-run-note">{data.settings.lastRunAt ? `Last checked ${new Date(data.settings.lastRunAt).toLocaleString()}.` : "Enable a workflow, then run it to prepare your first items."} Resume intake runs when you upload resumes.</p></div>
      <aside className="premium-review-column"><section className="premium-review-panel"><div className="premium-section-heading"><h3>For your review</h3><b className="premium-count">{pending.length}</b></div>{pending.length ? pending.slice(0, showAll ? 100 : 4).map((t) => <button key={t.id} className="premium-review-row" onClick={() => { setError(""); setReview({ ...t }); }}><span><small>{WORKFLOWS.find((w) => w.id === t.workflow)?.title}</small><strong>{t.title}</strong><span>{t.detail}</span></span><WorkspaceIcon name="arrow" size={18} /></button>) : <div className="premium-empty"><WorkspaceIcon name="check" size={26} /><strong>You’re all caught up.</strong><p>New drafts will appear here when an enabled workflow needs review.</p></div>}{pending.length > 4 && <button className="premium-button" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer items" : `View all ${pending.length} items`}</button>}</section>
      {failed.length > 0 && <section className="premium-exceptions"><h3><i />Needs attention</h3>{failed.slice(0, 5).map((t) => <div key={t.id}><strong>{t.title}</strong><p>{t.error || "Sending status is unconfirmed. Check the provider log before following up manually."}</p><button className="premium-text-button" disabled={busy} onClick={() => t.candidateId ? onCand(t.candidateId) : onReq(t.reqId)}>Open record <WorkspaceIcon name="arrow" size={14} /></button><button className="premium-text-button" disabled={busy || t.status === "sending"} onClick={() => mutate({ action: "dismiss", id: t.id })}>Dismiss</button></div>)}</section>}</aside></div>
      <section className="premium-activity" ref={activity}><div className="premium-section-heading"><h3>Recent activity</h3><span>Latest 30 events</span></div>{activityRows.length ? activityRows.slice(0, 30).map((t) => <div className="premium-activity-row" key={t.id}><WorkspaceIcon name={t.status === "sent" ? "mail" : "document"} size={18} /><strong>{t.title}</strong><span>{t.detail}</span><span className={`premium-task-status is-${t.status}`}>{t.status === "sent" ? "Submitted to email provider" : t.status}</span><time>{new Date(t.updatedAt).toLocaleString()}</time></div>) : <p className="premium-empty">No activity yet. Your completed and dismissed items will appear here.</p>}</section>
      <p className="premium-footnote">Interview scheduling remains manual. Your team approves hiring decisions and offer terms.</p>
    </>}
    <dialog ref={dialog} className="premium-modal" onCancel={(e) => { if (busy) e.preventDefault(); else { setConfig(null); setReview(null); } }}><div className="premium-modal-heading"><h3>{config ? `Configure ${WORKFLOWS.find((w) => w.id === config.id)?.title.toLowerCase()}` : review?.title}</h3><button aria-label="Close" disabled={busy} onClick={() => { setConfig(null); setReview(null); }}><WorkspaceIcon name="close" /></button></div>
      {error && <p role="alert" className="premium-error">{error}</p>}
      {config && <form onSubmit={(e) => { e.preventDefault(); void mutate({ workflow: config.id, config: config.value }, "PATCH"); }}>
        <label className="premium-checkbox"><input type="checkbox" checked={config.value.enabled} onChange={(e) => setConfig({ ...config, value: { ...config.value, enabled: e.target.checked } })} />Enable this workflow</label>
        {!["intake", "updates"].includes(config.id) && <label>{config.id === "joining" ? "First follow-up window (hours before joining)" : config.id === "briefs" || config.id === "interviewReminders" ? "Prepare within this many hours before interview" : "Reminder after (hours)"}<input type="number" min={1} max={2160} value={config.value.delayHours} onChange={(e) => setConfig({ ...config, value: { ...config.value, delayHours: Number(e.target.value) } })} required /></label>}
        {config.id === "feedback" && <label>Escalate after (hours)<input type="number" min={1} max={2160} value={config.value.escalationHours} onChange={(e) => setConfig({ ...config, value: { ...config.value, escalationHours: Number(e.target.value) } })} required /></label>}
        {!["intake", "briefs"].includes(config.id) && <><label>Subject<input value={config.value.subject} maxLength={200} onChange={(e) => setConfig({ ...config, value: { ...config.value, subject: e.target.value } })} required /></label><label>Message template<textarea rows={8} maxLength={6000} value={config.value.template} onChange={(e) => setConfig({ ...config, value: { ...config.value, template: e.target.value } })} required /></label><p className="premium-muted">Available fields: {"{candidateName}, {roleTitle}, {companyName}, {stage}, {joiningDate}"}{config.id === "interviewReminders" && ", {interviewTime}, {roundName}, {meetingDetails}"}</p></>}
        {["feedback", "approvals", "joining"].includes(config.id) && <label className="premium-checkbox"><input type="checkbox" checked={config.value.autoSend} onChange={(e) => setConfig({ ...config, value: { ...config.value, autoSend: e.target.checked } })} />Send this template automatically when due</label>}
        {config.id === "updates" && <p className="premium-muted">Only new stage changes after enabling are included. Rejections and offer decisions are excluded. Each message needs review.</p>}
        {config.id === "intake" && <p className="premium-muted">AI extraction enhances resume uploads when AI is connected. Duplicate warnings appear during intake. You always review profiles before saving.</p>}
        <button className="premium-button" disabled={busy}>{busy ? "Saving…" : "Save workflow"}</button>
      </form>}
      {review && <div className="premium-review-detail"><p className="premium-muted">{review.detail}</p>{review.workflow === "briefs" ? <div className="premium-ai-answer">{review.body}</div> : <><p><strong>To:</strong> {review.recipients.join(", ") || "No recipient available"}</p><label>Subject<input value={review.subject} maxLength={200} onChange={(e) => setReview({ ...review, subject: e.target.value })} /></label><label>Message<textarea rows={10} maxLength={6000} value={review.body} onChange={(e) => setReview({ ...review, body: e.target.value })} /></label></>}
        <button className="premium-text-button" onClick={() => { const t = review; setReview(null); if (t.candidateId) onCand(t.candidateId); else onReq(t.reqId); }}>Open supporting record <WorkspaceIcon name="arrow" size={16} /></button><div className="premium-modal-actions"><button className="premium-secondary" disabled={busy} onClick={() => mutate({ action: "dismiss", id: review.id })}>Dismiss</button><button className="premium-button" disabled={busy || (review.workflow !== "briefs" && !data?.integrations.email)} onClick={() => mutate({ action: review.workflow === "briefs" ? "review" : "send", id: review.id, subject: review.subject, body: review.body })}>{busy ? "Working…" : review.workflow === "briefs" ? "Mark reviewed" : "Approve & send"}</button></div>{review.workflow !== "briefs" && !data?.integrations.email && <p className="premium-muted">Connect email delivery to send this message.</p>}</div>}
    </dialog>
  </section>;
}
