"use client";

import { useState } from "react";
import type { Requisition } from "@/lib/types";

export type JobDescriptionFetch = (path: string, init?: RequestInit) => Promise<Response>;

export function JobDescriptionDownload({ req, apiFetch }: { req: Requisition; apiFetch: JobDescriptionFetch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/requisitions/" + encodeURIComponent(req.id) + "/jd?format=saved");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Could not download the job description.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = (req.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "Job description") + " - JD.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not download the job description.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="ats-jd-button ats-jd-primary" disabled={busy} onClick={() => void download()}>{busy ? "Downloading…" : "Download JD"}</button>
    {error && <span className="ats-jd-action-error" role="alert">{error}</span>}
  </>;
}
