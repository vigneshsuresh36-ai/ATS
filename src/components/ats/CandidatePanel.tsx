"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { canRecruit } from "@/lib/roles";
import { formatSalaryRange } from "@/lib/salaryFormat";
import {
  Chip,
  statusColor,
  prettyStatus,
  inp,
  lab,
  saveBtn,
  cancelBtn,
  DetailItem,
} from "./ui";
import type { Candidate, Interview, InterviewPlan, Requisition, Role } from "@/lib/types";

export function CandidatePanel({
  data,
  role,
  isHmOwner,
  onClose,
  apiFetch,
  onRefresh,
  onScheduleRound,
}: {
  data: {
    candidate: Candidate;
    requisition?: Requisition | null;
    feedback: {
      rating: number;
      recommendation: string;
      interviewer: string;
      feedback: string;
      interviewId?: string;
    }[];
    interviews: Interview[];
  };
  role: Role;
  isHmOwner?: boolean;
  onClose: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onScheduleRound?: (roundIndex: number) => void;
}) {
  const c = data.candidate;
  const requisition = data.requisition;
  const [stage, setStage] = useState(c.stage);
  const [fb, setFb] = useState("");
  const [feedbackFor, setFeedbackFor] = useState("");
  const [rating, setRating] = useState(3);
  const [rec, setRec] = useState("Yes");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [tentativeDoj, setTentativeDoj] = useState(c.tentativeDoj || "");
  const [offeredFixedCtc, setOfferedFixedCtc] = useState(c.offeredFixedCtc || c.offeredSalary || "");
  const [offeredVariableCtc, setOfferedVariableCtc] = useState(c.offeredVariableCtc || "");
  const [offeredVariablePeriod, setOfferedVariablePeriod] = useState<"Monthly" | "Annually">(c.offeredVariablePeriod || "Annually");
  const [offeredEsops, setOfferedEsops] = useState(c.offeredEsops || "0");
  const [joiningBonus, setJoiningBonus] = useState(c.joiningBonus || "0");
  const [relocationAssistance, setRelocationAssistance] = useState(c.relocationAssistance ?? false);
  const [rescheduleTimes, setRescheduleTimes] = useState<Record<string, string>>({});
  const [selectedRescheduleInterviewId, setSelectedRescheduleInterviewId] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/requisitions/${c.reqId}/plan`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPlan(d.plan || null);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, c.reqId]);

  const canHmDecide =
    (role === "Admin" || isHmOwner) && c.stage === "PendingHMApproval";

  const activeInterviews = (data.interviews || []).filter(
    (iv) => iv.status !== "Cancelled" && iv.status !== "Reschedule Requested"
  );
  const rescheduleEligibleInterviews = (data.interviews || []).filter(
    (iv) => iv.status === "Scheduled" || iv.status === "Rescheduled"
  );
  const rescheduleTargetId = rescheduleEligibleInterviews.some(
    (iv) => iv.id === selectedRescheduleInterviewId
  )
    ? selectedRescheduleInterviewId
    : rescheduleEligibleInterviews[0]?.id || "";
  const feedbackList = data.feedback || [];
  const maxScheduledRound = activeInterviews.reduce(
    (m, iv) => Math.max(m, iv.roundIndex || 1),
    0
  );
  const nextRoundIndex = maxScheduledRound + 1;
  const interviewRounds = getInterviewRounds(plan);
  const configuredRounds = interviewRounds.length;
  const nextRoundMeta =
    interviewRounds.find((r) => r.order === nextRoundIndex) ||
    interviewRounds[nextRoundIndex - 1];
  const lastAdvanced = c.lastAdvancedRound ?? 0;
  // Next round only after debrief Advance for the latest scheduled round
  // (lastAdvancedRound is the source of truth — not interview status, which may
  // still say Scheduled for older records).
  const canScheduleNext =
    canRecruit(role) &&
    !!onScheduleRound &&
    (configuredRounds === 0 || nextRoundIndex <= configuredRounds) &&
    ((nextRoundIndex === 1 && c.stage === "HMApproved") ||
      (nextRoundIndex > 1 &&
        c.stage === "Selected" &&
        lastAdvanced === maxScheduledRound &&
        nextRoundIndex === lastAdvanced + 1));

  const interviewRoundsComplete =
    configuredRounds > 0
      ? lastAdvanced >= configuredRounds
      : maxScheduledRound > 0 && lastAdvanced >= maxScheduledRound;

  // Stage is driven by HM approve → schedule → feedback → debrief.
  // Manual edits only after the interview loop is finished (offer / hire / close).
  const inInterviewProcess =
    c.stage === "PendingHMApproval" ||
    c.stage === "HMApproved" ||
    c.stage === "Screened" ||
    c.stage === "Shortlist" ||
    c.stage === "Interview" ||
    c.stage === "Interview Scheduled" ||
    c.stage === "Debrief" ||
    (c.stage === "Selected" && !interviewRoundsComplete);

  const showStageEditor =
    canRecruit(role) &&
    !inInterviewProcess &&
    (c.stage === "Selected" ||
      c.stage === "Offered" ||
      c.stage === "Onboarded" ||
      c.stage === "Rejected" ||
      c.stage === "On Hold");
  const canRequestOffer =
    canRecruit(role) &&
    c.stage === "Selected" &&
    interviewRoundsComplete &&
    c.offerApprovalStatus !== "Pending" &&
    c.offerApprovalStatus !== "Approved";
  const canDecideOffer =
    (role === "Admin" || role === "DepartmentHead") &&
    c.offerApprovalStatus === "Pending";
  const canMarkBackOut =
    canRecruit(role) &&
    !["Candidate Backed Out", "Rejected", "Onboarded"].includes(c.stage) &&
    c.offerApprovalStatus !== "Pending" &&
    c.offerApprovalStatus !== "Approved";

  // One feedback entry per scheduled interview — hide form once caught up.
  const pendingInterview =
    activeInterviews.find(
      (iv) => !feedbackList.some((f) => f.interviewId === iv.id)
    ) || activeInterviews[activeInterviews.length - 1];
  const showFeedbackForm = !!pendingInterview && !feedbackList.some((f) => f.interviewId === pendingInterview.id);
  const showDebrief =
    (canRecruit(role) || !!isHmOwner) &&
    (c.stage === "Debrief" ||
      (maxScheduledRound > lastAdvanced &&
        activeInterviews.length > 0 &&
        feedbackList.length >= activeInterviews.length &&
        (c.stage === "Selected" || c.stage === "Interview Scheduled")));
  async function hmDecide(action: "hmApprove" | "hmReject") {
    let reason: string | undefined;
    if (action === "hmReject") {
      reason =
        window.prompt("Rejection reason (optional):") ||
        "Rejected by hiring manager";
    }
    setBusy(true);
    try {
      const r = await apiFetch(`/api/candidates/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error);
      else onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function markCandidateBackedOut() {
    if (!window.confirm(`Mark ${c.name} as backed out and cancel all upcoming interviews?`)) return;
    const reason = window.prompt("Reason (optional):")?.trim() || "";
    setBusy(true);
    try {
      const response = await apiFetch(`/api/candidates/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "candidateBackOut", reason }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error || "Could not update candidate.");
      else {
        if (result.calendarCancellationFailures?.length) {
          alert("Candidate status was updated, but one or more Calendar events could not be cancelled.");
        }
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateInterviewSchedule(
    interviewId: string,
    status: "Reschedule Requested" | "Rescheduled",
    requester?: "Candidate" | "Interviewer",
    datetime?: string
  ) {
    if (status === "Rescheduled" && !datetime) {
      alert("Choose a new interview date and time.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: interviewId,
          status,
          rescheduleRequestedBy: status === "Reschedule Requested" ? requester : undefined,
          datetime: datetime ? new Date(datetime).toISOString() : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error || "Could not update interview.");
      else onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function approveOfferWithTerms() {
    if (!tentativeDoj || ![offeredFixedCtc, offeredVariableCtc, offeredEsops, joiningBonus].every((value) => /^\d+$/.test(value))) {
      alert("Enter the tentative DOJ and numeric values for all proposed offer terms.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(`/api/candidates/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "offerApprove",
          tentativeDoj,
          offeredFixedCtc,
          offeredVariableCtc,
          offeredVariablePeriod,
          offeredEsops,
          joiningBonus,
          relocationAssistance,
        }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error);
      else onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <a onClick={onClose} style={{ cursor: "pointer", color: "#3a6ea5" }}>
        ← Close
      </a>
      <h3 style={{ marginTop: 8 }}>{c.name}</h3>
      <Chip color={statusColor(c.stage)}>{prettyStatus(c.stage)}</Chip>
      {requisition && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
            margin: "12px 0",
            padding: 12,
            background: "#f7f5ef",
            borderRadius: 12,
            border: "1px solid #ebe6da",
          }}
        >
          <DetailItem label="Position" value={requisition.title} />
          <DetailItem label="Department" value={requisition.department} />
          <DetailItem label="Location" value={requisition.location || "—"} />
          <DetailItem label="Experience" value={requisition.level || "—"} />
          <DetailItem label="Salary range" value={formatSalaryRange(requisition.salaryMin, requisition.salaryMax)} />
          <DetailItem label="Openings" value={String(requisition.openings)} />
          <DetailItem label="Hiring manager" value={requisition.raisedByName} />
          <DetailItem label="Requisition ID" value={requisition.id} />
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
          margin: "12px 0",
          padding: 12,
          background: "#f7f5ef",
          borderRadius: 12,
          border: "1px solid #ebe6da",
        }}
      >
        <DetailItem label="Email" value={c.email || "—"} />
        <DetailItem label="Phone" value={c.phone || "—"} />
        <DetailItem label="Location" value={c.location || "—"} />
        <DetailItem label="Present Fixed CTC" value={c.currentFixedCtc || c.currentCtc || "—"} />
        <DetailItem label="Present Variable CTC" value={c.currentVariableCtc || "—"} />
        <DetailItem label="Present ESOPs" value={c.presentEsops || "—"} />
        <DetailItem label="Expected CTC" value={c.expectedCtc || "—"} />
        <DetailItem label="Notice" value={c.notice || "—"} />
        <DetailItem
          label="Source"
          value={
            c.source
              ? c.sourceDetail
                ? `${c.source} · ${c.sourceDetail}`
                : c.source
              : "—"
          }
        />
        <DetailItem label="Req" value={c.reqId} />
        {c.cvFileName && (
          <div style={{ minWidth: 0, maxWidth: "100%" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: "#8a8a82",
              }}
            >
              CV
            </div>
            {c.cvPath ? (
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch(`/api/candidates/${c.id}/cv`);
                  if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    alert(d.error || "Could not download CV.");
                    return;
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = c.cvFileName || "cv.pdf";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                }}
                style={{
                  display: "block",
                  maxWidth: "100%",
                  marginTop: 2,
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  color: "#3a6ea5",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                  textDecoration: "underline",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                {c.cvFileName}
              </button>
            ) : (
              <div style={{ minWidth: 0, maxWidth: "100%", fontSize: 13.5, fontWeight: 600, marginTop: 2, overflowWrap: "anywhere", wordBreak: "break-word" }}>
                {c.cvFileName}
              </div>
            )}
          </div>
        )}
        {c.hmDecisionBy && (
          <DetailItem label="HM decision by" value={c.hmDecisionBy} />
        )}
      </div>
      {c.hmRejectReason && (
        <div style={{ fontSize: 13, color: "#9a3b3b", marginBottom: 10 }}>
          Rejected: {c.hmRejectReason}
        </div>
      )}
      {(canMarkBackOut || (canRecruit(role) && rescheduleEligibleInterviews.length > 0)) && (
        <div style={{ margin: "10px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {canMarkBackOut && (
            <button
              type="button"
              disabled={busy}
              onClick={markCandidateBackedOut}
              style={{ ...candidateWorkflowButton, background: "#a83f3f" }}
            >
              Candidate Backed Out
            </button>
          )}
          {canRecruit(role) && rescheduleEligibleInterviews.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {rescheduleEligibleInterviews.length > 1 && (
                <select
                  aria-label="Interview to reschedule"
                  style={{ ...inp, width: 220, height: 42, margin: 0 }}
                  value={rescheduleTargetId}
                  onChange={(event) => setSelectedRescheduleInterviewId(event.target.value)}
                >
                  {rescheduleEligibleInterviews.map((interview) => (
                    <option key={interview.id} value={interview.id}>
                      {interview.roundName || `Round ${interview.roundIndex || 1}`} · {formatDateTime(interview.datetime)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={busy || !rescheduleTargetId}
                onClick={() => updateInterviewSchedule(rescheduleTargetId, "Reschedule Requested", "Candidate")}
                style={{ ...candidateWorkflowButton, background: "#376daa" }}
              >
                Candidate Requested Reschedule
              </button>
              <button
                type="button"
                disabled={busy || !rescheduleTargetId}
                onClick={() => updateInterviewSchedule(rescheduleTargetId, "Reschedule Requested", "Interviewer")}
                style={{ ...candidateWorkflowButton, background: "#6b5b95" }}
              >
                Interviewer Requested Reschedule
              </button>
            </div>
          )}
        </div>
      )}
      {c.remarks && (
        <div style={{ fontSize: 13, marginBottom: 12, whiteSpace: "pre-wrap" }}>
          <b>Remarks:</b> {c.remarks}
        </div>
      )}

      {canHmDecide && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="ats-btn-approve"
            disabled={busy}
            onClick={() => hmDecide("hmApprove")}
          >
            Approve candidate
          </button>
          <button
            type="button"
            className="ats-btn-reject"
            disabled={busy}
            onClick={() => hmDecide("hmReject")}
          >
            Reject candidate
          </button>
        </div>
      )}

      {canScheduleNext && (
        <button
          type="button"
          style={{ ...saveBtn, marginBottom: 14 }}
          onClick={() => onScheduleRound?.(nextRoundIndex)}
        >
          Schedule Round {nextRoundIndex}
          {nextRoundMeta?.name ? `: ${nextRoundMeta.name}` : ""}
        </button>
      )}

      {c.stage === "PendingHMApproval" && (role === "Admin" || canRecruit(role)) && (
        <div
          style={{
            background: "#fff7ec",
            border: "1px solid #f0d9b0",
            borderRadius: 8,
            padding: 10,
            fontSize: 13,
            color: "#8a5a00",
            marginBottom: 12,
          }}
        >
          Waiting for hiring-manager approval before interviews can be
          scheduled.
        </div>
      )}

      {showStageEditor ? (
        <div style={{ marginTop: 14 }}>
          <label style={lab}>Update stage</label>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 8px" }}>
            Interview rounds are complete — set offer / hire outcome.
          </p>
          <select
            style={inp}
            value={stage}
            onChange={(e) => setStage(e.target.value as Candidate["stage"])}
          >
            {["Selected", "Offered", "Onboarded", "Rejected", "On Hold"].map(
              (s) => (
                <option key={s} value={s}>
                  {prettyStatus(s)}
                </option>
              )
            )}
          </select>
          <button
            style={{ ...saveBtn, marginTop: 8 }}
            onClick={async () => {
              const r = await apiFetch(`/api/candidates/${c.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "stage", stage }),
              });
              const d = await r.json();
              if (!r.ok) alert(d.error);
              else onRefresh();
            }}
          >
            Save stage
          </button>
        </div>
      ) : (
        canRecruit(role) &&
        c.stage !== "PendingHMApproval" && (
          <p style={{ fontSize: 12, color: "#888", marginTop: 12 }}>
            Stage is managed by the interview workflow (schedule → feedback →
            debrief). Manual updates unlock after all rounds are complete.
          </p>
        )
      )}

      {c.offerApprovalStatus && (
        <section className="ats-offer-review">
          <div className="ats-offer-review-head">
            <div>
              <h4>Offer approval review</h4>
              <p>Proposed terms submitted by the recruiter</p>
            </div>
            <span className="ats-offer-status">{c.offerApprovalStatus}</span>
          </div>
          <div className="ats-offer-terms">
            <DetailItem label="Proposed fixed CTC" value={c.offeredFixedCtc || c.offeredSalary || "—"} />
            <DetailItem label="Proposed variable CTC" value={`${c.offeredVariableCtc || "—"} (${c.offeredVariablePeriod || "—"})`} />
            <DetailItem label="Proposed ESOPs" value={c.offeredEsops || "—"} />
            <DetailItem label="Joining bonus" value={c.joiningBonus || "—"} />
            <DetailItem label="Relocation assistance" value={c.relocationAssistance === undefined ? "—" : c.relocationAssistance ? "Yes" : "No"} />
            <DetailItem label="Tentative DOJ" value={formatDate(c.tentativeDoj, "—")} />
          </div>
          {c.offerApprovalStatus === "Rejected" && c.offerRejectReason && (
            <div className="ats-offer-reject-reason">Rejection reason: {c.offerRejectReason}</div>
          )}
          {c.offerApprovalStatus === "Approved" && (
            <div className="ats-offer-approved-note">Approved and ready for processing in the HRMS.</div>
          )}
          {canDecideOffer && (
            <div className="ats-offer-override">
              <h4>Adjust terms before approval</h4>
              <p>Change any proposed value below to approve with revised terms.</p>
              <div className="ats-offer-override-grid">
                <div>
                  <label style={lab} htmlFor="offer-approval-doj">Tentative DOJ *</label>
                  <input id="offer-approval-doj" style={inp} type="date" required value={tentativeDoj} onChange={(event) => setTentativeDoj(event.target.value)} />
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-fixed">Fixed CTC *</label>
                  <input id="offer-approval-fixed" style={inp} required inputMode="numeric" value={offeredFixedCtc} onChange={(event) => setOfferedFixedCtc(event.target.value.replace(/\D/g, ""))} />
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-variable">Variable CTC *</label>
                  <input id="offer-approval-variable" style={inp} required inputMode="numeric" value={offeredVariableCtc} onChange={(event) => setOfferedVariableCtc(event.target.value.replace(/\D/g, ""))} />
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-period">Variable CTC period *</label>
                  <select id="offer-approval-period" style={inp} value={offeredVariablePeriod} onChange={(event) => setOfferedVariablePeriod(event.target.value as "Monthly" | "Annually")}>
                    <option value="Monthly">Monthly</option>
                    <option value="Annually">Annually</option>
                  </select>
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-esops">Proposed ESOPs *</label>
                  <input id="offer-approval-esops" style={inp} required inputMode="numeric" value={offeredEsops} onChange={(event) => setOfferedEsops(event.target.value.replace(/\D/g, ""))} />
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-bonus">Joining bonus *</label>
                  <input id="offer-approval-bonus" style={inp} required inputMode="numeric" value={joiningBonus} onChange={(event) => setJoiningBonus(event.target.value.replace(/\D/g, ""))} />
                </div>
                <div>
                  <label style={lab} htmlFor="offer-approval-relocation">Relocation assistance *</label>
                  <select id="offer-approval-relocation" style={inp} value={relocationAssistance ? "Yes" : "No"} onChange={(event) => setRelocationAssistance(event.target.value === "Yes")}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </div>
              </div>
              <button type="button" className="ats-btn-approve" disabled={busy || !tentativeDoj || ![offeredFixedCtc, offeredVariableCtc, offeredEsops, joiningBonus].every((value) => /^\d+$/.test(value))} onClick={approveOfferWithTerms}>
                {busy ? "Saving…" : "Approve with these terms"}
              </button>
            </div>
          )}
        </section>
      )}
      {c.stage === "Selected" && !interviewRoundsComplete && (
        <div style={{ marginTop: 14, padding: 10, background: "#fff7ec", border: "1px solid #f0d9b0", borderRadius: 8, fontSize: 13, color: "#8a5a00" }}>
          Complete all configured interview rounds and choose <b>Advance</b> in the final debrief. The offer approval request will then appear here.
        </div>
      )}
      {canRequestOffer && (
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ebe6da", borderRadius: 10 }}>
          <h4 style={{ margin: "0 0 8px" }}>Request offer approval</h4>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#666" }}>
            Submit the complete proposed package to the candidate&apos;s Department Head. Enter 0 when ESOPs or bonus do not apply.
          </p>
          <label style={lab}>Tentative DOJ *</label>
          <input style={inp} type="date" value={tentativeDoj} onChange={(e) => setTentativeDoj(e.target.value)} />
          <label style={lab}>Fixed CTC to be offered *</label>
          <input style={inp} inputMode="numeric" value={offeredFixedCtc} onChange={(e) => setOfferedFixedCtc(e.target.value.replace(/\D/g, ""))} placeholder="Numbers only" />
          <label style={lab}>Variable CTC to be offered *</label>
          <input style={inp} inputMode="numeric" value={offeredVariableCtc} onChange={(e) => setOfferedVariableCtc(e.target.value.replace(/\D/g, ""))} placeholder="Numbers only" />
          <label style={lab}>Variable CTC period *</label>
          <select style={inp} value={offeredVariablePeriod} onChange={(e) => setOfferedVariablePeriod(e.target.value as "Monthly" | "Annually")}>
            <option value="Monthly">Monthly</option>
            <option value="Annually">Annually</option>
          </select>
          <label style={lab}>Proposed ESOPs *</label>
          <input style={inp} inputMode="numeric" value={offeredEsops} onChange={(e) => setOfferedEsops(e.target.value.replace(/\D/g, ""))} placeholder="Numbers only; use 0 if none" />
          <label style={lab}>Joining bonus *</label>
          <input style={inp} inputMode="numeric" value={joiningBonus} onChange={(e) => setJoiningBonus(e.target.value.replace(/\D/g, ""))} placeholder="Numbers only; use 0 if none" />
          <label style={lab}>Relocation assistance *</label>
          <select style={inp} value={relocationAssistance ? "Yes" : "No"} onChange={(e) => setRelocationAssistance(e.target.value === "Yes")}>
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select>
          <button
            type="button"
            style={{ ...saveBtn, marginTop: 10 }}
            disabled={busy || !tentativeDoj || ![offeredFixedCtc, offeredVariableCtc, offeredEsops, joiningBonus].every((value) => /^\d+$/.test(value))}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await apiFetch(`/api/candidates/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "offerRequest", tentativeDoj, offeredFixedCtc, offeredVariableCtc, offeredVariablePeriod, offeredEsops, joiningBonus, relocationAssistance }) });
                const result = await response.json();
                if (!response.ok) alert(result.error);
                else onRefresh();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Submitting…" : "Submit for Department Head approval"}
          </button>
        </div>
      )}

      <h4>Feedback</h4>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Interviewer notes after a round — rating and hire recommendation.
      </p>
      {feedbackList.map((f, i) => {
        const feedbackInterview = f.interviewId
          ? data.interviews.find((interview) => interview.id === f.interviewId)
          : undefined;
        return (
        <div
          key={i}
          style={{
            border: "1px solid #ebe6da",
            borderRadius: 10,
            padding: 10,
            marginBottom: 8,
            fontSize: 13,
          }}
        >
          <b>{feedbackInterview ? `Round ${feedbackInterview.roundIndex || 1}` : "Interview"}</b> · {f.interviewer} — {f.recommendation} ·{" "}
          <span aria-label={`${f.rating} of 5`}>
            {"★".repeat(Math.max(0, Math.min(5, f.rating || 0)))}
            {"☆".repeat(Math.max(0, 5 - Math.min(5, f.rating || 0)))}
          </span>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{f.feedback}</div>
        </div>
        );
      })}
      {!showFeedbackForm && feedbackList.length > 0 && (
        <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
          {canScheduleNext
            ? "Ready to schedule the next round."
            : showDebrief
              ? "Feedback is in — make a debrief decision before scheduling the next round."
              : "Feedback recorded. Finish the current round (feedback → debrief Advance) before scheduling the next."}
        </p>
      )}
      {showFeedbackForm && (
        <>
          {canRecruit(role) && pendingInterview?.interviewerEmails?.length ? (
            <>
              <label style={lab}>Submit feedback on behalf of</label>
              <select
                style={inp}
                value={feedbackFor}
                onChange={(e) => setFeedbackFor(e.target.value)}
              >
                <option value="">Select interviewer</option>
                {pendingInterview.interviewerEmails.map((email) => (
                  <option key={email} value={email}>{email}</option>
                ))}
              </select>
            </>
          ) : null}
          <label style={lab}>Interview notes</label>
          <textarea
            style={{ ...inp, minHeight: 70 }}
            placeholder="What went well, gaps, follow-ups…"
            value={fb}
            onChange={(e) => setFb(e.target.value)}
          />
          <label style={lab}>Rating</label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 2,
            }}
            role="radiogroup"
            aria-label="Rating out of 5"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                aria-checked={rating === n}
                role="radio"
                style={{
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 28,
                  lineHeight: 1,
                  padding: "2px 4px",
                  color: n <= rating ? "#d4a017" : "#d0cdc4",
                }}
              >
                ★
              </button>
            ))}
            <span style={{ fontSize: 13, color: "#666", marginLeft: 6 }}>
              {rating}/5
            </span>
          </div>
          <label style={lab}>Recommendation</label>
          <select
            style={inp}
            value={rec}
            onChange={(e) => setRec(e.target.value)}
          >
            {[
              "Strong Yes",
              "Yes",
              "Lean Yes",
              "Lean No",
              "No",
              "Strong No",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button
            style={{ ...saveBtn, marginTop: 10 }}
            onClick={async () => {
              const r = await apiFetch(`/api/candidates/${c.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "feedback",
                  feedback: fb,
                  rating,
                  recommendation: rec,
                  interviewId: pendingInterview?.id,
                  interviewer: feedbackFor || pendingInterview?.interviewerEmails?.[0],
                }),
              });
              const d = await r.json();
              if (!r.ok) alert(d.error);
              else {
                setFb("");
                setFeedbackFor("");
                onRefresh();
              }
            }}
          >
            Save feedback
          </button>
        </>
      )}
      {showDebrief && (
          <div style={{ marginTop: 16 }}>
            <h4>Debrief decision</h4>
            <div style={{ display: "flex", gap: 8 }}>
              {["Advance", "Hold", "Reject"].map((dec) => (
                <button
                  key={dec}
                  style={
                    dec === "Reject"
                      ? { ...cancelBtn, background: "#f3d4d4" }
                      : saveBtn
                  }
                  onClick={async () => {
                    const r = await apiFetch(`/api/candidates/${c.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "debrief",
                        decision: dec,
                      }),
                    });
                    const d = await r.json();
                    if (!r.ok) alert(d.error);
                    else onRefresh();
                  }}
                >
                  {dec}
                </button>
              ))}
            </div>
          </div>
        )}
      <h4>Interviews</h4>
      {(data.interviews || []).length === 0 && (
        <div style={{ color: "#aaa", fontSize: 13 }}>None scheduled</div>
      )}
      {(data.interviews || []).map((iv) => (
        <div key={iv.id} style={{ fontSize: 13, marginBottom: 10 }}>
          <div>
            {formatDateTime(iv.datetime)}
            {iv.roundName
              ? ` · Round ${iv.roundIndex}: ${iv.roundName}`
              : ` · ${iv.stage}`} {" "}
            · {iv.status}{iv.rescheduleRequestedBy ? ` · ${iv.rescheduleRequestedBy} requested` : ""}
            {iv.meetLink && (
              <>
                {" "}
                ·{" "}
                <a href={iv.meetLink} target="_blank" rel="noreferrer">
                  Meet
                </a>
              </>
            )}
          </div>
          {canRecruit(role) && iv.status === "Reschedule Requested" && (
            <div style={{ display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <div>
                <label style={lab} htmlFor={`reschedule-${iv.id}`}>New interview date and time</label>
                <input
                  id={`reschedule-${iv.id}`}
                  style={inp}
                  type="datetime-local"
                  value={rescheduleTimes[iv.id] ?? toDateTimeInput(iv.datetime)}
                  onChange={(event) => setRescheduleTimes((current) => ({ ...current, [iv.id]: event.target.value }))}
                />
              </div>
              <button
                type="button"
                style={saveBtn}
                disabled={busy || !(rescheduleTimes[iv.id] ?? toDateTimeInput(iv.datetime))}
                onClick={() => updateInterviewSchedule(
                  iv.id,
                  "Rescheduled",
                  undefined,
                  rescheduleTimes[iv.id] ?? toDateTimeInput(iv.datetime)
                )}
              >
                Save new time
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function toDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const candidateWorkflowButton: CSSProperties = {
  ...saveBtn,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  width: 260,
  minWidth: 260,
  height: 42,
  padding: "9px 16px",
  fontFamily: "inherit",
  fontSize: 14,
  lineHeight: "20px",
  whiteSpace: "nowrap",
};
