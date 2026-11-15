"use client";
import { useState } from "react";
import { formatDate } from "@/lib/dateFormat";
type Item = Record<string, unknown>;
type Props = { data: Item | null; today: Item | null; joiners: Item[]; onReq: (id: string) => void; onCand: (id: string) => void; onApprovals: () => void; onJoining: () => void; showJoining: boolean };
const excluded = new Set(["Rejected", "Social CV Reject", "Candidate Backed Out", "Onboarded"]);
const groups: [string, string[]][] = [["New & screening", ["New", "Social CV", "Screened", "Shortlist", "PendingHMApproval", "HMApproved"]], ["Interviews", ["Interview", "Interview Scheduled", "Debrief"]], ["Selected", ["Selected"]], ["Offer", ["OfferApprovalPending", "OfferApproved", "Offered"]], ["On hold", ["On Hold"]]];
export function RecruitmentHeadOverview({ data, today, joiners, onReq, onCand, onApprovals, onJoining, showJoining }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data || !today) return <p role="status">Loading recruitment overview…</p>;
  const stages = (data.stages || {}) as Record<string, number>;
  const active = Object.entries(stages).filter(([stage]) => !excluded.has(stage)).reduce((sum, [, count]) => sum + count, 0);
  const feedback = ((data.feedbackPending || {}) as { total?: number }).total || 0;
  const pending = (today.pendingApprovals as Item[] | undefined) || [];
  const offerItems = (today.offersPending as Item[] | undefined) || [];
  const needed = (today.reqsNeed as Item[] | undefined) || [];
  const fbItems = (today.awaitingFb as Item[] | undefined) || [];
  const roles = (data.openPositionsList as Item[] | undefined) || [];
  const timelines = (data.joiningTimelineAttention as Item[] | undefined) || [];
  const workload = (data.recruiterWorkload as Item[] | undefined) || [];
  const overdue = (today.stuck as Item[] | undefined) || [];
  const reviews = (data.candidateReviewsPending || {}) as { count?: number; items?: Item[] };
  const interviews = (data.interviewsTodayItems as Item[] | undefined) || [];
  const ageing = ((data.requisitionAgeing || {}) as { buckets?: Record<string, number> }).buckets || {};
  const sources = (data.sourcePerformance as Item[] | undefined) || [];
  const weekly = (data.weeklyActivity as Item[] | undefined) || [];
  const offerCount = offerItems.length;
  const metrics = [["Open roles", Number(data.openReqs || 0)], ["Active candidates", active], ["Pending feedback", feedback], ["Offers awaiting approval", offerCount]] as const;
  const attention = [
    { id: "feedback", label: "Feedback awaiting submission", detail: "Past interviews without feedback", count: feedback, items: fbItems, kind: "candidate" },
    { id: "roles", label: "Roles without candidates", detail: "Open roles with no candidate records", count: needed.length, items: needed, kind: "role" },
    { id: "joining-due", label: "Joining targets approaching", detail: "Within 7 days of the target, measured from approval", count: timelines.filter((item) => item.status === "approaching").length, items: timelines.filter((item) => item.status === "approaching"), kind: "role" },
    { id: "joining-overdue", label: "Joining targets overdue", detail: "Open roles past their target, measured from approval", count: timelines.filter((item) => item.status === "overdue").length, items: timelines.filter((item) => item.status === "overdue"), kind: "role" },
    { id: "approvals", label: "Pending requisition approvals", detail: "Requests awaiting a decision", count: pending.length, items: pending, kind: "approval" },
    { id: "offers", label: "Offers awaiting approval", detail: "Candidates awaiting an offer decision", count: offerCount, items: offerItems, kind: "candidate" },
    { id: "reviews", label: "Candidate reviews awaiting hiring manager", detail: "Candidates pending hiring manager approval", count: reviews.count || 0, items: reviews.items || [], kind: "candidate" },
    { id: "overdue", label: "Candidates beyond stage target", detail: `Time in stage exceeds the ${Number(today.sla || 0)}-day target`, count: overdue.length, items: overdue, kind: "candidate" },
  ];
  const max = Math.max(1, ...groups.map(([, keys]) => keys.reduce((sum, key) => sum + (stages[key] || 0), 0)));
  return <div className="ats-head-overview">
    <header className="ats-head-title"><span>RECRUITMENT</span><h1>Recruitment overview</h1><p>Monitor hiring health and unblock your team.</p></header>
    <section className="ats-head-metrics" aria-label="Hiring summary">{metrics.map(([label, value], index) => <div key={label}><i className={`ats-head-dot dot-${index}`} /><strong>{value}</strong><span>{label}</span></div>)}</section>
    <div className="ats-head-grid"><section className="ats-head-card"><h2>Needs attention</h2><p>Action items to keep hiring on track.</p><div className="ats-head-attention">{attention.map((item, index) => <div key={item.id}><button type="button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}><i className={`ats-head-dot dot-${index === 0 ? 3 : 2}`} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><b>{item.count}</b><span>View {expanded === item.id ? "↑" : "→"}</span></button>{expanded === item.id && <div className="ats-head-expanded">{item.items.length ? item.items.map((row, i) => <button type="button" key={`${String(row.id)}-${i}`} onClick={() => item.kind === "approval" ? onApprovals() : item.kind === "role" ? onReq(String(row.id)) : onCand(String(row.id))}><span>{String(row.name || row.title || "Record")}</span><span>Open →</span></button>) : <p>No records to show.</p>}{item.count > item.items.length && <small>Showing {item.items.length} of {item.count}.</small>}</div>}</div>)}</div></section>
    <section className="ats-head-card"><h2>Hiring pipeline</h2><p>Active candidates by current stage.</p><div className="ats-head-pipeline">{groups.map(([label, keys]) => { const count = keys.reduce((sum, key) => sum + (stages[key] || 0), 0); return <div key={label}><span>{label}</span><div className="ats-head-bar"><i style={{ width: `${count / max * 100}%` }} /></div><strong>{count}</strong></div>; })}</div></section>
    <section className="ats-head-card"><h2>Roles needing attention</h2><p>Open roles with no candidates, followed by the oldest roles.</p><div className="ats-head-table"><div className="ats-head-row ats-head-table-title"><span>Role</span><span>Department</span><span>Age</span><span>Reason</span></div>{[...roles].sort((a,b) => Number(Number(a.candidateCount || 0) > 0) - Number(Number(b.candidateCount || 0) > 0) || Number(b.ageDays || 0) - Number(a.ageDays || 0)).slice(0, 5).map((row) => <button type="button" className="ats-head-row" key={String(row.id)} onClick={() => onReq(String(row.id))}><strong>{String(row.title)}</strong><span>{String(row.department || "—")}</span><span>{String(row.ageDays ?? "—")} days</span><span>{Number(row.candidateCount || 0) === 0 ? "No candidates" : "Open role"}</span></button>)}{!roles.length && <p>No open roles.</p>}</div></section>
    <section className="ats-head-card"><h2>Recruiter workload</h2><p>Open roles and pending feedback by assigned recruiter.</p><div className="ats-head-table"><div className="ats-head-work-row ats-head-table-title"><span>Recruiter</span><span>Open roles</span><span>Pending feedback</span></div>{workload.filter((row) => Number(row.openReqs || 0) > 0 || Number(row.feedbackPending || 0) > 0).slice(0, 5).map((row) => <div className="ats-head-work-row" key={String(row.recruiter)}><strong>{String(row.recruiter)}</strong><span>{String(row.openReqs || 0)}</span><span>{String(row.feedbackPending || 0)}</span></div>)}{!workload.length && <p>No workload to show.</p>}</div></section></div>
    <div className="ats-head-grid ats-head-insights">
      <section className="ats-head-card"><h2>Open role ageing</h2><p>Days since the hiring request was created.</p><div className="ats-head-ageing">{["0-7 days", "8-15 days", "16-30 days", "30+ days"].map((label) => <div key={label}><strong>{ageing[label] || 0}</strong><span>{label}</span></div>)}</div></section>
      <section className="ats-head-card"><h2>Activity in the last 7 days</h2><p>New candidates, interviews booked and feedback submitted.</p><div className="ats-head-ageing">{([["Candidates added", "candidatesAdded"], ["Interviews booked", "interviewsBooked"], ["Feedback submitted", "feedbackSubmitted"]] as const).map(([label, key]) => <div key={key}><strong>{weekly.reduce((sum, day) => sum + Number(day[key] || 0), 0)}</strong><span>{label}</span></div>)}</div></section>
      <section className="ats-head-card"><h2>Today’s interviews</h2><p>Scheduled interviews for today.</p><div className="ats-head-list">{interviews.length ? interviews.slice(0, 6).map((item) => <button type="button" key={String(item.id)} onClick={() => onCand(String(item.candidateId))}><span><strong>{String(item.candidateName || "Candidate")}</strong><small>{String(item.requisitionTitle || "")} · {String(item.roundName || "Interview")}</small></span><span>{item.datetime ? new Date(String(item.datetime)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—"} →</span></button>) : <p>No interviews scheduled today.</p>}{interviews.length > 6 && <small>Showing 6 of {interviews.length}.</small>}</div></section>
      <section className="ats-head-card"><h2>Candidate sources</h2><p>All candidate records by source; selected includes later stages.</p><div className="ats-head-source-table"><div className="ats-head-source-row ats-head-table-title"><span>Source</span><span>Candidates</span><span>Selected or later</span></div>{sources.slice(0, 6).map((source) => <div className="ats-head-source-row" key={String(source.source)}><strong>{String(source.source || "Unknown")}</strong><span>{Number(source.candidates || 0)}</span><span>{Number(source.selected || 0)}</span></div>)}{!sources.length && <p>No source data yet.</p>}</div></section>
    </div>
    {showJoining && <section className="ats-head-joiners"><div><h2>Upcoming joiners</h2><p>Expected in the next 7 days.</p></div>{joiners.length ? joiners.slice(0, 4).map((row) => <button type="button" key={String(row.id)} onClick={onJoining}><strong>{formatDate(String(row.currentDoj || ""), "—")}</strong><span>{String(row.name || "Candidate")} · {String(row.requisitionTitle || "")}</span></button>) : <p>No upcoming joiners.</p>}<button type="button" onClick={onJoining}>View joining →</button></section>}
  </div>;
}
