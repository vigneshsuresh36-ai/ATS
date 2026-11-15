"use client";

import { useEffect, useRef, useState } from "react";

type Answer = { answer: string };

export function RoleHiringBrief({ requisitionId, apiFetch, approval = false }: { requisitionId: string; apiFetch: (path: string, init?: RequestInit) => Promise<Response>; approval?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (!approval || started.current) return;
    started.current = true;
    void request("request-brief");
    // Generate once when the approval panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval]);
  async function request(mode: "role" | "role-brief" | "request-brief", text = "") {
    setBusy(true); setError("");
    try {
      const response = await apiFetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, requisitionId, question: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not prepare the hiring brief.");
      setAnswer((data as Answer).answer);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the assistant."); }
    finally { setBusy(false); }
  }
  return <section className="ats-role-brief" aria-label="AI hiring brief">
    <div className="ats-role-brief-icon" aria-hidden="true">✦</div>
    <div className="ats-role-brief-body"><div className="ats-role-brief-heading"><strong>{approval ? "AI request brief" : "AI hiring brief"}</strong><span>AI-generated</span></div>
      <p aria-live="polite">{busy ? "Preparing your update…" : answer || (approval ? "Review the request’s purpose, key details and missing information before deciding." : "Get a concise update and suggested next steps for this role.")}</p>
      {error && <p className="ats-role-brief-error" role="alert">{error}</p>}
      {answer && <small>Review AI output before acting.</small>}
      {asking && <form onSubmit={(event) => { event.preventDefault(); if (question.trim()) void request("role", question.trim()); }}><input aria-label="Ask about this role" placeholder="What would you like to know about this role?" maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} /><button type="submit" disabled={busy || !question.trim()}>Ask</button></form>}
    </div>
    <div className="ats-role-brief-actions">{(!approval || answer || error) && <button type="button" disabled={busy} onClick={() => void request(approval ? "request-brief" : "role-brief")}>{answer ? "Refresh brief" : error ? "Try again" : "Generate brief"}</button>}{!approval && <button type="button" onClick={() => setAsking((value) => !value)} aria-expanded={asking}>{asking ? "Close" : "✦  Ask this role"}</button>}</div>
  </section>;
}
