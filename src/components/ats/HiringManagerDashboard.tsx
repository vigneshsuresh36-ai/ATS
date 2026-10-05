"use client";

import type { CSSProperties } from "react";
import { prettyStatus, statusColor } from "./ui";

type Item = Record<string, unknown>;

const PIPELINE_STAGES = [
  "PendingHMApproval",
  "HMApproved",
  "Screened",
  "Shortlist",
  "Debrief",
  "Selected",
  "OfferApprovalPending",
  "OfferApproved",
  "Offered",
  "Onboarded",
];

const OPEN_STATUSES = new Set(["Approved", "Position Reopened", "Partially Fulfilled"]);

export function HiringManagerDashboard({
  analytics,
  onReq,
}: {
  analytics: Record<string, unknown> | null;
  onReq: (id: string) => void;
}) {
  if (!analytics) return <p style={{ color: "#888" }}>Loading dashboard...</p>;

  const requisitions = (analytics.hiringManagerRequisitions || []) as Item[];
  const activeReqs = requisitions.filter((item) => OPEN_STATUSES.has(String(item.status)));
  const stages = (analytics.stages || {}) as Record<string, number>;
  const openPositions = activeReqs.reduce((sum, item) => sum + number(item.openings), 0);
  const totalCandidates = requisitions.reduce((sum, item) => sum + number(item.candidateCount), 0);
  const pendingHmReviews = stages.PendingHMApproval || 0;
  const offersPending = stages.OfferApprovalPending || 0;
  const offersApproved = (stages.OfferApproved || 0) + (stages.Offered || 0) + (stages.Onboarded || 0);

  const roundMap = new Map<number, number>();
  for (const requisition of requisitions) {
    const rounds = Array.isArray(requisition.roundCounts) ? requisition.roundCounts as Item[] : [];
    for (const round of rounds) {
      const index = number(round.round);
      roundMap.set(index, (roundMap.get(index) || 0) + number(round.candidates));
    }
  }
  const rounds = [...roundMap.entries()].sort(([left], [right]) => left - right);
  const maxRound = Math.max(1, ...rounds.map(([, count]) => count));
  const visibleStages = PIPELINE_STAGES.filter((stage) => stages[stage]);
  const maxStage = Math.max(1, ...visibleStages.map((stage) => stages[stage] || 0));

  return (
    <div className="ats-hm-dashboard">
      <div style={heading}>
        <div>
          <span style={eyebrow}>MY REQUISITIONS</span>
          <h2 className="ats-heading-section" style={{ marginTop: 4 }}>Hiring Overview</h2>
        </div>
        <span style={period}>Positions and candidates from requisitions you raised</span>
      </div>

      <div style={metrics}>
        <Metric label="Active openings" value={openPositions} detail={`${activeReqs.length} active requisitions`} accent="#3a6ea5" />
        <Metric label="Candidates in pipeline" value={totalCandidates} detail="Across your requisitions" accent="#4b8b68" />
        <Metric label="CVs awaiting your review" value={pendingHmReviews} detail="Pending HM approval" accent="#8b5dc7" />
        <Metric label="Offers awaiting approval" value={offersPending} detail="Department Head decision pending" accent="#c28a18" />
        <Metric label="Offers approved" value={offersApproved} detail="Approved, offered, or onboarded" accent="#4b8b68" />
      </div>

      <div className="ats-hm-chart-grid" style={chartGrid}>
        <section style={panel}>
          <div style={panelHeading}>
            <div><h3 className="ats-heading-panel">Candidate pipeline</h3><p className="ats-heading-subtitle">Candidates by current workflow stage</p></div>
          </div>
          {visibleStages.length ? (
            <div role="img" aria-label="Bar chart of candidate counts at each recruiting stage." style={stageList}>
              {visibleStages.map((stage) => {
                const count = stages[stage] || 0;
                return (
                  <div key={stage} style={stageRow}>
                    <span style={stageName}>{prettyStatus(stage)}</span>
                    <div style={stageTrack}><div style={{ ...stageBar, width: `${Math.max(4, (count / maxStage) * 100)}%`, background: statusColor(stage) }} /></div>
                    <b style={stageCount}>{count}</b>
                  </div>
                );
              })}
            </div>
          ) : <div style={empty}>No candidates across your requisitions yet.</div>}
        </section>

        <section style={panel}>
          <div style={panelHeading}>
            <div><h3 className="ats-heading-panel">Interview rounds reached</h3><p className="ats-heading-subtitle">Distinct candidates with an interview in each round</p></div>
          </div>
          {rounds.length ? (
            <div role="img" aria-label="Bar chart of distinct candidates reached per interview round." style={roundChart}>
              {rounds.map(([round, count]) => (
                <div key={round} style={roundColumn}>
                  <b style={roundValue}>{count}</b>
                  <div style={roundTrack}><div style={{ ...roundBar, height: `${Math.max(5, (count / maxRound) * 116)}px` }} /></div>
                  <span style={axisLabel}>Round {round}</span>
                </div>
              ))}
            </div>
          ) : <div style={empty}>No interviews have been scheduled yet.</div>}
        </section>
      </div>

      <section style={panel}>
        <div style={panelHeading}>
          <div><h3 className="ats-heading-panel">Positions and pipeline</h3><p className="ats-heading-subtitle">Openings, candidates, HM-approved CVs, interview rounds, and offers by requisition</p></div>
          <span style={totalBadge}>{requisitions.length} requisitions</span>
        </div>
        {requisitions.length ? (
          <div className="ats-table-wrap" style={{ marginTop: 12 }}>
            <table className="ats-table">
              <thead><tr><th>Position</th><th>Department</th><th>Status</th><th>Openings</th><th>Candidates</th><th>HM approved</th><th>Interview rounds</th><th>Offer pending</th><th>Offer approved</th></tr></thead>
              <tbody>
                {requisitions.map((requisition) => {
                  const counts = (requisition.stageCounts || {}) as Record<string, number>;
                  const roundCounts = Array.isArray(requisition.roundCounts) ? requisition.roundCounts as Item[] : [];
                  const offerApproved = (counts.OfferApproved || 0) + (counts.Offered || 0) + (counts.Onboarded || 0);
                  return (
                    <tr key={String(requisition.id)}>
                      <td><button type="button" className="ats-link-btn" onClick={() => onReq(String(requisition.id))}>{String(requisition.title)}</button><div className="ats-sub">{String(requisition.id)}</div></td>
                      <td>{String(requisition.department)}</td>
                      <td><span style={{ color: statusColor(String(requisition.status)), fontWeight: 650 }}>{prettyStatus(String(requisition.status))}</span></td>
                      <td className="num">{String(requisition.openings || 0)}</td>
                      <td className="num">{String(requisition.candidateCount || 0)}</td>
                      <td className="num">{String(counts.HMApproved || 0)}</td>
                      <td>{roundCounts.length ? roundCounts.map((round) => `R${String(round.round)}: ${String(round.candidates)}`).join(" · ") : "—"}</td>
                      <td className="num">{String(counts.OfferApprovalPending || 0)}</td>
                      <td className="num">{String(offerApproved)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div style={empty}>You have not raised any requisitions yet.</div>}
      </section>
    </div>
  );
}

function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function Metric({ label, value, detail, accent }: { label: string; value: unknown; detail: string; accent: string }) {
  return <div style={{ ...metric, borderTopColor: accent }}><span style={{ ...metricLabel, color: accent }}>{label}</span><b style={metricValue}>{String(value ?? 0)}</b><small style={metricDetail}>{detail}</small></div>;
}

const heading: CSSProperties = { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" };
const eyebrow: CSSProperties = { color: "#777", fontSize: 10, fontWeight: 750, letterSpacing: "0.08em" };
const period: CSSProperties = { color: "#777", fontSize: 12 };
const metrics: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9, marginBottom: 14 };
const metric: CSSProperties = { minWidth: 0, padding: "12px 13px", border: "1px solid #e9e5dc", borderTop: "3px solid #3a6ea5", borderRadius: 9, background: "#fff" };
const metricLabel: CSSProperties = { display: "block", fontSize: 11, fontWeight: 700 };
const metricValue: CSSProperties = { display: "block", marginTop: 5, color: "#20272d", fontSize: 25, lineHeight: 1.1 };
const metricDetail: CSSProperties = { display: "block", marginTop: 5, color: "#777", fontSize: 10 };
const chartGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 14 };
const panel: CSSProperties = { minWidth: 0, padding: 15, border: "1px solid #e9e5dc", borderRadius: 9, background: "#fff" };
const panelHeading: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const totalBadge: CSSProperties = { padding: "4px 8px", borderRadius: 999, background: "#f1f3f5", color: "#59616b", fontSize: 10, fontWeight: 700 };
const stageList: CSSProperties = { display: "grid", gap: 10, marginTop: 13 };
const stageRow: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(100px, 1fr) minmax(80px, 2fr) 24px", alignItems: "center", gap: 8 };
const stageName: CSSProperties = { overflow: "hidden", color: "#59616b", fontSize: 10, textOverflow: "ellipsis", whiteSpace: "nowrap" };
const stageTrack: CSSProperties = { height: 8, overflow: "hidden", borderRadius: 999, background: "#f0ede7" };
const stageBar: CSSProperties = { height: "100%", borderRadius: 999 };
const stageCount: CSSProperties = { color: "#333", fontSize: 11, textAlign: "right" };
const roundChart: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(50px, 1fr))", alignItems: "end", gap: 8, height: 168, marginTop: 10, padding: "0 4px", borderBottom: "1px solid #e9e5dc" };
const roundColumn: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, height: "100%" };
const roundValue: CSSProperties = { color: "#4b5563", fontSize: 11 };
const roundTrack: CSSProperties = { display: "flex", alignItems: "flex-end", justifyContent: "center", height: 116, width: "100%", borderBottom: "1px solid #f0ede7" };
const roundBar: CSSProperties = { width: "min(30px, 70%)", borderRadius: "4px 4px 0 0", background: "#3a6ea5" };
const axisLabel: CSSProperties = { color: "#777", fontSize: 10, textAlign: "center" };
const empty: CSSProperties = { marginTop: 12, padding: 20, border: "1px dashed #e5e0d4", borderRadius: 7, color: "#888", textAlign: "center", fontSize: 12 };