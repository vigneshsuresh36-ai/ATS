"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatDateTime as formatDisplayDateTime } from "@/lib/dateFormat";
import { Chip, prettyStatus, statusColor } from "./ui";

type Item = Record<string, unknown>;

export function TodayView({
  data,
  onReq,
  onCand,
  upcomingJoiners = [],
  onViewAllJoining,
}: {
  data: Record<string, unknown> | null;
  onReq: (id: string) => void;
  onCand: (id: string) => void;
  upcomingJoiners?: Item[];
  onViewAllJoining?: () => void;
}) {
  if (!data) return <div style={muted}>Loading dashboard...</div>;

  const list = (key: string) => (data[key] as Item[] | undefined) || [];
  const tasks = [
    ["interviewsToday", "Interviews Today", "Scheduled for today", "#eef3f8"],
    ["awaitingFb", "Feedback Awaited", "Completed interviews without notes", "#fff7ec"],
    ["nextRoundPending", "Next Round Pending", "Candidates ready to move forward", "#f3f0ff"],
    ["interviewsToSchedule", "Interviews to Schedule", "Approved candidates needing a slot", "#eef7f0"],
    ["pendingApprovals", "Pending Approvals", "Requisitions waiting for approval", "#fff7ec"],
    ["offersPending", "Offers Pending", "Offer requests awaiting decision", "#fff7ec"],
    ["stuck", "Overdue Actions", "Candidates waiting beyond your target time", "#fbeeee"],
    ["reqsNeed", "Roles Needing Candidates", "Approved roles with no pipeline", "#f3f2ed"],
  ] as const;

  const candidateItem = (item: Item, detail: string) => (
    <button key={String(item.id)} type="button" style={rowButton} onClick={() => onCand(String(item.id))}>
      <span style={{ minWidth: 0, textAlign: "left" }}>
        <b style={ellipsis}>{String(item.name || "Candidate")}</b>
        <small style={subtle}>{detail}</small>
      </span>
      <Chip color={statusColor(String(item.stage || ""))}>{prettyStatus(String(item.stage || "Pending"))}</Chip>
    </button>
  );

  const requisitionItem = (item: Item) => (
    <button key={String(item.id)} type="button" style={rowButton} onClick={() => onReq(String(item.id))}>
      <span style={{ minWidth: 0, textAlign: "left" }}>
        <b style={ellipsis}>{String(item.title || item.id)}</b>
        <small style={subtle}>{String(item.department || "")} - {String(item.id || "")}</small>
      </span>
      <span style={ageText}>{item.ageDays != null ? `${String(item.ageDays)}d` : "Open"}</span>
    </button>
  );

  const interviewItem = (item: Item) => {
    const candidate = (item.candidate || {}) as Item;
    const requisition = (item.requisition || {}) as Item;
    return (
      <button key={String(item.id)} type="button" style={rowButton} onClick={() => onCand(String(item.candidateId))}>
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <b style={ellipsis}>{String(candidate.name || "Candidate")}</b>
          <small style={subtle}>{String(requisition.title || item.reqId)} - {String(item.roundName || `Round ${item.roundIndex || 1}`)}</small>
        </span>
        <span style={ageText}>{formatDateTime(String(item.datetime))}</span>
      </button>
    );
  };

  const totalOpen = tasks.reduce((total, [key]) => total + list(key).length, 0);
  const attention = [
    { key: "awaitingFb", label: "Review outstanding interview feedback", target: "dashboard-awaitingFb" },
    { key: "pendingApprovals", label: "Review pending hiring requests", target: "dashboard-pendingApprovals" },
    { key: "offersPending", label: "Review pending offers", target: "dashboard-offersPending" },
    { key: "interviewsToday", label: "Prepare for today's interviews", target: "dashboard-interviewsToday" },
  ].filter((item) => list(item.key).length > 0);

  const priority = list("priority");
  return (
    <div className="ats-today-view">
      {priority.length > 0 && <section className="ats-priority" aria-label="Start here"><div className="ats-priority-head"><h3>Start here</h3><span>Your most urgent candidates, in order</span></div><ol>{priority.map((item) => <li key={String(item.candidateId)}><button type="button" onClick={() => onCand(String(item.candidateId))}><b>{String(item.name)}</b><span>{String(item.reason)}</span><i aria-hidden="true">→</i></button></li>)}</ol></section>}
      <section className="ats-dashboard-attention" aria-label="Actions needing attention"><h3>Needs your attention</h3>{attention.length || upcomingJoiners.length ? <div>{attention.map((item) => <a href={`#${item.target}`} key={item.key}><span>{item.label}</span><strong>{list(item.key).length} →</strong></a>)}{upcomingJoiners.length > 0 && onViewAllJoining && <button type="button" onClick={onViewAllJoining}><span>Review upcoming joiners</span><strong>{upcomingJoiners.length} →</strong></button>}</div> : <p>No actions need your attention right now.</p>}</section>
      <div className="ats-dashboard-hero" style={hero}>
        <div>
          <h2 className="ats-heading-section" style={{ fontFamily: 'var(--font-ui)' }}>Today&apos;s Tasks</h2>
          <p className="ats-heading-subtitle">{totalOpen ? `${totalOpen} open items across your hiring workflow` : "You’re all caught up. New tasks will appear here."}</p>
        </div>
        <div style={attentionBadge}>{totalOpen} open items</div>
      </div>

      <div className="ats-task-grid" style={taskGrid}>
        {tasks.map(([key, title, hint, background]) => (
          <a key={key} className="ats-task-card" href={`#dashboard-${key}`} style={{ ...taskCard, background }}>
            <b style={{ fontSize: 26 }}>{list(key).length}</b>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
            <small style={subtle}>{hint}</small>
          </a>
        ))}
      </div>

      <div className="ats-dashboard-grid" style={sectionGrid}>
        <DashboardList id="dashboard-interviewsToday" title="Interviews Today" items={list("interviewsToday")} empty="No interviews scheduled today." render={interviewItem} />
        <DashboardList id="dashboard-awaitingFb" title="Feedback Awaited" items={list("awaitingFb")} empty="No overdue feedback." render={(item) => candidateItem(item, `Feedback pending ${String(item.feedbackAgeDays || 0)}d`)} />
        <DashboardList id="dashboard-nextRoundPending" title="Next Round Pending" items={list("nextRoundPending")} empty="No next rounds waiting." render={(item) => candidateItem(item, "Ready for the next interview round")} />
        <DashboardList id="dashboard-interviewsToSchedule" title="Interviews to Schedule" items={list("interviewsToSchedule")} empty="No approved candidates waiting for a slot." render={(item) => candidateItem(item, "Needs interview scheduling")} />
        <DashboardList id="dashboard-pendingApprovals" title="Pending Approvals" items={list("pendingApprovals")} empty="No pending requisition approvals." render={requisitionItem} />
        <DashboardList id="dashboard-offersPending" title="Offers Pending" items={list("offersPending")} empty="No offer approvals pending." render={(item) => candidateItem(item, "Offer approval pending")} />
        <DashboardList id="dashboard-stuck" title="SLA Breaches" items={list("stuck")} empty="No SLA breaches." render={(item) => candidateItem(item, `${String(item.days || 0)}d in stage`)} />
        <DashboardList id="dashboard-reqsNeed" title="Requisitions Needing Candidates" items={list("reqsNeed")} empty="All approved roles have candidates." render={requisitionItem} />
      </div>
      {upcomingJoiners.length > 0 && <section className="ats-upcoming-joiners" aria-label="Upcoming joiners">
        <div className="ats-upcoming-joiners-heading"><div><h3>Upcoming Joiners</h3><p>Expected to join within the next 7 days</p></div><button type="button" onClick={onViewAllJoining}>View All</button></div>
        <div className="ats-upcoming-joiners-list">{upcomingJoiners.map((item) => <button type="button" key={String(item.id)} onClick={() => onCand(String(item.id))}>
          <strong>{String(item.name || "Candidate")}</strong><span>{String(item.requisitionTitle || "Position")}</span><time>{displayDateOnly(String(item.currentDoj || ""))}</time><small>{String(item.joiningStatus || "Awaiting Confirmation")}</small>
        </button>)}</div>
      </section>}
    </div>
  );
}

function DashboardList({ id, title, items, empty, render }: { id: string; title: string; items: Item[]; empty: string; render: (item: Item) => ReactNode }) {
  return (
    <section id={id} className="ats-dashboard-panel" style={panel}>
      <div style={panelHeading}><h3 className="ats-heading-panel">{title}</h3><Chip color={items.length ? "#8b5dc7" : undefined}>{items.length}</Chip></div>
      {items.length ? <div style={{ display: "grid", gap: 6 }}>{items.slice(0, 6).map(render)}</div> : <div style={emptyState}>{empty}</div>}
    </section>
  );
}

function formatDateTime(value: string) {
  return formatDisplayDateTime(value);
}

function displayDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString() : value;
}

const hero: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 };
const attentionBadge: CSSProperties = { background: "#8b5dc7", color: "#fff", borderRadius: 10, padding: "10px 14px", fontWeight: 700, fontSize: 13 };
const taskGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 };
const taskCard: CSSProperties = { display: "flex", flexDirection: "column", gap: 5, minHeight: 108, padding: "14px 15px", border: "1px solid #ebe6da", borderRadius: 12, color: "#2c2c28", textDecoration: "none", boxShadow: "0 1px 0 rgba(40,35,20,.03)" };
const sectionGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 };
const panel: CSSProperties = { background: "#fff", border: "1px solid #ebe6da", borderRadius: 14, padding: 14, boxShadow: "0 1px 0 rgba(40,35,20,.03)" };
const panelHeading: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 };
const rowButton: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", border: "1px solid #f0ece3", background: "#faf9f6", borderRadius: 9, padding: "9px 10px", cursor: "pointer", color: "#2c2c28" };
const ellipsis: CSSProperties = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const subtle: CSSProperties = { display: "block", color: "#7a7a72", fontSize: 12, marginTop: 3 };
const ageText: CSSProperties = { color: "#8a5a00", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" };
const emptyState: CSSProperties = { color: "#aaa", background: "#faf9f5", border: "1px dashed #e5e0d4", borderRadius: 9, padding: "16px 10px", textAlign: "center", fontSize: 12 };
const muted: CSSProperties = { color: "#888", padding: "24px 0" };
