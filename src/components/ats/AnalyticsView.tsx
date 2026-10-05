"use client";

import type { CSSProperties } from "react";
import { formatDateTime } from "@/lib/dateFormat";
import { prettyStatus } from "./ui";

type Item = Record<string, unknown>;

type AnalyticsProps = {
  data: Record<string, unknown> | null;
  today: Record<string, unknown> | null;
  onReq: (id: string) => void;
  onCand: (id: string) => void;
};

export function AnalyticsView({ data, today, onReq, onCand }: AnalyticsProps) {
  if (!data) return <p style={{ color: "#888" }}>Loading dashboard...</p>;

  const stages = (data.stages || {}) as Record<string, number>;
  const stageIds = (data.stageCandidateIds || {}) as Record<string, string[]>;
  const ageing = (data.requisitionAgeing || {}) as { totalOpen?: number; buckets?: Record<string, number>; oldest?: Item[] };
  const feedback = (data.feedbackPending || {}) as { total?: number; ageing?: Record<string, number>; items?: Item[] };
  const sourcePerformance = (data.sourcePerformance || []) as Item[];
  const workload = (data.recruiterWorkload || []) as Item[];
  const openPositions = (data.openPositionsList || []) as Item[];
  const pendingCandidateReviews = (data.candidateReviewsPending || {}) as { count?: number; items?: Item[] };
  const offersByRecruiter = (data.offersByRecruiter || []) as Item[];
  const interviewsToday = (data.interviewsTodayItems || []) as Item[];
  const upcoming = ((today?.upcomingInterviews as Item[] | undefined) || []).slice(0, 8);
  const actions: Item[] = [
    ...((today?.awaitingFb as Item[] | undefined) || []).map((item) => ({ ...item, action: "Await feedback" })),
    ...((today?.nextRoundPending as Item[] | undefined) || []).map((item) => ({ ...item, action: "Schedule next round" })),
    ...((today?.offersPending as Item[] | undefined) || []).map((item) => ({ ...item, action: "Review offer approval" })),
  ].slice(0, 12);
  const reqAttention = [
    ...((today?.reqsNeed as Item[] | undefined) || []),
    ...((ageing.oldest || []).filter((item) => Number(item.ageDays) >= 16)),
  ].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 10);
  const stageOrder = ["New", "Screened", "Shortlist", "HMApproved", "Interview Scheduled", "Debrief", "Selected", "OfferApprovalPending", "OfferApproved", "Offered", "Onboarded"];
  const maxStage = Math.max(1, ...Object.values(stages));

  return (
    <div className="ats-analytics" style={{ marginTop: 20 }}>
      <SectionTitle title="Hiring Overview" subtitle="The numbers behind your recruitment workload." />
      <div className="ats-metric-grid" style={metricGrid}>
        <Metric label="Open positions" value={data.openPositions ?? data.openReqs} />
        <Metric label="Candidates in Pipeline" value={data.totalCandidates} />
        <Metric label="Interviews Today" value={data.interviewsToday ?? interviewsToday.length} />
        <Metric label="Interviews This Month" value={data.interviewsThisMonth} />
        <Metric label="Offers in Progress" value={data.offersInProgress} />
        <Metric label="Joined This Month" value={data.joinedThisMonth} />
        <Metric label="Average Time to Hire" value={data.averageTimeToHire == null ? "--" : data.averageTimeToHire} />
      </div>

      <SectionTitle title="Candidate Pipeline" subtitle="Click a stage count to open a candidate record." />
      <section className="ats-pipeline-summary" style={card}>
        <div style={pipelineGrid}>
          {stageOrder.map((stage) => {
            const count = stages[stage] || 0;
            const firstCandidate = stageIds[stage]?.[0];
            return <button key={stage} type="button" onClick={() => firstCandidate && onCand(firstCandidate)} style={pipelineStage} disabled={!firstCandidate}>
              <span style={{ fontSize: 12, color: "#666" }}>{prettyStatus(stage)}</span>
              <b style={{ fontSize: 24 }}>{count}</b>
              <span style={{ height: 6, borderRadius: 6, background: count ? "#3a6ea5" : "#e7e2d5", width: `${Math.max(5, (count / maxStage) * 100)}%` }} />
            </button>;
          })}
        </div>
      </section>

      <div style={twoColumn}>
        <section style={card}>
          <SectionTitle title="Open Position Aging" subtitle={`${Number(data.openPositions) || 0} openings across ${Number(ageing.totalOpen) || 0} active requisitions.`} />
          <div style={bucketGrid}>{["0-7 days", "8-15 days", "16-30 days", "30+ days"].map((bucket) => <div key={bucket} style={bucketCard}><span>{bucket}</span><b>{agingValue(bucket, ageing.buckets)}</b></div>)}</div>
          <div style={detailList}>{(openPositions.length ? openPositions : ageing.oldest || []).slice(0, 8).map((item) => <button key={String(item.id)} type="button" style={detailRow} onClick={() => onReq(String(item.id))}><span><b>{String(item.title)}</b><small style={subtle}>{String(item.id)} · {String(item.location || "Location not set")} · {String(item.openings || 0)} openings · {String(item.recruiter || "Unassigned")}</small><small style={subtle}>Consultants: {Array.isArray(item.consultants) && item.consultants.length ? item.consultants.join(", ") : "None recorded"}</small></span><strong>{String(item.ageDays)}d</strong></button>)}</div>
        </section>

        <section style={card}>
          <SectionTitle title="Pending Feedback Aging" subtitle="Completed interviews still waiting for notes." />
          <div style={bucketGrid}>{["<24 Hours", "1-2 Days", "3-5 Days", "5+ Days"].map((bucket) => <div key={bucket} style={bucketCard}><span>{bucket}</span><b>{feedbackBucket(bucket, feedback.items || [])}</b></div>)}</div>
          <div style={detailList}>{(feedback.items || []).slice(0, 6).map((item) => <button key={String(item.interviewId)} type="button" style={detailRow} onClick={() => onCand(String(item.candidateId))}><span><b>{String(item.candidateName)}</b><small style={subtle}>{String(item.requisitionTitle)} · {String(item.interviewerEmails || "Interviewer")}</small></span><strong style={{ color: Number(item.ageDays) >= 5 ? "#a33" : "#a15c00" }}>{String(item.ageDays)}d</strong></button>)}</div>
        </section>
      </div>

      <div style={twoColumn}>
        <section style={card}>
          <SectionTitle title="CV / Hiring Manager Reviews" subtitle={`${pendingCandidateReviews.count || 0} candidates awaiting Hiring Manager feedback.`} />
          <div style={detailList}>{(pendingCandidateReviews.items || []).slice(0, 8).map((item) => <button key={String(item.id)} type="button" style={detailRow} onClick={() => onCand(String(item.id))}><span><b>{String(item.name)}</b><small style={subtle}>{String(item.requisitionTitle)} · {String(item.reqId)}</small></span><strong>{String(item.ageDays)}d</strong></button>)}{!(pendingCandidateReviews.items || []).length && <Empty text="No candidate reviews pending." />}</div>
        </section>
        <section style={card}>
          <SectionTitle title="Today's Interviews" subtitle={`${interviewsToday.length} interviews scheduled across the team.`} />
          <div style={detailList}>{interviewsToday.length ? interviewsToday.slice(0, 8).map((item) => <button key={String(item.id)} type="button" style={detailRow} onClick={() => onCand(String(item.candidateId))}><span><b>{String(item.candidateName)}</b><small style={subtle}>{String(item.requisitionTitle)} · {String(item.roundName || `Round ${item.roundIndex || 1}`)} · {String(item.interviewerEmails || "Interviewer")}</small></span><strong>{formatDateTime(String(item.datetime))}</strong></button>) : <Empty text="No interviews scheduled today." />}</div>
        </section>
      </div>

      <div style={twoColumn}>
        <section style={card}><SectionTitle title="Upcoming Interviews" subtitle="Next scheduled interviews." /><div style={detailList}>{upcoming.length ? upcoming.map((item) => { const candidate = (item.candidate || {}) as Item; const req = (item.requisition || {}) as Item; return <button key={String(item.id)} type="button" style={detailRow} onClick={() => onCand(String(item.candidateId))}><span><b>{String(candidate.name || "Candidate")}</b><small style={subtle}>{String(req.title || item.reqId)} · {String(item.roundName || "Round") } · {String(item.interviewerEmails || "Interviewer")}</small></span><strong>{formatDateTime(String(item.datetime))}</strong></button>; }) : <Empty text="No upcoming interviews." />}</div></section>
        <section style={card}><SectionTitle title="Requisitions Needing Attention" subtitle="Open roles with no candidates or high aging." /><div style={detailList}>{reqAttention.length ? reqAttention.map((item) => <button key={String(item.id)} type="button" style={detailRow} onClick={() => onReq(String(item.id))}><span><b>{String(item.title)}</b><small style={subtle}>{String(item.location || "Location not set")} · {String(item.candidateCount || 0)} candidates</small></span><strong>{Number(item.ageDays) >= 16 ? "Aging" : "Needs candidates"}</strong></button>) : <Empty text="No requisitions need attention." />}</div></section>
      </div>

      <SectionTitle title="Candidate Actions" subtitle="Candidates with a next action waiting." />
      <section style={card}><div style={detailList}>{actions.length ? actions.map((item) => <button key={`${String(item.id)}-${String(item.action)}`} type="button" style={detailRow} onClick={() => onCand(String(item.id))}><span><b>{String(item.name)}</b><small style={subtle}>{String(item.reqId)} · {prettyStatus(String(item.stage || ""))}</small></span><strong style={{ color: "#8b5dc7" }}>{String(item.action)}</strong></button>) : <Empty text="No candidate actions waiting." />}</div></section>

      <div style={twoColumn}>
        <section style={card}><SectionTitle title="Recruiter Workload" subtitle="Existing requisition owners and their active workload." /><DataTable headers={["Recruiter", "Open reqs", "Candidates", "Interviews", "Feedback pending"]} rows={workload.map((item) => [item.recruiter, item.openReqs, item.candidates, item.interviews, item.feedbackPending])} /></section>
        <section style={card}><SectionTitle title="Vendor and Source Performance" subtitle="Which source is producing the strongest pipeline." /><DataTable headers={["Source / vendor", "Candidates", "Interviews", "Selected", "Offers"]} rows={sourcePerformance.slice(0, 8).map((item) => [item.source, item.candidates, item.interviews, item.selected, item.offers])} /></section>
      </div>

      <section style={{ ...card, marginBottom: 14 }}>
        <SectionTitle title="Offers by Recruiter" subtitle="Candidates moved to Offered during the current Monday-start week and month." />
        <DataTable headers={["Recruiter", "This week", "This month"]} rows={offersByRecruiter.map((item) => [item.recruiter, item.thisWeek, item.thisMonth])} />
      </section>

      <SectionTitle title="Hiring Trends" subtitle="Analytics remain at the bottom so daily work stays primary." />
      <section style={card}><DataTable headers={["Applications", "Interviews", "Offers", "Joinees", "Time to hire"]} rows={[[data.totalCandidates, data.interviewsThisMonth, data.offersInProgress, data.joinedThisMonth, data.averageTimeToHire == null ? "--" : data.averageTimeToHire]]} /></section>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) { return <div style={{ margin: "0 0 10px" }}><h2 className="ats-heading-section">{title}</h2>{subtitle && <p className="ats-heading-subtitle">{subtitle}</p>}</div>; }
function Metric({ label, value }: { label: string; value: unknown }) { return <div style={metric}><span style={subtle}>{label}</span><b style={{ fontSize: 24 }}>{String(value ?? "--")}</b></div>; }
function Empty({ text }: { text: string }) { return <div style={empty}>{text}</div>; }
function DataTable({ headers, rows }: { headers: string[]; rows: unknown[][] }) { return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}><thead><tr>{headers.map((header) => <th key={header} style={th}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} style={td}>{String(cell ?? "--")}</td>)}</tr>)}</tbody></table></div>; }
function agingValue(bucket: string, values?: Record<string, number>) { return values?.[bucket] || 0; }
function feedbackBucket(bucket: string, items: Item[]) { return items.filter((item) => { const hours = Number(item.feedbackAgeHours ?? Number(item.ageDays || 0) * 24); return bucket === "<24 Hours" ? hours < 24 : bucket === "1-2 Days" ? hours >= 24 && hours < 48 : bucket === "3-5 Days" ? hours >= 48 && hours < 120 : hours >= 120; }).length; }
const card: CSSProperties = { background: "#fff", border: "1px solid #ebe6da", borderRadius: 14, padding: 16, boxShadow: "0 1px 0 rgba(40,35,20,.03)" };
const metricGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 22 };
const metric: CSSProperties = { ...card, display: "flex", flexDirection: "column", gap: 7, padding: "12px 14px" };
const twoColumn: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 14 };
const pipelineGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 };
const pipelineStage: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, border: "1px solid #ebe6da", background: "#faf9f6", borderRadius: 9, padding: 10, cursor: "pointer", textAlign: "left" };
const bucketGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, margin: "12px 0" };
const bucketCard: CSSProperties = { display: "flex", flexDirection: "column", gap: 5, padding: "9px 10px", background: "#faf9f6", border: "1px solid #f0ece3", borderRadius: 8, fontSize: 11 };
const detailList: CSSProperties = { display: "grid", gap: 6 };
const detailRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", border: "1px solid #f0ece3", background: "#faf9f6", borderRadius: 8, padding: "9px 10px", textAlign: "left", cursor: "pointer", color: "#2c2c28" };
const subtle: CSSProperties = { display: "block", color: "#777", fontSize: 11, marginTop: 3 };
const empty: CSSProperties = { border: "1px dashed #e5e0d4", borderRadius: 8, padding: 14, textAlign: "center", color: "#aaa", fontSize: 12 };
const th: CSSProperties = { textAlign: "left", padding: "7px 8px", color: "#777", borderBottom: "1px solid #ebe6da", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "8px", borderBottom: "1px solid #f0ece3", whiteSpace: "nowrap" };