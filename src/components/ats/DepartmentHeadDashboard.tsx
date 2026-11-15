"use client";

import type { CSSProperties } from "react";
import { formatDate } from "@/lib/dateFormat";
import { prettyStatus, statusColor } from "./ui";

type Item = Record<string, unknown>;

const ACTIVE_STAGES = [
  "PendingHMApproval",
  "HMApproved",
  "Screened",
  "Shortlist",
  "Interview Scheduled",
  "Debrief",
  "Selected",
  "OfferApprovalPending",
  "OfferApproved",
  "Offered",
  "Onboarded",
];

export function DepartmentHeadDashboard({
  analytics,
  onReq,
  onCand,
}: {
  analytics: Record<string, unknown> | null;
  onReq: (id: string) => void;
  onCand: (id: string) => void;
}) {
  if (!analytics) return <p style={{ color: "#888" }}>Loading dashboard...</p>;

  const positions = (analytics.departmentHeadPositions || []) as Item[];
  const offers = (analytics.departmentHeadOffers || []) as Item[];
  const stages = (analytics.stages || {}) as Record<string, number>;
  const activeOpenings = positions.reduce((total, item) => total + (Number(item.openings) || 0), 0);
  const pendingOffers = offers.filter((item) => item.status === "Pending").length;
  const approvedOffers = offers.filter((item) => item.status === "Approved").length;
  const rejectedOffers = offers.filter((item) => item.status === "Rejected").length;
  const maxStage = Math.max(1, ...ACTIVE_STAGES.map((stage) => stages[stage] || 0));
  const ageGroups = [
    { label: "0-7 days", count: sumOpenings(positions.filter((item) => Number(item.ageDays) <= 7)), color: "#4b8b68" },
    { label: "8-15 days", count: sumOpenings(positions.filter((item) => Number(item.ageDays) >= 8 && Number(item.ageDays) <= 15)), color: "#c28a18" },
    { label: "16-30 days", count: sumOpenings(positions.filter((item) => Number(item.ageDays) >= 16 && Number(item.ageDays) <= 30)), color: "#df7c39" },
    { label: "30+ days", count: sumOpenings(positions.filter((item) => Number(item.ageDays) > 30)), color: "#8b5dc7" },
  ];
  const maxAge = Math.max(1, ...ageGroups.map((group) => group.count));

  return (
    <div className="ats-department-dashboard">
      <div style={heading}>
        <div>
          <span style={eyebrow}>DEPARTMENT OVERSIGHT</span>
          <h2 className="ats-heading-section" style={{ marginTop: 4 }}>Hiring Overview</h2>
        </div>
        <span style={period}>Positions approved by you · offers in your departments</span>
      </div>

      <div style={metrics}>
        <Metric label="Approved open positions" value={activeOpenings} detail={`${positions.length} requisitions`} accent="#3a6ea5" />
        <Metric label="Candidates in pipeline" value={analytics.totalCandidates} detail="Across your departments" accent="#4b8b68" />
        <Metric label="Offers pending" value={pendingOffers} detail="Awaiting your decision" accent="#8b5dc7" />
        <Metric label="Offers approved" value={approvedOffers} detail="Department decisions recorded" accent="#4b8b68" />
        <Metric label="Offers rejected" value={rejectedOffers} detail="With recorded decision" accent="#9a3b3b" />
      </div>

      <div className="ats-department-chart-grid" style={chartGrid}>
        <section style={panel}>
          <div style={panelHeading}>
            <div>
              <h3 className="ats-heading-panel">Approved openings by age</h3>
              <p className="ats-heading-subtitle">Openings across requisitions approved by you</p>
            </div>
            <span style={totalBadge}>{activeOpenings} openings</span>
          </div>
          <div role="img" aria-label="Bar chart of approved open positions grouped by requisition age." style={ageChart}>
            {ageGroups.map((group) => (
              <div key={group.label} style={ageColumn}>
                <b style={barValue}>{group.count}</b>
                <div style={barTrack}>
                  <div style={{ ...ageBar, height: `${group.count ? Math.max(6, (group.count / maxAge) * 112) : 3}px`, background: group.color, opacity: group.count ? 1 : 0.2 }} />
                </div>
                <span style={axisLabel}>{group.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={panel}>
          <div style={panelHeading}>
            <div>
              <h3 className="ats-heading-panel">Candidate pipeline</h3>
              <p className="ats-heading-subtitle">Candidates across your departments by stage</p>
            </div>
          </div>
          <div style={stageList}>
            {ACTIVE_STAGES.filter((stage) => stages[stage]).map((stage) => {
              const count = stages[stage] || 0;
              return (
                <div key={stage} style={stageRow}>
                  <span style={stageName}>{prettyStatus(stage)}</span>
                  <div style={stageTrack}><div style={{ ...stageBar, width: `${Math.max(4, (count / maxStage) * 100)}%`, background: statusColor(stage) }} /></div>
                  <b style={stageCount}>{count}</b>
                </div>
              );
            })}
            {!ACTIVE_STAGES.some((stage) => stages[stage]) && <div style={empty}>No candidates are currently in the pipeline.</div>}
          </div>
        </section>
      </div>

      <section style={panel}>
        <div style={panelHeading}>
          <div>
            <h3 className="ats-heading-panel">Positions approved by you</h3>
            <p className="ats-heading-subtitle">Active, reopened, and partially fulfilled requisitions</p>
          </div>
          <span style={totalBadge}>{positions.length} active</span>
        </div>
        {positions.length ? (
          <div className="ats-table-wrap" style={{ marginTop: 12 }}>
            <table className="ats-table">
              <thead><tr><th>Position</th><th>Department</th><th>Location</th><th>Openings</th><th>Candidates</th><th>Status</th><th>Approved</th><th>Age</th></tr></thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={String(position.id)}>
                    <td><button type="button" className="ats-link-btn" onClick={() => onReq(String(position.id))}>{String(position.title)}</button></td>
                    <td>{String(position.department)}</td>
                    <td>{String(position.location || "—")}</td>
                    <td className="num">{String(position.openings || 0)}</td>
                    <td className="num">{String(position.candidateCount || 0)}</td>
                    <td><span style={{ color: statusColor(String(position.status)), fontWeight: 700 }}>{prettyStatus(String(position.status))}</span></td>
                    <td>{formatDate(String(position.approvedAt || ""), "—")}</td>
                    <td>{String(position.ageDays)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={empty}>No active positions approved by you.</div>}
      </section>

      <section style={{ ...panel, marginTop: 14 }}>
        <div style={panelHeading}>
          <div>
            <h3 className="ats-heading-panel">Offer decisions and compensation</h3>
            <p className="ats-heading-subtitle">Offer requests in your departments, including requests awaiting a decision</p>
          </div>
          <span style={totalBadge}>{offers.length} offers</span>
        </div>
        {offers.length ? (
          <div className="ats-table-wrap" style={{ marginTop: 12 }}>
            <table className="ats-table">
              <thead><tr><th>Candidate</th><th>Position</th><th>Offer decision</th><th>Candidate stage</th><th>Submitted</th><th>Tentative DOJ</th><th>Fixed CTC</th><th>Variable CTC</th><th>ESOPs</th><th>Joining bonus</th><th>Relocation</th><th>Decision date</th></tr></thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={String(offer.candidateId)}>
                    <td><button type="button" className="ats-link-btn" onClick={() => onCand(String(offer.candidateId))}>{String(offer.candidateName)}</button></td>
                    <td>{String(offer.requisitionTitle)}</td>
                    <td><span style={{ color: statusColor(String(offer.status)), fontWeight: 700 }}>{String(offer.status)}</span>{String(offer.status) === "Rejected" && typeof offer.offerRejectReason === "string" && <small style={rejectReason}>{offer.offerRejectReason}</small>}</td>
                    <td>{prettyStatus(String(offer.candidateStage || "—"))}</td>
                    <td>{formatDate(String(offer.offerRequestedAt || ""), "—")}</td>
                    <td>{formatDate(String(offer.tentativeDoj || ""), "—")}</td>
                    <td>{String(offer.offeredFixedCtc || "—")}</td>
                    <td>{String(offer.offeredVariableCtc || "—")} ({String(offer.offeredVariablePeriod || "—")})</td>
                    <td>{String(offer.offeredEsops || "—")}</td>
                    <td>{String(offer.joiningBonus || "—")}</td>
                    <td>{offer.relocationAssistance === undefined ? "—" : offer.relocationAssistance ? "Yes" : "No"}</td>
                    <td>{formatDate(String(offer.offerDecisionAt || ""), "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={empty}>No offer requests in your departments yet.</div>}
      </section>
    </div>
  );
}

function sumOpenings(items: Item[]) {
  return items.reduce((total, item) => total + (Number(item.openings) || 0), 0);
}

function Metric({ label, value, detail, accent }: { label: string; value: unknown; detail: string; accent: string }) {
  return <div style={{ ...metric, borderTopColor: accent }}><span style={{ ...metricLabel, color: accent }}>{label}</span><b style={metricValue}>{String(value ?? 0)}</b><small style={metricDetail}>{detail}</small></div>;
}

const heading: CSSProperties = { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" };
const eyebrow: CSSProperties = { color: "#777", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" };
const period: CSSProperties = { color: "#777", fontSize: 12 };
const metrics: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9, marginBottom: 14 };
const metric: CSSProperties = { minWidth: 0, padding: "12px 13px", border: "1px solid #e9e5dc", borderTop: "3px solid #3a6ea5", borderRadius: 9, background: "#fff" };
const metricLabel: CSSProperties = { display: "block", fontSize: 12, fontWeight: 700 };
const metricValue: CSSProperties = { display: "block", marginTop: 5, color: "#20272d", fontSize: 26, lineHeight: 1.1 };
const metricDetail: CSSProperties = { display: "block", marginTop: 5, color: "#777", fontSize: 12 };
const chartGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14, marginBottom: 14 };
const panel: CSSProperties = { minWidth: 0, padding: 15, border: "1px solid #e9e5dc", borderRadius: 9, background: "#fff" };
const panelHeading: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const totalBadge: CSSProperties = { padding: "4px 8px", borderRadius: 999, background: "#f1f3f5", color: "#59616b", fontSize: 12, fontWeight: 700 };
const ageChart: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", alignItems: "end", gap: 10, height: 168, marginTop: 10, padding: "0 4px", borderBottom: "1px solid #e9e5dc" };
const ageColumn: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, height: "100%" };
const barValue: CSSProperties = { color: "#4b5563", fontSize: 12 };
const barTrack: CSSProperties = { display: "flex", alignItems: "flex-end", justifyContent: "center", height: 115, width: "100%", borderBottom: "1px solid #f0ede7" };
const ageBar: CSSProperties = { width: "min(34px, 70%)", borderRadius: "4px 4px 0 0" };
const axisLabel: CSSProperties = { color: "#777", fontSize: 12, textAlign: "center" };
const stageList: CSSProperties = { display: "grid", gap: 10, marginTop: 13 };
const stageRow: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(100px, 1fr) minmax(80px, 2fr) 24px", alignItems: "center", gap: 8 };
const stageName: CSSProperties = { overflow: "hidden", color: "#59616b", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" };
const stageTrack: CSSProperties = { height: 8, overflow: "hidden", borderRadius: 999, background: "#f0ede7" };
const stageBar: CSSProperties = { height: "100%", borderRadius: 999 };
const stageCount: CSSProperties = { color: "#333", fontSize: 12, textAlign: "right" };
const empty: CSSProperties = { marginTop: 12, padding: 20, border: "1px dashed #e5e0d4", borderRadius: 7, color: "#888", textAlign: "center", fontSize: 12 };
const rejectReason: CSSProperties = { display: "block", maxWidth: 150, marginTop: 4, color: "#9a3b3b", fontSize: 12, whiteSpace: "normal" };