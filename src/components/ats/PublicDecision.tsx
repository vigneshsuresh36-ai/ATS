"use client";
import { useEffect, useState } from "react";

type Summary = {
  pending: boolean;
  outcome: "approved" | "rejected" | null;
  candidate: { name: string; location?: string; experienceYears?: number; notice?: string; expectedCtc?: string; currentCtc?: string; skills: string[]; source?: string };
  role: { title: string; department: string; location?: string };
};

export function PublicDecision({ token }: { token: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    fetch(`/api/public/decide/${token}`)
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "This link is not available.");
        setData(result);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "This link is not available."));
  }, [token]);

  async function decide(decision: "approve" | "reject") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/public/decide/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your decision.");
      setDone(result.outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your decision.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string | undefined][] = data ? [
    ["Experience", data.candidate.experienceYears != null ? `${data.candidate.experienceYears} years` : undefined],
    ["Location", data.candidate.location],
    ["Notice period", data.candidate.notice],
    ["Current CTC", data.candidate.currentCtc],
    ["Expected CTC", data.candidate.expectedCtc],
    ["Source", data.candidate.source],
    ["Skills", data.candidate.skills.join(", ") || undefined],
  ] : [];
  const outcome = done || data?.outcome;

  return (
    <main className="ats-decide">
      <div className="ats-decide-card">
        {!data && !error && <p>Loading…</p>}
        {error && <p role="alert" className="ats-decide-error">{error}</p>}
        {data && <>
          <p className="ats-decide-eyebrow">{data.role.title} · {data.role.department}</p>
          <h1>{data.candidate.name}</h1>
          <dl>{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {done || !data.pending ? (
            <p className="ats-decide-done">{outcome === "approved" ? "Approved. The recruiter can now schedule interviews." : "Rejected. The recruiter will be informed."}</p>
          ) : reject ? (
            <>
              <label htmlFor="decide-reason">Reason for rejection (optional)</label>
              <textarea id="decide-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
              <div className="ats-decide-actions">
                <button type="button" onClick={() => setReject(false)} disabled={busy}>Back</button>
                <button type="button" className="is-primary" onClick={() => void decide("reject")} disabled={busy}>{busy ? "Saving…" : "Confirm rejection"}</button>
              </div>
            </>
          ) : (
            <div className="ats-decide-actions">
              <button type="button" onClick={() => setReject(true)} disabled={busy}>Reject</button>
              <button type="button" className="is-primary" onClick={() => void decide("approve")} disabled={busy}>{busy ? "Saving…" : "Approve"}</button>
            </div>
          )}
        </>}
      </div>
    </main>
  );
}
