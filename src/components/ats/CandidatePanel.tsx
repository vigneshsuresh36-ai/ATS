"use client";

import { ActivityHistory } from "./ActivityHistory";
import { normalizeQuestion, validFeedbackAnswer } from "@/lib/feedbackForms";
import { HiringAssistant } from "./HiringAssistant";
import { CandidateCommunicationHistory } from "./CandidateCommunicationHistory";
import { CandidateComments } from "./CandidateComments";
import { CallCandidate } from "./CallCandidate";

import { useEffect, useState, type CSSProperties } from "react";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { canRecruit } from "@/lib/roles";
import { candidateSourceLabel } from "@/lib/candidateSource";
import { signalHoneyBadgerMood } from "@/lib/honeyBadgerMood";
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
import { canReopenApplication } from "@/lib/candidateReopening";
import { isRequisitionOpenForRecruiting } from "@/lib/requisitionStatus";
import type { Candidate, Interview, InterviewFeedback, InterviewPlan, Requisition, Role } from "@/lib/types";

export function CandidatePanel({
  data,
  role,
  org,
  isHmOwner,
  onClose,
  apiFetch,
  onRefresh,
  onOpenApplication,
  onScheduleRound,
}: {
  data: {
    candidate: Candidate;
    requisition?: Requisition | null;
    feedback: InterviewFeedback[];
    interviews: Interview[];
    events?: { toStage: string; at: string; note?: string }[];
    interviewHistory?: {
      reqId: string;
      reqTitle: string;
      roundName: string;
      datetime: string;
      status: string;
      interviewers: string[];
      feedback: {
        interviewer: string;
        rating: number;
        recommendation: string;
        feedback: string;
        createdAt: string;
      }[];
    }[];
  };
  role: Role;
  org?: import("@/lib/types").OrgSettings | null;
  isHmOwner?: boolean;
  onClose: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onOpenApplication: (applicationRecordId: string) => Promise<void>;
  onScheduleRound?: (roundIndex: number) => void;
}) {
  const c = data.candidate;
  const requisition = data.requisition;
  const [cvPreview, setCvPreview] = useState<string | null>(null);
  const [cvError, setCvError] = useState("");
  useEffect(() => {
    let active = true; let url: string | undefined;
    setCvPreview(null); setCvError("");
    if (c.cvPath && /\.pdf$/i.test(c.cvFileName || "")) apiFetch(`/api/candidates/${c.id}/cv`).then(async response => {
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `CV preview request failed (${response.status}).`);
      }
      const blob = await response.blob();
      if (active) { url = URL.createObjectURL(blob); setCvPreview(url); }
    }).catch((error) => { if (active) setCvError(error instanceof Error ? error.message : "Could not load the CV preview."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [apiFetch, c.id, c.cvPath, c.cvFileName]);
  const timeline = [
    ...(data.events || []).map((event) => ({ at: event.at, title: `Status changed to ${prettyStatus(event.toStage)}`, detail: event.note || "" })),
    ...(data.interviews || []).map((interview) => ({ at: interview.datetime, title: `${interview.roundName || `Round ${interview.roundIndex || 1}`} interview`, detail: interview.status })),
    ...(data.feedback || []).map((entry) => ({ at: entry.createdAt, title: "Interview feedback submitted", detail: entry.interviewer || "" })),
    ...(c.offerRequestedAt ? [{ at: c.offerRequestedAt, title: "Offer submitted for approval", detail: "" }] : []),
    ...(c.offerDecisionAt ? [{ at: c.offerDecisionAt, title: `Offer ${c.offerApprovalStatus || "decision recorded"}`, detail: "" }] : []),
    ...(c.joiningStatusUpdatedAt ? [{ at: c.joiningStatusUpdatedAt, title: `Joining status: ${c.joiningStatus || "updated"}`, detail: "" }] : []),
  ].filter((item) => item.at).sort((a, b) => b.at.localeCompare(a.at));
  const [stage, setStage] = useState(c.stage);
  const [fb, setFb] = useState("");
  const [customAnswers, setCustomAnswers] = useState<Record<number, string>>({});
  const [feedbackFor, setFeedbackFor] = useState("");
  const [rating, setRating] = useState(3);
  const [rec, setRec] = useState("Yes");
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const canReopen = canRecruit(role) && !c.archived && canReopenApplication(c.stage) &&
    !!requisition && isRequisitionOpenForRecruiting(requisition.status);

  async function reopenApplication() {
    setReopening(true);
    setReopenError("");
    try {
      const response = await apiFetch("/api/candidates/" + encodeURIComponent(c.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen" }),
      });
      const result = await response.json();
      if (!response.ok || !result.candidate?.id) throw new Error(result.error || "Could not reopen the application.");
      await onOpenApplication(result.candidate.id);
    } catch (error) {
      setReopenError(error instanceof Error ? error.message : "Could not reopen the application.");
    } finally {
      setReopening(false);
    }
  }
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
  const canReviewSocialCv = canRecruit(role) && c.stage === "Social CV";

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
  const interviewRounds = getInterviewRounds(plan);
  const bookedRounds = new Set((data.interviews || []).filter((interview) => interview.status !== "Cancelled").map((interview) => interview.roundIndex || 1));
  const nextRoundMeta = interviewRounds.find((round) => !bookedRounds.has(round.order));
  const nextRoundIndex = nextRoundMeta?.order ?? 0;
  const finalRound = interviewRounds.at(-1)?.order ?? 0;
  const lastAdvanced = c.lastAdvancedRound ?? 0;
  // Next round only after debrief Advance for the latest scheduled round
  // (lastAdvancedRound is the source of truth — not interview status, which may
  // still say Scheduled for older records).
  const canScheduleNext =
    canRecruit(role) &&
    !!onScheduleRound &&
    nextRoundIndex > 0 &&
    ((maxScheduledRound === 0 && c.stage === "HMApproved") ||
      (maxScheduledRound > 0 && c.stage === "Selected" && lastAdvanced === maxScheduledRound));

  const interviewRoundsComplete =
    Math.max(finalRound, maxScheduledRound) > 0 &&
    lastAdvanced >= Math.max(finalRound, maxScheduledRound) &&
    interviewRounds.every((round) => activeInterviews.some((interview) => (interview.roundIndex || 1) === round.order));

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

  const hasApprovedOffer = c.offerApprovalStatus === "Approved";
  const showStageEditor = canRecruit(role) && !inInterviewProcess && (
    (hasApprovedOffer && (c.stage === "OfferApproved" || c.stage === "Offered")) ||
    (!hasApprovedOffer && c.offerApprovalStatus !== "Pending" && (c.stage === "Selected" || c.stage === "On Hold"))
  );
  const stageOptions: Candidate["stage"][] = hasApprovedOffer
    ? c.stage === "OfferApproved" ? ["OfferApproved", "Offered", "Onboarded"] : ["Offered", "Onboarded"]
    : ["Selected", "On Hold"];
  const canRequestOffer =
    canRecruit(role) &&
    c.stage === "Selected" &&
    interviewRoundsComplete &&
    c.offerApprovalStatus !== "Pending" &&
    c.offerApprovalStatus !== "Approved";
  const canDecideOffer =
    (role === "Admin" || role === "DepartmentHead") &&
    c.offerApprovalStatus === "Pending";
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
      else {
        if (action === "hmReject") signalHoneyBadgerMood("sad");
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function reviewSocialCv(stage: "Social CV Reject" | "PendingHMApproval") {
    setBusy(true);
    try {
      const response = await apiFetch(`/api/candidates/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stage", stage }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error || "Could not update social application.");
      else {
        if (stage === "Social CV Reject") signalHoneyBadgerMood("sad");
        onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function openResume() {
    const tab = window.open("", "_blank");
    try {
      const response = await apiFetch(`/api/candidates/${c.id}/cv`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Could not open resume.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (tab) tab.location.href = url;
      else { URL.revokeObjectURL(url); alert("Allow pop-ups to view the resume."); return; }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      tab?.close();
      alert(error instanceof Error ? error.message : "Could not open resume.");
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
    const reason = window.prompt(`Reason for changing this interview to ${status}:`)?.trim();
    if (!reason) return;
    if (reason.length > 500) { window.alert("Use a reason of up to 500 characters."); return; }
    setBusy(true);
    try {
      const response = await apiFetch("/api/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: interviewId,
          status,
          reason,
          rescheduleRequestedBy: status === "Reschedule Requested" ? requester : undefined,
          datetime: datetime ? new Date(datetime).toISOString() : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error || "Could not update interview.");
      else {
        signalHoneyBadgerMood("sad");
        onRefresh();
      }
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
    <div className="ats-profile ats-profile-redesign">
      <div className="ats-profile-utility"><div className="ats-profile-breadcrumbs"><button type="button" className="ats-profile-back" onClick={onClose}>← Hiring Requests</button><span>/</span><span>{requisition?.title || "Candidate"}</span><span>/</span><strong>{c.name}</strong></div></div>
      <header className="ats-profile-header">
        <div>
          <h3>{c.name}</h3>
          <div className="ats-profile-subtitle">Candidate ID <strong>{c.candidateId || "Pending backfill"}</strong></div>
          <div className="ats-profile-subtitle">{requisition?.title || "Candidate"}<Chip color={statusColor(c.stage)}>{prettyStatus(c.stage)}</Chip></div>
        </div>
        <div className="ats-profile-actions">{canReopen && <button type="button" className="ats-btn-approve" disabled={reopening} onClick={() => void reopenApplication()}>{reopening ? "Reopening…" : "Reopen application"}</button>}{c.cvPath && <button type="button" className="ats-profile-resume" onClick={() => void openResume()}>View CV</button>}{canHmDecide && <><button type="button" className="ats-btn-approve" disabled={busy} data-hm-decision="approve" onClick={() => hmDecide("hmApprove")}>Approve</button><button type="button" className="ats-btn-reject" disabled={busy} data-hm-decision="reject" onClick={() => hmDecide("hmReject")}>Reject</button></>}</div>
      </header>
      {reopenError && <p role="alert">{reopenError}</p>}
      {c.previousApplicationRecordId && <button type="button" className="ats-profile-back" onClick={() => void onOpenApplication(c.previousApplicationRecordId!)}>View previous application</button>}
      <div className="ats-profile-columns">
        <div>
          <section className="ats-profile-section ats-profile-details"><header><h4>Candidate details</h4></header><div className="ats-profile-grid">
            {c.applicationId && <DetailItem label="Application ID" value={c.applicationId} />}<DetailItem label="Email" value={c.email || "—"} /><DetailItem label="Phone" value={c.phone || "—"} /><DetailItem label="Location" value={c.location || "—"} /><DetailItem label="Experience" value={c.experienceYears === undefined ? "—" : `${c.experienceYears} years`} /><DetailItem label="Notice period" value={c.notice ? (/^\d+$/.test(c.notice.trim()) ? `${c.notice} days` : c.notice) : "—"} /><DetailItem label="Source" value={c.source ? `${candidateSourceLabel(c.source) || c.source}${c.sourceDetail ? ` · ${c.sourceDetail}` : ""}` : "—"} /><DetailItem label="Skills" value={c.skills?.length ? c.skills.join(", ") : "Not recorded"} />
            {c.customFields?.map((field) => <DetailItem key={field.id} label={field.label} value={field.value} />)}
          </div></section>
          <section className="ats-profile-section ats-profile-compensation"><header><h4>Compensation</h4></header><div className="ats-profile-grid"><DetailItem label="Fixed" value={c.currentFixedCtc || c.currentCtc || "—"} /><DetailItem label="Variable" value={c.currentVariableCtc || "—"} /><DetailItem label="ESOPs" value={c.presentEsops || "—"} /><DetailItem label="Expected" value={c.expectedCtc || "—"} /></div></section>
          {c.remarks && <section className="ats-profile-section"><header><h4>Recruiter notes</h4></header><div className="ats-profile-recruiter-notes">{c.remarks}</div></section>}

        </div>
        <div className="ats-profile-cv-column">
        <section className="ats-profile-cv-panel">
          {cvPreview ? <iframe title="Candidate CV" src={`${cvPreview}#navpanes=0&view=FitH`} /> : <div className="ats-profile-cv-empty">{cvError ? `CV preview unavailable: ${cvError}` : !c.cvPath ? "No CV attached." : /\.pdf$/i.test(c.cvFileName || "") ? "Loading CV…" : "Preview is available for PDF files. Use View CV to open this file."}</div>}</section>


        </div>
      </div>
        <section id="ats-profile-activity" className="ats-profile-section ats-profile-tools"><header><h4>Activity &amp; history</h4><p>Screening results, communication history and interview progress.</p></header><div className="ats-profile-tool-list">
          {(role === "Admin" || role === "Recruiter" || role === "HiringManager") && <details className="premium-candidate-evidence"><summary>AI screening: evidence against role requirements</summary><HiringAssistant key={c.id} apiFetch={apiFetch} mode="candidate" candidateId={c.id} embedded /></details>}
          {canRecruit(role) && <div className="ats-call-row"><span>Phone: {c.phone || "—"}</span><CallCandidate candidate={c} apiFetch={apiFetch} /></div>}
          {(role === "Admin" || role === "Recruiter") && <CandidateCommunicationHistory key={c.id} candidateId={c.id} apiFetch={apiFetch} />}
      <details className="ats-candidate-history">
        <summary>Candidate timeline ({timeline.length})</summary>
        {timeline.length ? <div className="ats-candidate-timeline">{timeline.map((item, index) => <div key={`${item.at}-${index}`}><span aria-hidden="true" /><div><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}<time>{formatDateTime(item.at, "Date not recorded")}</time></div></div>)}</div> : <p className="ats-candidate-history-empty">No activity recorded yet.</p>}
      </details>
      <details className="ats-candidate-history">
        <summary>Previous interview history ({data.interviewHistory?.length || 0})</summary>
        {data.interviewHistory?.length ? data.interviewHistory.map((item, index) => (
          <section className="ats-candidate-history-item" key={`${item.reqId}-${item.datetime}-${index}`}>
            <div><strong>{item.reqTitle}</strong><span>{formatDateTime(item.datetime, "Date not recorded")}</span></div>
            <p>{item.roundName} · {item.status}</p>
            <p><b>Interviewers:</b> {item.interviewers.length ? item.interviewers.join(", ") : "Not recorded"}</p>
            {item.feedback.map((entry, feedbackIndex) => (
              <div className="ats-candidate-history-feedback" key={`${entry.createdAt}-${feedbackIndex}`}>
                <div><b>{entry.interviewer || "Interviewer"}</b><span>{formatDateTime(entry.createdAt, "")}</span>{entry.rating ? <span>Rating {entry.rating}/5</span> : null}</div>
                {entry.recommendation && <p><b>Recommendation:</b> {entry.recommendation}</p>}
                {entry.feedback && <p>{entry.feedback}</p>}
              </div>
            ))}
          </section>
        )) : <p className="ats-candidate-history-empty">No previous interview records.</p>}
      </details>
      <CandidateComments key={c.id} candidateId={c.id} apiFetch={apiFetch} />
            </div></section>
      {org?.offerJoiningEnabled && (role === "Admin" || role === "Recruiter") && (c.stage === "Offered" || c.stage === "Onboarded" || c.joiningStatus || c.initialDoj || c.currentDoj) && (
        <section className="ats-candidate-joining-details">
          <h4>Offer &amp; Joining Details</h4>
          <div>
            <DetailItem label="Offer Status" value={c.offerApprovalStatus || c.stage} />
            <DetailItem label="Offer Released Date" value={formatDateTime(data.events?.filter((event) => event.toStage === "Offered").sort((left, right) => left.at.localeCompare(right.at))[0]?.at || "", "—")} />
            <DetailItem label="Initial DOJ" value={formatDate(c.initialDoj || c.tentativeDoj, "—")} />
            <DetailItem label="Current DOJ" value={formatDate(c.currentDoj || c.initialDoj || c.tentativeDoj, "—")} />
            <DetailItem label="Joining Status" value={c.joiningStatus || (c.stage === "Onboarded" ? "Joined" : "Awaiting Confirmation")} />
            <DetailItem label="Actual Joining Date" value={formatDate(c.actualJoiningDate, "—")} />
            <DetailItem label="Remarks" value={c.joiningRemarks || "—"} />
          </div>
        </section>
      )}
      {c.hmRejectReason && (
        <div style={{ fontSize: 13, color: "#9a3b3b", marginBottom: 10 }}>
          Rejected: {c.hmRejectReason}
        </div>
      )}
      {canRecruit(role) && rescheduleEligibleInterviews.length > 0 && (
        <div style={{ margin: "10px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
        </div>
      )}
      {canReviewSocialCv && (
        <div className="ats-social-cv-review">
          <div><strong>Social CV review</strong><span>Advance this profile to hiring manager approval or reject the social application.</span></div>
          <div>
            <button type="button" className="ats-btn-reject" disabled={busy} onClick={() => void reviewSocialCv("Social CV Reject")}>Reject Social CV</button>
            <button type="button" className="ats-btn-approve" disabled={busy} onClick={() => void reviewSocialCv("PendingHMApproval")}>Move to HM approval</button>
          </div>
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
            {stageOptions.map(
              (s) => (
                <option key={s} value={s}>
                  {s === "OfferApproved" ? "Offer Approved" : prettyStatus(s)}
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
          {f.customAnswers?.map((item, index) => <div key={index} style={{ marginTop: 8, whiteSpace: "pre-wrap" }}><strong>{item.question}</strong><div>{item.answer?.startsWith("[") ? (() => { try { const parsed = JSON.parse(item.answer); return Array.isArray(parsed) ? parsed.join(", ") : item.answer; } catch { return item.answer; } })() : item.answer || "—"}</div></div>)}
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
          {pendingInterview?.feedbackForm?.description && <p style={{ color: "#626078", fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>{pendingInterview.feedbackForm.description}</p>}
          {(pendingInterview?.feedbackForm?.questions || []).map((rawQuestion, index) => { const q = normalizeQuestion(rawQuestion); const value = customAnswers[index] || ""; const update = (answer: string) => setCustomAnswers((current) => ({ ...current, [index]: answer })); let selected: string[] = []; if (q.type === "checkboxes" && value) { try { selected = JSON.parse(value); } catch { selected = []; } } return <fieldset key={index} style={{ border: "1px solid #e1e6e2", borderRadius: 8, padding: 12, margin: "12px 0" }}><legend style={{ fontSize: 13, fontWeight: 600 }}>{q.label}{q.required ? " *" : ""}</legend>
            {q.description && <p style={{ color: "#626078", fontSize: 12, lineHeight: 1.45, margin: "0 0 8px" }}>{q.description}</p>}
            {q.type === "short" && <input style={inp} value={value} onChange={(e) => update(e.target.value)} />}
            {q.type === "paragraph" && <textarea style={{ ...inp, minHeight: 70 }} value={value} onChange={(e) => update(e.target.value)} />}
            {q.type === "dropdown" && <select style={inp} value={value} onChange={(e) => update(e.target.value)}><option value="">Select an option</option>{q.options.map((option) => <option key={option}>{option}</option>)}</select>}
            {q.type === "multiple" && q.options.map((option) => <label key={option} style={{ display: "block", margin: "6px 0" }}><input type="radio" name={`feedback-${index}`} checked={value === option} onChange={() => update(option)} /> {option}</label>)}
            {q.type === "checkboxes" && q.options.map((option) => <label key={option} style={{ display: "block", margin: "6px 0" }}><input type="checkbox" checked={selected.includes(option)} onChange={(e) => { const next = e.target.checked ? [...selected, option] : selected.filter((v) => v !== option); update(next.length ? JSON.stringify(next) : ""); }} /> {option}</label>)}
            {(q.type === "scale" || q.type === "stars") && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{Array.from({ length: q.scaleMax }, (_, i) => i + 1).map((n) => <button key={n} type="button" aria-label={`${n} of ${q.scaleMax}`} aria-pressed={value === String(n)} onClick={() => update(String(n))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cad5e2", background: value === String(n) ? "#dcefe3" : "white", color: q.type === "stars" && Number(value) >= n ? "#c18b00" : "#344", fontSize: q.type === "stars" ? 22 : 13 }}>{q.type === "stars" ? "★" : n}</button>)}</div>}
          </fieldset>; })}
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
                  fontSize: 26,
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
              const questions = (pendingInterview?.feedbackForm?.questions || []).map(normalizeQuestion);
              if (questions.some((q, index) => !validFeedbackAnswer(q, customAnswers[index] || ""))) { alert("Please complete the required feedback questions."); return; }

              const r = await apiFetch(`/api/candidates/${c.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "feedback",
                  feedback: fb,
                  customAnswers: questions.map((question, index) => ({ question: question.label, answer: customAnswers[index] || "" })),
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
                setCustomAnswers({});
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
                    else {
                      if (dec === "Reject") signalHoneyBadgerMood("sad");
                      onRefresh();
                    }
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
            {iv.format === "in-person" && iv.location && <> · {iv.location}</>}
            {iv.format === "phone" && <> · Telephonic{iv.phoneInstructions ? ` · ${iv.phoneInstructions}` : ""}</>}
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
          <ActivityHistory path={`/api/schedule?activity=${encodeURIComponent(iv.id)}`} apiFetch={apiFetch} />
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
