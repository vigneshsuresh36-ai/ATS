"use client";

import type { CSSProperties } from "react";
import { prettyStatus, statusColor } from "./ui";

type Item = Record<string, unknown>;

export function RecruiterDashboard({
  analytics,
  onReq,
}: {
  analytics: Record<string, unknown> | null;
  onReq: (id: string) => void;
}) {
  if (!analytics) return <p style={{ color: "#888" }}>Loading dashboard...</p>;

  const activity = (analytics.weeklyActivity || []) as Item[];
  const positions = (analytics.openPositionsList || []) as Item[];
  const series = [
    { key: "candidatesAdded", label: "Candidates", color: "#3a6ea5" },
    { key: "interviewsBooked", label: "Interviews", color: "#8b5dc7" },
    { key: "feedbackSubmitted", label: "Feedback", color: "#4b8b68" },
    { key: "offersIssued", label: "Offers", color: "#c28a18" },
  ];
  const maxActivity = Math.max(
    1,
    ...activity.flatMap((day) => series.map((item) => Number(day[item.key]) || 0))
  );

  return (
    <div className="ats-recruiter-dashboard">
      <div style={heading}>
        <div>
          <span style={eyebrow}>MY WORKLOAD</span>
          <h2 className="ats-heading-section" style={{ marginTop: 4 }}>Recruiting Overview</h2>
        </div>
        <span style={period}>Last 7 days · through today</span>
      </div>

      <div style={metricGrid}>
        <Metric label="Open positions" value={analytics.openPositions} detail={`${analytics.openReqs ?? 0} requisitions`} color="#3a6ea5" />
        <Metric label="Pipeline candidates" value={analytics.totalCandidates} detail="Active candidate records" color="#4b8b68" />
        <Metric label="Interviews today" value={analytics.interviewsToday} detail="Across assigned positions" color="#8b5dc7" />
        <Metric label="Feedback pending" value={(analytics.feedbackPending as { total?: number } | undefined)?.total} detail="Past interviews awaiting notes" color="#c28a18" />
        <Metric label="Offers in progress" value={analytics.offersInProgress} detail="Approval or offer stage" color="#7659a5" />
      </div>

      <div className="ats-recruiter-content-grid" style={contentGrid}>
        <section style={panel}>
          <div style={panelHead}>
            <div>
              <h3 className="ats-heading-panel">Weekly activity</h3>
              <p className="ats-heading-subtitle">Work recorded in your assigned requisitions</p>
            </div>
            <div style={legend}>
              {series.map((item) => (
                <span key={item.key} style={legendItem}>
                  <i style={{ ...legendDot, background: item.color }} />{item.label}
                </span>
              ))}
            </div>
          </div>
          <div role="img" aria-label="Grouped bar chart of candidates added, interviews booked, feedback submitted, and offers issued over the last seven days." style={chart}>
            {[0, 0.5, 1].map((fraction) => (
              <div key={fraction} style={{ ...gridLine, bottom: `${22 + fraction * 118}px` }}>
                <span>{Math.round(maxActivity * fraction)}</span>
              </div>
            ))}
            {activity.map((day) => (
              <div key={String(day.date)} style={dayColumn}>
                <div style={bars}>
                  {series.map((item) => {
                    const value = Number(day[item.key]) || 0;
                    return (
                      <div
                        key={item.key}
                        title={`${item.label}: ${value}`}
                        style={{
                          ...bar,
                          height: `${value === 0 ? 3 : Math.max(8, (value / maxActivity) * 118)}px`,
                          background: item.color,
                          opacity: value === 0 ? 0.18 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                <span style={dayLabel}>{String(day.day)}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={panel}>
          <div style={panelHead}>
            <div>
              <h3 className="ats-heading-panel">Positions needing attention</h3>
              <p className="ats-heading-subtitle">Open roles ordered by age</p>
            </div>
            <span style={countPill}>{positions.length} open</span>
          </div>
          {positions.length ? (
            <div style={positionList}>
              {positions.slice(0, 7).map((position) => {
                const age = Number(position.ageDays) || 0;
                const candidates = Number(position.candidateCount) || 0;
                const attention = age >= 30 || candidates === 0;
                return (
                  <button key={String(position.id)} type="button" style={positionRow} onClick={() => onReq(String(position.id))}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <b style={positionTitle}>{String(position.title)}</b>
                      <small style={positionMeta}>{String(position.department)} · {String(position.openings)} openings · {candidates} candidates</small>
                    </span>
                    <span style={{ textAlign: "right", flexShrink: 0 }}>
                      <b style={{ ...ageValue, color: attention ? "#8b5dc7" : "#59616b" }}>{age}d</b>
                      <small style={{ ...positionMeta, color: statusColor(String(position.status)) }}>{prettyStatus(String(position.status))}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={empty}>No open positions assigned.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, color }: { label: string; value: unknown; detail: string; color: string }) {
  return (
    <section style={metric}>
      <span style={{ ...metricLabel, color }}>{label}</span>
      <b style={metricValue}>{String(value ?? 0)}</b>
      <small style={metricDetail}>{detail}</small>
    </section>
  );
}

const heading: CSSProperties = { display: "flex", alignItems: "end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "4px 0 14px" };
const eyebrow: CSSProperties = { color: "#777", fontSize: 10, fontWeight: 750, letterSpacing: "0.08em" };
const period: CSSProperties = { color: "#777", fontSize: 12 };
const metricGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 9, marginBottom: 14 };
const metric: CSSProperties = { minWidth: 0, padding: "12px 13px", border: "1px solid #e9e5dc", borderTop: "3px solid #3a6ea5", borderRadius: 9, background: "#fff" };
const metricLabel: CSSProperties = { display: "block", fontSize: 11, fontWeight: 700 };
const metricValue: CSSProperties = { display: "block", marginTop: 5, color: "#20272d", fontSize: 25, lineHeight: 1.1 };
const metricDetail: CSSProperties = { display: "block", marginTop: 5, color: "#777", fontSize: 10 };
const contentGrid: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(300px, 0.85fr)", gap: 14, alignItems: "start" };
const panel: CSSProperties = { minWidth: 0, padding: 15, border: "1px solid #e9e5dc", borderRadius: 9, background: "#fff" };
const panelHead: CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const legend: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap" };
const legendItem: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, color: "#666", fontSize: 10 };
const legendDot: CSSProperties = { width: 7, height: 7, borderRadius: 2 };
const chart: CSSProperties = { position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", alignItems: "end", gap: 5, height: 180, marginTop: 12, padding: "12px 2px 0 22px", borderBottom: "1px solid #e9e5dc" };
const gridLine: CSSProperties = { position: "absolute", left: 22, right: 0, borderTop: "1px solid #f0ede7", color: "#999", fontSize: 9 };
const dayColumn: CSSProperties = { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, height: "100%", minWidth: 0 };
const bars: CSSProperties = { display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, width: "100%", height: 132 };
const bar: CSSProperties = { width: "min(10px, 22%)", minHeight: 3, borderRadius: "3px 3px 0 0", transition: "height 180ms ease" };
const dayLabel: CSSProperties = { color: "#777", fontSize: 9 };
const countPill: CSSProperties = { padding: "4px 8px", borderRadius: 999, background: "#f1f3f5", color: "#59616b", fontSize: 10, fontWeight: 700 };
const positionList: CSSProperties = { display: "grid", gap: 5, marginTop: 12 };
const positionRow: CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", border: "1px solid #efede7", borderRadius: 7, background: "#fbfaf7", color: "#20272d", textAlign: "left", cursor: "pointer" };
const positionTitle: CSSProperties = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 };
const positionMeta: CSSProperties = { display: "block", marginTop: 3, color: "#777", fontSize: 10 };
const ageValue: CSSProperties = { display: "block", fontSize: 12 };
const empty: CSSProperties = { marginTop: 12, padding: 20, border: "1px dashed #e5e0d4", borderRadius: 7, color: "#888", textAlign: "center", fontSize: 12 };