"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { JobDescriptionAdvice } from "@/lib/jobDescriptionAdvice";
import type { Requisition } from "@/lib/types";
import { JobDescriptionSection } from "./JobDescriptionSection";
import type { JobDescriptionFetch } from "./JobDescriptionDownload";

function Advice({ id, apiFetch }: { id: string; apiFetch: JobDescriptionFetch }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ revision: number; advice?: JobDescriptionAdvice; error?: string }>();
  const request = useRef<{ revision: number; promise: Promise<JobDescriptionAdvice> }>(null);
  useEffect(() => {
    let active = true;
    if (request.current?.revision !== revision) {
      const promise = apiFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "job-advice", requisitionId: id }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load suggestions.");
        return data as JobDescriptionAdvice;
      });
      request.current = { revision, promise };
    }
    request.current.promise.then(
      (advice) => { if (active) setResult({ revision, advice }); },
      (error: unknown) => { if (active) setResult({ revision, error: error instanceof Error ? error.message : "Could not load suggestions." }); },
    );
    return () => { active = false; };
  }, [apiFetch, id, revision]);

  const current = result?.revision === revision ? result : undefined;
  return (
    <aside className="ats-jd-advice" aria-labelledby="ats-jd-advice-heading">
      <div className="ats-pipeline-section-head">
        <h2 id="ats-jd-advice-heading">AI suggestions</h2>
        <button type="button" className="ats-jd-button" disabled={!current} onClick={() => setRevision(revision + 1)}>Refresh</button>
      </div>
      {!current && <p role="status">Preparing suggestions…</p>}
      {current?.error && <p role="alert">{current.error}</p>}
      {current?.advice && <>
        <section>
          <h3>Fill the role sooner</h3>
          {current.advice.actions.length ? <ul>{current.advice.actions.map((action, index) => <li key={index}>{action}</li>)}</ul> : <p>No actions suggested for this JD.</p>}
        </section>
        <section>
          <h3>Clarify with hiring manager</h3>
          {current.advice.questions.length ? <ul>{current.advice.questions.map((question, index) => <li key={index}>{question}</li>)}</ul> : <p>No material gaps identified in this JD.</p>}
        </section>
      </>}
    </aside>
  );
}

export function JobDescriptionPage({ id, role, apiFetch }: {
  id: string; role: string; apiFetch: JobDescriptionFetch;
}) {
  const [req, setReq] = useState<Requisition>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    apiFetch("/api/requisitions/" + encodeURIComponent(id)).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the job description.");
      if (active) setReq(data.requisition);
    }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : "Could not load the job description.");
    });
    return () => { active = false; };
  }, [id, apiFetch]);

  return (
    <div className="ats-jd-page">
      <nav className="ats-role-details-breadcrumb" aria-label="Breadcrumb">
        <Link href="/app/requisitions">Hiring Requests</Link>
        <span aria-hidden="true">/</span>
        <Link href={"/app/requisitions/" + encodeURIComponent(id)}>{req?.title || "Role details"}</Link>
        <span aria-hidden="true">/</span><span aria-current="page">Job description</span>
      </nav>
      {error && <p role="alert">{error}</p>}
      {!req && !error && <p role="status">Loading job description…</p>}
      {req && <>
        <header className="ats-jd-page-header">
          <h1>Job description</h1>
          <p>{[req.title, req.department, req.location].filter(Boolean).join(" · ")}</p>
        </header>
        <div className="ats-jd-page-grid">
          <JobDescriptionSection req={req} role={role} apiFetch={apiFetch} onRefresh={setReq} full />
          {req.jdText?.trim() && <Advice key={req.jdText} id={req.id} apiFetch={apiFetch} />}
        </div>
      </>}
    </div>
  );
}
