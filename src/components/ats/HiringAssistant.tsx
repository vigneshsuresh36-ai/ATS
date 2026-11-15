"use client";
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Answer = { answer: string; resumeStatus?: string; sources: { requisitions: { id: string; title: string }[]; candidates: { id: string; name: string }[] } };
export function HiringAssistant({ apiFetch, onReq, onCand, mode = "chat", candidateId, embedded = false, autoGenerate = false }: {
  apiFetch: ApiFetch; onReq?: (id: string) => void; onCand?: (id: string) => void; mode?: "chat" | "brief" | "candidate" | "offer" | "message" | "pool"; candidateId?: string; embedded?: boolean; autoGenerate?: boolean;
}) {
  const [open, setOpen] = useState(embedded);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ question: string; result: Answer }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!autoGenerate || mode !== "offer" || started.current) return;
    started.current = true;
    void ask("Summarize the pending offer");
    // Generate once when the offer brief panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, mode]);
  async function ask(text: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const res = await apiFetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, candidateId, question: text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reach LT Recruitment Project AI.");
      setMessages((old) => [...old.slice(-5), { question: text, result: data }]); setQuestion("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate an answer."); }
    finally { setBusy(false); }
  }
  const title = mode === "candidate" ? "Candidate evidence" : mode === "offer" ? "AI offer brief" : mode === "message" ? "Draft a candidate message" : mode === "pool" ? "Find talent with AI" : mode === "brief" ? "Your hiring brief" : "Ask Hiring Assistant";
  return <>
    {!embedded && <button className="premium-assistant-launch" onClick={() => { setOpen((value) => !value); setTimeout(() => input.current?.focus(), 50); }} aria-expanded={open} aria-controls="starship-assistant"><WorkspaceIcon name="sparkle" /> Hiring Assistant</button>}
    {open && <section className={embedded ? "premium-ai-embedded" : "premium-assistant"} id={embedded ? undefined : "starship-assistant"} aria-label={title}>
      <header><div><WorkspaceIcon name="sparkle" /><strong>{title}</strong></div>{!embedded && <button onClick={() => setOpen(false)} aria-label="Close assistant"><WorkspaceIcon name="close" /></button>}</header>
      <p className="premium-muted">{mode === "offer" ? "Summarize the offer for review before deciding." : "Answers from records you can access. Review AI output before acting."}</p>
      {!messages.length && mode !== "offer" && <div className="premium-ai-intro"><h3>{mode === "chat" ? "What would you like to know?" : mode === "brief" ? "Start with what needs you." : "Information you can review."}</h3><p>{mode === "candidate" ? "Compare the CV and recorded details with role requirements. Missing or unreadable evidence is highlighted for review." : mode === "message" ? "Describe your follow-up. Review and send the draft yourself." : "Get a clear summary using available workspace records."}</p></div>}
      <div className="premium-ai-messages" aria-live="polite" aria-busy={busy}>
        {messages.map((m, index) => <article key={index}><h4>{m.question}</h4>{m.result.resumeStatus && <small>CV: {m.result.resumeStatus}</small>}<div className="premium-ai-answer">{m.result.answer}</div><details><summary>Supporting workspace records</summary><div className="premium-source-links">{m.result.sources.requisitions.filter((r) => m.result.answer.includes(r.id)).map((r) => <button key={r.id} onClick={() => onReq?.(r.id)} disabled={!onReq}>{r.title} · {r.id}</button>)}{m.result.sources.candidates.filter((c) => m.result.answer.includes(c.id)).map((c) => <button key={c.id} onClick={() => onCand?.(c.id)} disabled={!onCand}>{c.name} · {c.id}</button>)}</div></details></article>)}
        {busy && <p role="status">Reading your workspace records…</p>}
      </div>
      {error && <p className="premium-error" role="alert">{error}</p>}
      {mode === "chat" || mode === "message" || mode === "pool" ? <>{mode === "chat" && <div className="premium-ai-prompts">{["Which roles need attention?", "Which approvals are pending?", "Which candidates need follow-up?"].map((q) => <button key={q} disabled={busy} onClick={() => ask(q)}>{q}</button>)}</div>}<form onSubmit={(e) => { e.preventDefault(); if (question.trim()) void ask(question); }}><input ref={input} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={mode === "message" ? "Describe your follow-up…" : mode === "pool" ? "Describe skills or experience…" : "Ask about your hiring…"} aria-label="Question for LT Recruitment Project AI" maxLength={2000} disabled={busy} /><button disabled={busy || !question.trim()} aria-label="Send question"><WorkspaceIcon name="arrow" /></button></form><small className="premium-muted">Review the answer before acting.</small></> : (!autoGenerate || messages.length > 0 || error) && <button className="premium-button" disabled={busy} onClick={() => ask(mode === "brief" ? "Prepare today's hiring brief" : mode === "offer" ? "Summarize the pending offer" : "Summarize candidate evidence")}>{busy ? "Preparing…" : messages.length ? "Refresh summary" : error ? "Try again" : mode === "offer" ? "Generate brief" : "Generate summary"}<WorkspaceIcon name="sparkle" size={16} /></button>}
    </section>}
  </>;
}
