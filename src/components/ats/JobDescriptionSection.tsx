"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { isRequisitionClosed } from "@/lib/requisitionStatus";
import type { Requisition } from "@/lib/types";
import type { JobDescriptionMark } from "@/lib/jobDescriptionFormatting";
import JobDescriptionEditor, { JobDescriptionCopy } from "./JobDescriptionEditor";
import { JobDescriptionDownload, type JobDescriptionFetch } from "./JobDescriptionDownload";

export function JobDescriptionSection({ req, role, apiFetch, onRefresh, full = false, previewActions }: {
  req: Requisition;
  role: string;
  apiFetch: JobDescriptionFetch;
  onRefresh: (saved: Requisition) => void;
  full?: boolean;
  previewActions?: ReactNode;
}) {
  const [jdDraft, setJdDraft] = useState(req.jdText || "");
  const [jdFormatting, setJdFormatting] = useState<JobDescriptionMark[]>(req.jdFormatting ?? []);
  const [jdReplacement, setJdReplacement] = useState<{ text: string } | null>(null);
  const [jdEditing, setJdEditing] = useState(false);
  const [jdSaving, setJdSaving] = useState(false);
  const [jdAiBusy, setJdAiBusy] = useState(false);
  const [jdSuggestion, setJdSuggestion] = useState("");
  const [jdError, setJdError] = useState("");

  function startEditing() {
    setJdDraft(req.jdText || "");
    setJdFormatting(req.jdFormatting ?? []);
    setJdReplacement(null);
    setJdSuggestion("");
    setJdError("");
    setJdEditing(true);
  }

  async function saveJobDescription() {
    setJdSaving(true);
    setJdError("");
    try {
      const response = await apiFetch("/api/requisitions/" + encodeURIComponent(req.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText: jdDraft, jdFormatting }),
      });
      const data = await response.json();
      if (!response.ok || !data.requisition) throw new Error(data.error || "Could not save the job description.");
      setJdEditing(false);
      onRefresh(data.requisition);
    } catch (error) {
      setJdError(error instanceof Error ? error.message : "Could not save the job description.");
    } finally {
      setJdSaving(false);
    }
  }

  async function improveJobDescription() {
    setJdAiBusy(true);
    setJdError("");
    setJdSuggestion("");
    try {
      const response = await apiFetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "job-improve", requisitionId: req.id, jobDraft: jdDraft }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not improve the job description.");
      setJdSuggestion(data.answer);
    } catch (error) {
      setJdError(error instanceof Error ? error.message : "Could not improve the job description.");
    } finally {
      setJdAiBusy(false);
    }
  }

  const canEdit = (role === "Admin" || role === "Recruiter") && !isRequisitionClosed(req.status);
  const hasText = !!req.jdText?.trim();
  return (
    <section id="ats-pipeline-jd" className={"ats-pipeline-jd ats-jd-section" + (full ? " ats-jd-full-copy" : "")}>
      <div className="ats-pipeline-section-head">
        <h2>{full ? "Description" : "Job description"}</h2>
        <div className="ats-jd-actions">
          {full && hasText && <JobDescriptionDownload req={req} apiFetch={apiFetch} />}
          {canEdit && !jdEditing && <button type="button" className="ats-jd-button ats-jd-primary" onClick={startEditing}>{full ? "Edit JD" : "Edit"}</button>}
        </div>
      </div>
      {jdEditing ? (
        <div className="ats-jd-editor">
          <JobDescriptionEditor
            replacement={jdReplacement}
            initialText={req.jdText ?? ""}
            initialMarks={req.jdFormatting}
            onChange={({ text, marks }) => { setJdDraft(text); setJdFormatting(marks); }}
          />
          <button type="button" className="ats-pipeline-action" disabled={jdAiBusy || jdSaving || !jdDraft.trim()} onClick={() => void improveJobDescription()}>{jdAiBusy ? "Preparing…" : "✦ Improve with AI"}</button>
          {jdSuggestion && <div className="ats-jd-ai-suggestion"><strong>Suggested revision</strong><p>Review the suggestion before replacing your draft. Nothing is saved yet.</p><textarea aria-label="Suggested job description" value={jdSuggestion} onChange={(event) => setJdSuggestion(event.target.value)} rows={10} /><div><button type="button" className="ats-pipeline-action" onClick={() => setJdSuggestion("")}>Dismiss</button><button type="button" className="ats-pipeline-action is-primary" onClick={() => { setJdDraft(jdSuggestion); setJdReplacement({ text: jdSuggestion }); setJdFormatting([]); setJdSuggestion(""); }}>Use suggestion</button></div></div>}
          {jdError && <p className="ats-jd-error" role="alert">{jdError}</p>}
          <div className="ats-jd-editor-actions">
            <span>Changes are saved to this requisition.</span>
            <button type="button" className="ats-jd-cancel" disabled={jdSaving || jdAiBusy} onClick={() => setJdEditing(false)}>Cancel</button>
            <button type="button" className="ats-jd-save" disabled={jdSaving || jdAiBusy || !jdDraft.trim()} onClick={() => void saveJobDescription()}>{jdSaving ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      ) : <>
        <div className={"ats-pipeline-jd-copy" + (full ? "" : " ats-jd-preview")}>
          <JobDescriptionCopy text={req.jdText || "No job description has been added yet."} marks={req.jdFormatting} />
        </div>
        {!full && (hasText || previewActions) && <div className="ats-jd-actions ats-jd-preview-actions">
          {hasText && <Link className="ats-jd-read" href={"/app/requisitions/" + encodeURIComponent(req.id) + "/job-description"}>Read more <span aria-hidden="true">→</span></Link>}
          <div className="ats-jd-actions ats-jd-preview-buttons">
            {hasText && <JobDescriptionDownload req={req} apiFetch={apiFetch} />}
            {previewActions}
          </div>
        </div>}
      </>}
    </section>
  );
}
