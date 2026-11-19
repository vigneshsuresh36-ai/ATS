"use client";

import { Fragment, useEffect, useState } from "react";
import { JobDescriptionSection } from "./JobDescriptionSection";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { DEFAULT_INTERVIEW_ROUNDS, getInterviewRounds } from "@/lib/interviewPlan";
import { formatSalaryRange } from "@/lib/salaryFormat";
import { canRecruit } from "@/lib/roles";
import { openRejectionEmailDraft } from "@/lib/rejectionEmail";
import { signalHoneyBadgerMood } from "@/lib/honeyBadgerMood";
import { canEditRequisitionPriority, isRequisitionClosed, isRequisitionOpenForRecruiting } from "@/lib/requisitionStatus";
import { joiningCountdownLabel, joiningTimeline } from "@/lib/joiningTimeline";
import { remainingOfferOpenings } from "@/lib/offerCapacity";
import { ActivityHistory } from "./ActivityHistory";
import { CallCandidate } from "./CallCandidate";
import { EmailCandidate } from "./EmailCandidate";
import { CandidateStatusMenu } from "./CandidateStatusMenu";
import { dropoffRisk } from "@/lib/dropoffRisk";
import { recruiterCollaborators } from "@/lib/recruiterAssignment";
import { RoleHiringBrief } from "./RoleHiringBrief";
import { RoleSummaryEditor } from "./RoleSummaryEditor";
import {
  Chip,
  DetailItem,
  prettyStatus,
  statusColor,
  inp,
  lab,
  stepBtn,
} from "./ui";
import type {
  AppUser,
  Candidate,
  Interview,
  InterviewPlan,
  OrgSettings,
  Requisition,
  Role,
} from "@/lib/types";
import type { CvComparisonItem } from "@/lib/cvComparison";

type CvMatchResult = { id: string; cvPath: string; requisitionJdText: string; stale?: boolean; status: "ready" | "unavailable"; message: string; score?: number; items?: CvComparisonItem[] };

function getNextSchedulableRound(
  candidate: Candidate,
  interviews: Interview[],
  rounds: InterviewPlan["rounds"]
): number | null {
  const bookedRounds = new Set(interviews
    .filter((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled")
    .map((interview) => interview.roundIndex || 1));
  const maxScheduledRound = Math.max(0, ...bookedRounds);
  const nextRound = rounds.find((round) => !bookedRounds.has(round.order))?.order ?? null;
  if (candidate.stage === "HMApproved" && maxScheduledRound === 0) return nextRound;

  const lastAdvancedRound = candidate.lastAdvancedRound ?? 0;
  if (
    candidate.stage === "Selected" &&
    lastAdvancedRound > 0 &&
    lastAdvancedRound === maxScheduledRound
  ) {
    return nextRound;
  }

  return null;
}

export function PipelinePanel({
  req,
  initialDetailsPage = false,
  candidates,
  interviews,
  plan,
  org,
  recruiters = [],
  role,
  profileEmail,
  onClose,
  apiFetch,
  onRefresh,
  onCand,
  onAddCandidate,
  onScheduleCandidate,
  onRescheduleInterview,
  onCandAction,
}: {
  req: Requisition;
  initialDetailsPage?: boolean;
  candidates: Candidate[];
  interviews: Interview[];
  plan: InterviewPlan | null;
  org: OrgSettings | null;
  recruiters?: AppUser[];
  role: Role;
  profileEmail?: string;
  onClose: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onRefresh: () => void;
  onCand: (id: string) => void;
  onAddCandidate?: () => void;
  onScheduleCandidate?: (candidateId: string, roundIndex: number) => void;
  onRescheduleInterview?: (interview: Interview) => void;
  /** Opens feedback, debrief or offer in a side panel without leaving the pipeline. */
  onCandAction?: (candidateId: string, section: "feedback" | "update-feedback" | "debrief" | "offer") => void;
}) {
  const [assignedCollaborators, setAssignedCollaborators] = useState(req.recruiterCollaboratorEmails || []);
  const collaboratorsChanged = recruiterCollaborators(assignedCollaborators).join(",") !== recruiterCollaborators(req.recruiterCollaboratorEmails).join(",");
  const [assignedRecruiter, setAssignedRecruiter] = useState(req.recruiterEmail || "");
    const [assignedPriorityLevel, setAssignedPriorityLevel] = useState(req.priorityLevel || "P4");
  const [detailsPage, setDetailsPage] = useState(initialDetailsPage);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [cvMatches, setCvMatches] = useState<Record<string, CvMatchResult>>({});
  const [cvMatchBusy, setCvMatchBusy] = useState(false);
  const [cvMatchesLoading, setCvMatchesLoading] = useState(true);
  const [cvMatchError, setCvMatchError] = useState("");
  const [expandedCvMatch, setExpandedCvMatch] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCvMatchesLoading(true);
    setCvMatches({});
    apiFetch(`/api/requisitions/${encodeURIComponent(req.id)}/cv-comparisons`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load saved CV comparisons.");
      if (!cancelled) setCvMatches(Object.fromEntries((data.results as CvMatchResult[]).map((result) => [result.id, result])));
    }).catch((error) => { if (!cancelled) setCvMatchError(error instanceof Error ? error.message : "Could not load saved CV comparisons."); })
      .finally(() => { if (!cancelled) setCvMatchesLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, req.id]);
    const [candidateStageFilter, setCandidateStageFilter] = useState("");
    const [candidatePage, setCandidatePage] = useState(1);
    const [briefOpen, setBriefOpen] = useState(false);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [socialLink, setSocialLink] = useState("");
  const [socialLinkBusy, setSocialLinkBusy] = useState(false);
  const [socialLinkCopied, setSocialLinkCopied] = useState(false);
  const [socialLinkError, setSocialLinkError] = useState("");
  const [careersBusy, setCareersBusy] = useState(false);
  const [careersError, setCareersError] = useState("");
  const [socialCvReviewId, setSocialCvReviewId] = useState<string | null>(null);
  const [holdDecisionId, setHoldDecisionId] = useState<string | null>(null);
  const [summaryEditing, setSummaryEditing] = useState(false);
  useEffect(() => {
    const selector = ".ats-pipeline-row-actions[open]";
    function closeMenus(event: MouseEvent) {
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach((menu) => {
        if (!menu.contains(event.target as Node) || (event.target instanceof Element && event.target.closest("button"))) menu.open = false;
      });
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      document.querySelectorAll<HTMLDetailsElement>(selector).forEach((menu) => {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
      });
    }
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", closeMenus);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);
  const capacityFull = req.status === "Position Fulfilled" || remainingOfferOpenings(req.openings, candidates) === 0;
  const canAdd =
    (role === "Admin" || canRecruit(role)) &&
    !capacityFull &&
    (req.status === "Approved" ||
      req.status === "Position Reopened" ||
      req.status === "Partially Fulfilled");
  const interviewRounds = getInterviewRounds(plan);
  const isHmOwner =
    role === "HiringManager" &&
    !!profileEmail &&
    req.raisedByEmail === profileEmail.toLowerCase();

  useEffect(() => {
    setAssignedRecruiter(req.recruiterEmail || "");
    setAssignedCollaborators(req.recruiterCollaboratorEmails || []);
    setAssignedPriorityLevel(req.priorityLevel || "P4");
  }, [req.id, req.recruiterEmail, req.recruiterCollaboratorEmails, req.priorityLevel]);

  useEffect(() => {
    let cancelled = false;
    setSocialLink("");
    if (
      (role !== "Admin" && role !== "Recruiter") ||
      !["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status)
    ) return;
    apiFetch(`/api/requisitions/${req.id}/social-link`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!cancelled && data?.token) {
          setSocialLink(new URL(`/apply/${data.token}`, window.location.origin).toString());
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [apiFetch, req.id, req.recruiterEmail, req.status, role]);

  async function assignRecruiter() {
    const currentRecruiter = (req.recruiterEmail || "").trim().toLowerCase();
    const reasonRequired = !!currentRecruiter && assignedRecruiter.trim().toLowerCase() !== currentRecruiter;
    const reason = reasonRequired ? window.prompt("Reason for changing recruiter ownership:")?.trim() : undefined;
    if (reasonRequired && !reason) return;
    if (reason && reason.length > 500) { alert("Use a reason of up to 500 characters."); return; }
    setAssignmentBusy(true);
    try {
      const response = await apiFetch(`/api/requisitions/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recruiterEmail: assignedRecruiter,
          recruiterCollaboratorEmails: assignedRecruiter ? assignedCollaborators : [],
          reason,
          ...(canEditRequisitionPriority(req.status) ? { priorityLevel: assignedPriorityLevel } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) alert(result.error || "Could not assign recruiter.");
      else onRefresh();
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function createSocialLink() {
    setSocialLinkBusy(true);
    setSocialLinkError("");
    try {
      const response = await apiFetch(`/api/requisitions/${req.id}/social-link`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setSocialLinkError(data.error || "Could not create the social application link.");
        return;
      }
      const link = new URL(`/apply/${data.token}`, window.location.origin).toString();
      setSocialLink(link);
      await copySocialLink(link);
    } catch {
      setSocialLinkError("Could not create the social application link.");
    } finally {
      setSocialLinkBusy(false);
    }
  }

  async function copySocialLink(link = socialLink) {
    try {
      await navigator.clipboard.writeText(link);
      setSocialLinkError("");
      setSocialLinkCopied(true);
      window.setTimeout(() => setSocialLinkCopied(false), 1800);
    } catch {
      setSocialLinkError("Clipboard access was unavailable. Select and copy the link instead.");
    }
  }

  async function setCareersVisibility(published: boolean) {
    setCareersBusy(true); setCareersError("");
    try {
      const response = await apiFetch(`/api/requisitions/${req.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setCareersVisibility", published }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update careers visibility.");
      onRefresh();
    } catch (error) { setCareersError(error instanceof Error ? error.message : "Could not update careers visibility."); }
    finally { setCareersBusy(false); }
  }

  const scheduledInterviewCount = interviews.filter(
    (interview) => interview.status === "Scheduled" || interview.status === "Rescheduled"
  ).length;
  const filledPositions = req.status === "Position Fulfilled"
    ? req.openings
    : Math.min(req.openings, candidates.filter((candidate) => candidate.stage === "Onboarded").length);
  const currentProcessStep = req.status === "PendingApproval"
    ? 1
    : req.status === "Position Fulfilled" || req.status === "Position Closed" || req.status === "Closed"
      ? 4
      : interviews.length > 0
        ? 3
        : 2;
  const processDetails = [
    { key: "request", label: "Request", detail: `Submitted${req.createdAt ? ` · ${formatDateTime(req.createdAt)}` : ""}` },
    { key: "approval", label: "Approval", detail: req.status === "PendingApproval" ? "Waiting for approval" : req.approvedAt ? `Approved ${formatDate(req.approvedAt)}${req.approvedByName ? ` by ${req.approvedByName}` : ""}` : prettyStatus(req.status) },
    { key: "recruiting", label: "Recruiting", detail: candidates.length ? `${candidates.length} candidates` : "In progress" },
    { key: "interviews", label: "Interviews", detail: `${scheduledInterviewCount} scheduled` },
    { key: "filled", label: "Filled", detail: `${filledPositions} of ${req.openings} hires` },
  ];
  const processSteps = processDetails.map((step, index) => ({
    ...step,
    progress: index < currentProcessStep ? "done" : index === currentProcessStep ? "current" : "upcoming",
  }));
  const candidateStages = [...new Set(candidates.map((candidate) => candidate.stage))];
  const filteredCandidates = candidates.filter((candidate) =>
    (!candidateSearch.trim() || `${candidate.name} ${candidate.email} ${candidate.candidateId || ""} ${candidate.stage}`.toLowerCase().includes(candidateSearch.trim().toLowerCase())) &&
    (!candidateStageFilter || candidate.stage === candidateStageFilter)
  );
  const candidatePageSize = 20;
  const candidatePageCount = Math.max(1, Math.ceil(filteredCandidates.length / candidatePageSize));
  const currentCandidatePage = Math.min(candidatePage, candidatePageCount);
  const visibleCandidates = filteredCandidates.slice((currentCandidatePage - 1) * candidatePageSize, currentCandidatePage * candidatePageSize);
  const firstCandidate = filteredCandidates.length ? (currentCandidatePage - 1) * candidatePageSize + 1 : 0;
  const lastCandidate = Math.min(currentCandidatePage * candidatePageSize, filteredCandidates.length);
  const requestStatusLabel = req.status === "Approved" ? "Open" : prettyStatus(req.status);
  const joiningTarget = joiningTimeline(req);

  async function compareVisibleCvs() {
    if (!visibleCandidates.length || cvMatchBusy) return;
    setCvMatchBusy(true); setCvMatchError("");
    try {
      for (let index = 0; index < visibleCandidates.length; index += 4) {
        const response = await apiFetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "role-cv-comparison", requisitionId: req.id, candidateIds: visibleCandidates.slice(index, index + 4).map((candidate) => candidate.id) }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not compare all CVs. Results completed so far are shown.");
        if (!Array.isArray(data.results) || typeof data.requisitionJdText !== "string") throw new Error("The comparison returned an incomplete result. Results completed so far are shown.");
        setCvMatches((current) => ({ ...current, ...Object.fromEntries((data.results as CvMatchResult[]).map((result) => [result.id, { ...result, requisitionJdText: data.requisitionJdText }])) }));
      }
    } catch (error) { setCvMatchError(error instanceof Error ? error.message : "Could not compare CVs."); }
    finally { setCvMatchBusy(false); }
  }

  type NextStep = { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; good?: boolean; title?: string };
  /** The first step is the row's main button; the rest go into its "more" menu. */
  function nextSteps(candidate: Candidate, schedulableRound: number | null, feedbackPending: boolean): NextStep[] {
    const steps: NextStep[] = [];
    if (capacityFull || !isRequisitionOpenForRecruiting(req.status)) return steps;
    const recruiter = canRecruit(role);
    const open = (section: "feedback" | "update-feedback" | "debrief" | "offer") => (onCandAction ? onCandAction(candidate.id, section) : onCand(candidate.id));
    if (candidate.stage === "On Hold" && recruiter) {
      const candidateInterviews = interviews.filter((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled");
      const canSelect = candidateInterviews.length > 0 && candidateInterviews.every((interview) => interview.hasFeedback && interview.status !== "Reschedule Requested");
      steps.push({ label: holdDecisionId === candidate.id ? "Saving…" : "Selected", good: true, disabled: holdDecisionId === candidate.id || !canSelect, title: canSelect ? undefined : "Complete the interview and feedback before selecting this candidate.", onClick: () => void decideHeldCandidate(candidate.id, "Advance") });
      steps.push({ label: "Rejected", danger: true, disabled: holdDecisionId === candidate.id, onClick: () => void decideHeldCandidate(candidate.id, "Reject") });
    }
    if ((candidate.stage === "Social CV" || (candidate.source === "Employee Referral" && candidate.stage === "New")) && recruiter) {
      const saving = socialCvReviewId === candidate.id;
      steps.push({ label: saving ? "Saving…" : "Select CV", good: true, disabled: saving, onClick: () => void reviewSocialCv(candidate, "PendingHMApproval") });
      steps.push({ label: "Reject CV", danger: true, disabled: saving, onClick: () => void reviewSocialCv(candidate, candidate.source === "Employee Referral" ? "Rejected" : "Social CV Reject") });
    }
    if (candidate.stage === "PendingHMApproval" && (isHmOwner || role === "Admin")) {
      steps.push({ label: "Approve", good: true, onClick: () => void hmDecide(candidate.id, "hmApprove") });
      steps.push({ label: "Reject", danger: true, onClick: () => void hmDecide(candidate.id, "hmReject") });
    }
    if (recruiter && feedbackPending) steps.push({ label: "Add feedback", onClick: () => open("feedback") });
    const live = interviews.filter((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled" && interview.status !== "Reschedule Requested");
    const latestRound = live.reduce((max, interview) => Math.max(max, interview.roundIndex || 1), 0);
    const debrief = (recruiter || isHmOwner) && live.length > 0 && live.every((interview) => interview.hasFeedback) &&
      (candidate.stage === "Debrief" || (["Selected", "Interview Scheduled"].includes(candidate.stage) && latestRound > (candidate.lastAdvancedRound || 0)));
    if (debrief) steps.push({ label: "Decide: select or reject", onClick: () => open("debrief") });
    if (recruiter && onScheduleCandidate && schedulableRound !== null) steps.push({ label: `Schedule interview · Round ${schedulableRound}`, onClick: () => onScheduleCandidate(candidate.id, schedulableRound) });
    const offerInterviews = interviews.filter((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled");
    const offerReady = offerInterviews.length > 0 && offerInterviews.every((interview) => interview.hasFeedback) && interviewRounds.every((round) => offerInterviews.some((interview) => (interview.roundIndex || 1) === round.order));
    if (candidate.stage === "Selected" && recruiter && candidate.offerApprovalStatus !== "Pending" && candidate.offerApprovalStatus !== "Approved" && (interviewRounds.at(-1)?.order ?? 0) <= (candidate.lastAdvancedRound || 0) && offerReady) steps.push({ label: "Request offer", onClick: () => open("offer") });
    return steps;
  }

  async function decideHeldCandidate(candidateId: string, decision: "Advance" | "Reject") {
    setHoldDecisionId(candidateId);
    try {
      const response = await apiFetch(`/api/candidates/${candidateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "debrief", decision, expectedStage: "On Hold" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the candidate.");
      onRefresh();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Could not update the candidate."); } finally { setHoldDecisionId(null); }
  }

  async function hmDecide(
    candidateId: string,
    action: "hmApprove" | "hmReject"
  ) {
    let reason: string | undefined;
    if (action === "hmReject") {
      reason =
        window.prompt("Rejection reason (optional):") ||
        "Rejected by hiring manager";
    }
    const r = await apiFetch(`/api/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    const d = await r.json();
    if (!r.ok) alert(d.error);
    else {
      if (action === "hmReject") {
        signalHoneyBadgerMood("sad");
        const candidate = candidates.find((item) => item.id === candidateId);
        if (candidate) {
          openRejectionEmailDraft({
            candidateEmail: candidate.email,
            candidateName: candidate.name,
            requisitionTitle: req.title,
            rejectionReason: reason,
            org,
          });
        }
      }
      onRefresh();
    }
  }

  async function reviewSocialCv(candidate: Candidate, stage: "PendingHMApproval" | "Social CV Reject" | "Rejected") {
    setSocialCvReviewId(candidate.id);
    try {
      const response = await apiFetch(`/api/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stage", stage }),
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Could not review this CV.");
        return;
      }
      if (stage === "Social CV Reject" || stage === "Rejected") {
        signalHoneyBadgerMood("sad");
        openRejectionEmailDraft({
          candidateEmail: candidate.email,
          candidateName: candidate.name,
          requisitionTitle: req.title,
          rejectionReason: "Not selected after Social CV review",
          org,
        });
      }
      onRefresh();
    } finally {
      setSocialCvReviewId(null);
    }
  }

  return (
    <div className="ats-pipeline-panel">
      {detailsPage ? <nav className="ats-role-details-breadcrumb" aria-label="Breadcrumb"><button type="button" className="ats-pipeline-back" onClick={() => setDetailsPage(false)}><span aria-hidden="true">←</span> Hiring Requests</button><span aria-hidden="true">/</span><span aria-current="page">Role details</span></nav> : <>
      <div className="ats-compact-top"><button type="button" className="ats-pipeline-back" onClick={onClose} aria-label="All hiring requests" title="All hiring requests">
        <span aria-hidden="true">←</span>
      </button>
      <header className="ats-pipeline-header">
        <div className="ats-pipeline-title">
          <h1>{req.title}</h1>
          <div className="ats-pipeline-title-meta">
            <Chip color={statusColor(req.status)}>{requestStatusLabel}</Chip>
            <span className="ats-compact-id">{req.id}</span>
            <span>{req.department}</span>
            <span>{(req.location || "").split(",").filter((city) => city.trim()).length > 1 ? "Multiple Positions" : req.location || "Location not set"}</span>
            <span>Created {formatDate(req.createdAt)}</span>
            {joiningTarget && <span className={`ats-joining-target is-${joiningTarget.status}`} data-due-today={joiningTarget.remainingDays === 0 ? "" : undefined} title={`Joining target: ${joiningTarget.targetDays} days after approval`}>{joiningCountdownLabel(joiningTarget.remainingDays)} · {formatDate(joiningTarget.deadline)}</span>}
          </div>
        </div>
        <div className="ats-pipeline-actions">
          <button type="button" className="ats-pipeline-action" onClick={() => { setSummaryEditing(false); setDetailsPage(true); }}>Role details</button>
          {(role === "Admin" || canRecruit(role)) && ["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status) && <button type="button" className="ats-pipeline-action" disabled={socialLinkBusy} onClick={() => void (socialLink ? copySocialLink() : createSocialLink())}>{socialLinkBusy ? "Preparing…" : socialLinkCopied ? "Copied!" : "Social Link"}</button>}
          {canAdd && onAddCandidate && <button type="button" className="ats-pipeline-action is-primary ats-add-candidate-action" onClick={onAddCandidate}><span aria-hidden="true">＋</span> Add candidate</button>}
        </div>
      </header></div>
      {socialLinkError && <p className="ats-social-link-error" role="alert">{socialLinkError}{socialLink && <> <input aria-label="Social application link" value={socialLink} readOnly onFocus={(event) => event.currentTarget.select()} /></>}</p>}

      <div className="ats-compact-process"><div id="ats-hiring-process" className="ats-pipeline-process-heading"><h4>Hiring process</h4></div>
      <div className="ats-pipeline-process" style={{ display: "flex", gap: 0, marginBottom: 18, overflowX: "auto", paddingBottom: 4 }}>
        {processSteps.map((step, i) => (
          <div key={step.key} className={`ats-pipeline-step is-${step.progress}`} title={step.detail} aria-label={`${step.label}: ${step.detail}`} style={{ flex: "1 1 100px", minWidth: 100, padding: "10px 12px", borderRadius: 6, marginRight: i < processSteps.length - 1 ? 6 : 0 }} aria-current={step.progress === "current" ? "step" : undefined}>
            <span className="ats-process-number" aria-hidden="true">{step.progress === "done" ? "✓" : i + 1}</span>
            <div className="ats-process-copy"><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</div>
          </div>
        ))}
      </div></div>
      </>}
      {detailsPage && <header className="ats-details-page-heading"><div className="ats-role-details-title"><h1>{req.title}</h1><span className={req.status === "Approved" ? "ats-role-details-status is-open" : "ats-role-details-status"}>{requestStatusLabel}</span></div><p>{[req.department, req.location].filter(Boolean).join(" · ")}</p></header>}
      {detailsPage ? (
      <div className="ats-position-view ats-role-details-layout">
      <div className="ats-detail-summary-grid">
      <section id="ats-role-summary" className="ats-detail-role-card"><div className="ats-pipeline-section-head"><h4>Role summary</h4>{!summaryEditing && !isRequisitionClosed(req.status) && (role === "Admin" || canRecruit(role) || (isHmOwner && req.status === "PendingApproval")) && <button type="button" className="ats-pipeline-action is-primary" onClick={() => setSummaryEditing(true)}>Edit</button>}</div>
      {summaryEditing ? <RoleSummaryEditor req={req} apiFetch={apiFetch} officeLocations={org?.officeLocations} org={org} canChangeScope={role === "Admin" || role === "HiringManager" || !org?.businessUnits?.length} onCancel={() => setSummaryEditing(false)} onSaved={onRefresh} /> : <>
      <div
        className="ats-pipeline-overview"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 10,
          margin: "16px 0",
          padding: 14,
          background: "#f6f6f6",
          borderRadius: 12,
          border: "1px solid #ddd",
        }}
      >
        <DetailItem label="Department" value={req.department || "Not specified"} />
        {req.subDepartment && <DetailItem label="Sub-department" value={req.subDepartment} />}
        <DetailItem label="Business unit" value={req.lob || "Not specified"} />
        <DetailItem label="Location" value={req.location || "—"} />
        <DetailItem label="Employment" value={req.employment || "—"} />
        <DetailItem label="Experience" value={req.level || "—"} />
        <DetailItem
          label="Salary"
          value={formatSalaryRange(req.salaryMin, req.salaryMax)}
        />
        {!joiningTarget && <DetailItem label="Joining timeline" value={req.priority || "—"} />}
        <DetailItem label="Openings" value={String(req.openings)} />
        <DetailItem label="Hiring manager" value={`${req.raisedByName}`} />
        {role !== "DepartmentHead" && role !== "HiringManager" && !isRequisitionClosed(req.status) && req.status !== "PendingApproval" && req.status !== "Rejected" && <div className="ats-pipeline-priority-detail"><span>Priority</span><strong>{["P1", "P2", "P3", "P4"].includes(req.priorityLevel || "") ? req.priorityLevel : "Not set"}</strong></div>}
        {req.jdFileName && req.jdPath && (
          <div id="ats-pipeline-jd-file">
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.4,
                color: "#8a8a82",
              }}
            >
              JD PDF
            </div>
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const res = await apiFetch(`/api/requisitions/${req.id}/jd`);
                if (!res.ok) {
                  const d = await res.json().catch(() => ({}));
                  alert(d.error || "Could not download JD.");
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = req.jdFileName || "job-description.pdf";
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
              style={{
                marginTop: 2,
                padding: 0,
                border: 0,
                background: "transparent",
                color: "#333",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                textDecoration: "underline",
              }}
            >
              Download {req.jdFileName}
            </button>
          </div>
        )}
      </div>
      {joiningTarget && (
        <div className="ats-role-fulfillment">
          <div className="ats-role-fulfillment-fields">
            <DetailItem label="Approved on" value={formatDate(joiningTarget.approvalDate)} />
            <DetailItem label="Joining timeline" value={req.priority} />
            <DetailItem label="Fulfillment cutoff" value={formatDate(joiningTarget.deadline)} />
            <div className="ats-role-fulfillment-countdown">
              <div>Time remaining</div>
              <span className={"ats-joining-target is-" + joiningTarget.status} data-due-today={joiningTarget.remainingDays === 0 ? "" : undefined}>{joiningCountdownLabel(joiningTarget.remainingDays)}</span>
            </div>
          </div>
          <p>Cutoff is based on {joiningTarget.targetDays} calendar {joiningTarget.targetDays === 1 ? "day" : "days"} from approval.</p>
        </div>
      )}
      </>}

      </section>

      </div>
      <div className="ats-role-details-main">
      {(req.jdText || ((role === "Admin" || role === "Recruiter") && !isRequisitionClosed(req.status))) && (
        <JobDescriptionSection
          key={req.id} req={req} role={role} apiFetch={apiFetch} onRefresh={onRefresh}
          previewActions={(role === "Admin" || role === "Recruiter") && isRequisitionOpenForRecruiting(req.status) && <>
            {req.careersPublished || socialLink ? (
              <button type="button" className="ats-jd-button ats-jd-primary" disabled={careersBusy} onClick={() => void setCareersVisibility(!req.careersPublished)}>
                {careersBusy ? "Saving…" : req.careersPublished ? "Remove careers listing" : "List on careers page"}
              </button>
            ) : (
              <button type="button" className="ats-jd-button" disabled={socialLinkBusy} onClick={() => void createSocialLink()}>
                {socialLinkBusy ? "Preparing…" : "Generate application link"}
              </button>
            )}
            {careersError && <span className="ats-jd-action-error" role="alert">{careersError}</span>}
          </>}
        />
      )}
      {req.notes && <section className="ats-role-notes" aria-labelledby="ats-role-notes-heading"><h4 id="ats-role-notes-heading">Notes</h4><p>{req.notes}</p></section>}
      {interviews.length > 0 && <details className="ats-position-additional-interviews"><summary>Interviews ({interviews.length})</summary><div>{interviews.map((interview) => <p key={interview.id}>{formatDateTime(interview.datetime)}{interview.roundName ? ` · Round ${interview.roundIndex}: ${interview.roundName}` : ` · ${interview.stage}`} · {interview.status}{interview.interviewerEmails?.length ? ` · ${interview.interviewerEmails.join(", ")}` : ""}{interview.meetLink ? <> · <a href={interview.meetLink} target="_blank" rel="noreferrer">Meet</a></> : null}</p>)}</div></details>}
      <div className="ats-role-details-history">
      <ActivityHistory path={`/api/requisitions/${encodeURIComponent(req.id)}?activity=1`} apiFetch={apiFetch} />
      </div>
      </div>
      <section className="ats-role-details-side" aria-label="Recruiter assignment and interview rounds">
      {role === "Admin" && !isRequisitionClosed(req.status) && (
        <div className="ats-pipeline-assignment">
          <h3>Recruiter assignment</h3>
          <div>
            <label style={lab}>Primary recruiter</label>
            <select style={inp} value={assignedRecruiter} onChange={(event) => setAssignedRecruiter(event.target.value)}>
              <option value="">Unassigned</option>
              {recruiters.map((recruiter) => <option key={recruiter.email} value={recruiter.email}>{recruiter.name}</option>)}
            </select>
          </div>
          <fieldset className="ats-role-collaborators">
            <legend>Collaborators</legend>
            {!assignedRecruiter && <small>Choose a primary recruiter first.</small>}
            {[...recruiters, ...assignedCollaborators.filter((email) => !recruiters.some((recruiter) => recruiter.email === email)).map((email) => ({ email, name: email, active: false }))].filter((recruiter) => recruiter.email !== assignedRecruiter && (recruiter.active || assignedCollaborators.includes(recruiter.email))).map((recruiter) => (
              <label key={recruiter.email} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" disabled={!assignedRecruiter || assignmentBusy} checked={assignedCollaborators.includes(recruiter.email)} onChange={(event) => {
                  const checked = event.target.checked;
                  setAssignedCollaborators((current) => checked ? [...current, recruiter.email] : current.filter((email) => email !== recruiter.email));
                }} />
                {recruiter.name}
              </label>
            ))}
          </fieldset>
          {canEditRequisitionPriority(req.status) && <div>
            <label style={lab}>Priority</label>
            <select style={inp} value={assignedPriorityLevel} onChange={(event) => setAssignedPriorityLevel(event.target.value)}>
              {["P1", "P2", "P3", "P4"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </div>}
          <button type="button" className="ats-role-details-save" disabled={assignmentBusy || (assignedRecruiter === (req.recruiterEmail || "") && !collaboratorsChanged && (!canEditRequisitionPriority(req.status) || assignedPriorityLevel === (req.priorityLevel || "P4")))} onClick={assignRecruiter}>
            {assignmentBusy ? "Saving…" : "Save assignment"}
          </button>
        </div>
      )}
      {socialLinkError && <p className="ats-social-link-error" role="alert">{socialLinkError}</p>}
      {canRecruit(role) && ["Approved", "Position Reopened", "Partially Fulfilled"].includes(req.status) && <InterviewRoundsEditor reqId={req.id} apiFetch={apiFetch} onSaved={onRefresh} />}


      </section>

      </div>
      ) : (
      <div id="ats-candidates-view" className="ats-candidates-view">

      {req.status === "PendingApproval" && (
        <div
          className="ats-pipeline-notice"
          style={{
            padding: 12,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          Waiting for {req.department ? "department-head" : "Admin"} approval. Recruiting is locked until
          approved.
        </div>
      )}

      <div id="ats-pipeline-candidates" className="ats-candidate-pipeline-heading">
        <div className="ats-candidate-pipeline-title"><h2>Candidate pipeline</h2><span>{candidates.length} candidates</span></div>
        <div className="ats-candidate-pipeline-controls">
          {(role === "Admin" || role === "Recruiter" || role === "HiringManager" || role === "DepartmentHead") && <button type="button" className="ats-cv-compare-button" aria-expanded={briefOpen} onClick={() => setBriefOpen((open) => !open)}>✦ AI brief</button>}
          <button type="button" className="ats-cv-compare-button" disabled={cvMatchBusy || cvMatchesLoading || visibleCandidates.length === 0} onClick={() => void compareVisibleCvs()}>{cvMatchBusy ? "Comparing…" : cvMatchesLoading ? "Loading…" : "✦ Compare CVs"}</button>
          <input aria-label="Search candidates" type="search" value={candidateSearch} onChange={(event) => { setCandidateSearch(event.target.value); setCandidatePage(1); }} placeholder="Search candidates" />
          <label className="ats-candidate-filter"><select aria-label="Filter candidates by stage" value={candidateStageFilter} onChange={(event) => { setCandidateStageFilter(event.target.value); setCandidatePage(1); }}><option value="">Filter</option>{candidateStages.map((stage) => <option key={stage} value={stage}>{prettyStatus(stage)}</option>)}</select></label>
        </div>
      </div>
      {briefOpen && <RoleHiringBrief key={req.id} requisitionId={req.id} apiFetch={apiFetch} />}
      {cvMatchError && <p className="ats-cv-match-error" role="alert">{cvMatchError}</p>}
      {candidates.length > 0 && <p className="ats-cv-match-hint">Compare CVs reviews the candidates on this page. Scores show the share of identified job requirements with verified CV evidence; review the evidence before deciding.</p>}
      {candidates.length === 0 && <div className="ats-pipeline-empty-illustration"><img src="/candidate-empty-state.png" alt="" width={240} height={160} /><strong>No candidates yet</strong><p>Candidates added to this position will appear here.</p>{canAdd && onAddCandidate && <button type="button" className="ats-pipeline-action" onClick={onAddCandidate}>＋ Add candidate</button>}</div>}

      {candidates.length > 0 && (
        <div className="ats-pipeline-candidate-table">
          <table className="ats-table ats-pipeline-table">
            <thead><tr><th>Candidate</th><th>Current status</th><th>Interviews</th><th>Experience</th><th>CV / JD match</th><th>Expected salary</th><th>Notice</th><th>Actions</th></tr></thead>
            <tbody>{visibleCandidates.map((candidate) => {
              const schedulableRound = getNextSchedulableRound(candidate, interviews, interviewRounds);
              const candidateInterviewCount = interviews.filter((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled").length;
              const inInterviewStage = ["Interview", "Interview Scheduled", "Debrief"].includes(candidate.stage);
              const feedbackPending = inInterviewStage && interviews.some((interview) => interview.candidateId === candidate.id && interview.status !== "Cancelled" && interview.status !== "Reschedule Requested" && (interview.feedbackPending || (interview.status === "Rescheduled" && !interview.hasFeedback)));
              const offerBackout = canRecruit(role) && candidate.offerApprovalStatus === "Approved" && ["OfferApproved", "Offered"].includes(candidate.stage);
              const showStatusUpdate = !capacityFull && isRequisitionOpenForRecruiting(req.status) && canRecruit(role) && (candidate.stage === "Interview Scheduled" || candidate.stage === "Debrief");
              const rescheduleInterviews = interviews.filter((interview) => interview.candidateId === candidate.id && (interview.status === "Scheduled" || interview.status === "Rescheduled"));
              const rescheduledInterviews = rescheduleInterviews.filter((interview) => interview.status === "Rescheduled");
              const requestedReschedules = interviews.filter((interview) => interview.candidateId === candidate.id && interview.status === "Reschedule Requested");
              const result = cvMatches[candidate.id];
              const stale = !!result && (result.stale === true || result.requisitionJdText !== (req.jdText || "") || result.cvPath !== (candidate.cvPath || ""));
              const expanded = expandedCvMatch === candidate.id;
              return <Fragment key={candidate.id}><tr className="ats-pipeline-candidate-row" onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea")) onCand(candidate.id); }}>
                <td><div className="ats-name-cell"><button type="button" className="ats-pipeline-candidate-person" onClick={() => onCand(candidate.id)}><span className="ats-pipeline-candidate-avatar">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><span><strong>{candidate.name}</strong><small title={[candidate.email, candidate.candidateId].filter(Boolean).join(" · ")}>{candidate.email || "No email provided"}{candidate.candidateId ? ` · ${candidate.candidateId}` : ""}</small></span></button>{canRecruit(role) && <span className="ats-contact-icons" onClick={(event) => event.stopPropagation()}><CallCandidate candidate={candidate} apiFetch={apiFetch} variant="icon" roleTitle={req.title} /><EmailCandidate candidate={candidate} apiFetch={apiFetch} variant="icon" roleTitle={req.title} /></span>}</div></td>
                <td><span className={`ats-pipeline-stage-pill ${["Rejected", "Social CV Reject", "Candidate Backed Out"].includes(candidate.stage) ? "is-rejected" : ["HMApproved", "Selected", "OfferApproved", "Offered", "Onboarded"].includes(candidate.stage) ? "is-approved" : ["PendingHMApproval", "OfferApprovalPending", "On Hold"].includes(candidate.stage) ? "is-review" : candidate.stage === "New" ? "is-new" : "is-progress"}`}>{prettyStatus(candidate.stage)}</span>{(() => { const risk = dropoffRisk(candidate, Math.floor((Date.now() - new Date(candidate.updatedAt || candidate.createdAt).getTime()) / 86400000)); return risk && canRecruit(role) ? <span className={`ats-risk-pill is-${risk.level.toLowerCase()}`} title={risk.reasons.join(". ")}>{risk.level} drop-off risk</span> : null; })()}</td>
                <td>{candidateInterviewCount}</td>
                <td>{candidate.experienceYears != null ? `${candidate.experienceYears} years` : "—"}</td>
                <td>{!result ? <span className="ats-cv-match-pending">Not reviewed</span> : stale ? <span className="ats-cv-match-pending">Needs refresh</span> : result.status !== "ready" ? <span className="ats-cv-match-unavailable"><span className="ats-cv-match-pending">Not reviewed</span><small>{result.message}</small></span> : <button type="button" className="ats-cv-match-score" aria-expanded={expanded} onClick={() => setExpandedCvMatch(expanded ? null : candidate.id)}><strong>{result.score}% match</strong><small>AI estimate · {expanded ? "Hide evidence" : "View evidence"}</small></button>}</td>
                <td>{candidate.expectedCtc || "—"}</td>
                <td>{candidate.notice || "—"}</td>
                <td onClick={(event) => event.stopPropagation()}><div className="ats-pending-actions ats-next-actions">
                  {(() => {
                    const shown = offerBackout ? [] : nextSteps(candidate, schedulableRound, feedbackPending);
                    return <>
                      {offerBackout && <CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} apiFetch={apiFetch} onDone={onRefresh} label="Candidate Offer Reject/Backout" directBackout offerBackout />}
                      {shown.map((step) => <button type="button" key={step.label} className={`ats-next-btn${step.danger ? " is-bad" : step.good ? " is-good" : ""}`} disabled={step.disabled} title={step.title} onClick={step.onClick}>{step.label}</button>)}
                      {shown.some((step) => step.label === "Request offer") && <CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} apiFetch={apiFetch} onDone={onRefresh} label="Candidate Backout" directBackout />}
                      {showStatusUpdate && onRescheduleInterview && requestedReschedules.map((interview) => <button type="button" key={interview.id} className="ats-next-btn" onClick={() => onRescheduleInterview(interview)}>{requestedReschedules.length > 1 ? `Reschedule interview · Round ${interview.roundIndex || 1}` : "Reschedule interview"}</button>)}
                      {showStatusUpdate && candidate.stage === "Interview Scheduled" && rescheduledInterviews.length > 0 && <><CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} eligible={rescheduledInterviews} apiFetch={apiFetch} onDone={onRefresh} label="Candidate reschedule" accessibleLabel="Candidate requested reschedule" directReschedule="candidate" /><CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} eligible={rescheduledInterviews} apiFetch={apiFetch} onDone={onRefresh} label="Interviewer reschedule" accessibleLabel="Interviewer requested reschedule" directReschedule="interviewer" /></>}
                      {showStatusUpdate && (candidate.stage === "Debrief" ? !shown.some((step) => step.label === "Add feedback") : rescheduleInterviews.length > 0 && rescheduledInterviews.length === 0) && <CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} eligible={rescheduleInterviews} apiFetch={apiFetch} onDone={onRefresh} label={candidate.stage === "Debrief" ? "Interview Backout" : "Update feedback"} directBackout={candidate.stage === "Debrief"} allowReschedule={candidate.stage === "Interview Scheduled"} showBackout={candidate.stage !== "Interview Scheduled"} />}
                      {showStatusUpdate && candidate.stage === "Interview Scheduled" && !shown.some((step) => step.label === "Add feedback") && <CandidateStatusMenu candidateId={candidate.id} name={candidate.name} stage={candidate.stage} apiFetch={apiFetch} onDone={onRefresh} label={rescheduledInterviews.length ? "Candidate backout" : "Interview Backout"} directBackout />}
                      {!shown.length && !showStatusUpdate && !offerBackout && <span className="ats-next-empty">—</span>}
                    </>;
                  })()}
                </div></td>
              </tr>{expanded && result?.status === "ready" && !stale && <tr className="ats-cv-evidence-row"><td colSpan={8}><section className="ats-cv-evidence" aria-label={`CV match evidence for ${candidate.name}`}><div className="ats-cv-evidence-heading"><strong>CV / JD match evidence</strong><span>AI can miss details. Review the CV before deciding.</span></div><div className="ats-cv-evidence-list">{result.items?.map((item, index) => <div key={index}><span>{item.requirement}</span><span>{item.evidence}</span><b>{item.found ? "Found in CV" : "Not verified"}</b></div>)}</div><small>{result.message}. The percentage is the number of requirements with verified evidence divided by the requirements identified by AI; it is not a hiring recommendation.</small></section></td></tr>}</Fragment>;
            })}</tbody>
          </table>
        </div>
      )}
      {candidates.length > 0 && visibleCandidates.length === 0 && <p className="ats-candidates-empty">No candidates match this search.</p>}
      {filteredCandidates.length > candidatePageSize && <nav className="ats-pipeline-pagination" aria-label="Candidate pages"><span>Showing {firstCandidate}–{lastCandidate} of {filteredCandidates.length} candidates</span><div><button type="button" aria-label="Previous page" disabled={currentCandidatePage <= 1} onClick={() => setCandidatePage(currentCandidatePage - 1)}>‹</button><span>Page {currentCandidatePage} of {candidatePageCount}</span><button type="button" aria-label="Next page" disabled={currentCandidatePage >= candidatePageCount} onClick={() => setCandidatePage(currentCandidatePage + 1)}>›</button></div></nav>}

      </div>
      )}
    </div>
  );
}

function InterviewRoundsEditor({
  reqId,
  apiFetch,
  onSaved,
}: {
  reqId: string;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onSaved: () => void;
}) {
  const [rounds, setRounds] = useState<InterviewPlan["rounds"]>([
    ...DEFAULT_INTERVIEW_ROUNDS.map(({ name, order }) => ({ name, order })),
  ]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [forms, setForms] = useState<import("@/lib/types").FeedbackFormTemplate[]>([]);
  const [configured, setConfigured] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    apiFetch("/api/org").then((r) => r.json()).then((d) => setForms(d.org?.feedbackFormTemplates || [])).catch(() => setForms([]));
    apiFetch(`/api/requisitions/${reqId}/plan`)
      .then((r) => r.json())
      .then((d) => {
        const plan = d.plan as InterviewPlan | null;
        if (plan?.rounds?.length) {
          setRounds(
            plan.rounds.map((r, i) => ({
              name: r.name,
              order: r.order || i + 1,
              feedbackFormId: r.feedbackFormId,
              applicable: r.applicable,
              type: r.type,
              competencies: r.competencies,
            }))
          );
          setConfigured(true);
          setEditing(false);
        } else {
          setRounds(
            DEFAULT_INTERVIEW_ROUNDS.map(({ name, order }) => ({ name, order }))
          );
          setConfigured(false);
          setEditing(false);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [reqId, apiFetch]);

  async function save() {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/requisitions/${reqId}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rounds: rounds.map((x, i) => ({
            name: x.name,
            order: i + 1,
            type: x.type || "interview",
            competencies: x.competencies || [],
            applicable: x.applicable !== false,
            feedbackFormId: x.feedbackFormId || "",
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error);
      else {
        setConfigured(true);
        setEditing(false);
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div
      id="ats-interview-rounds" className="ats-pipeline-rounds"
      style={{
        border: "1px solid #ebe6da",
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
        background: "#faf9f6",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: configured && !editing ? 8 : 6,
        }}
      >
        <h4 style={{ margin: 0 }}>Applicable interview rounds</h4>
        {!editing && (
          <button
            type="button"
            className="ats-pipeline-action is-primary"
            onClick={() => setEditing(true)}
          >
            Edit rounds
          </button>
        )}
      </div>

      {!editing ? (
        <>
          <table className="ats-role-round-table">
            <thead><tr><th scope="col">#</th><th scope="col">Interview round</th><th scope="col">Feedback type</th></tr></thead>
            <tbody>{rounds.map((round) => (
              <tr key={round.order}>
                <td>{round.order}</td>
                <td>{round.name.replace(/^Round \d+\s+[—–-]\s+/, "")}</td>
                <td>{round.applicable === false ? "Skipped" : round.feedbackFormId ? forms.find((form) => form.id === round.feedbackFormId)?.name || "Form unavailable" : "Standard feedback"}</td>
              </tr>
            ))}</tbody>
          </table>
          {!configured && (
            <p style={{ fontSize: 12, color: "#777", margin: "6px 0 0" }}>
              Round 1 is ready to schedule. Save only when adding or changing rounds.
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
            {configured
              ? "Choose which rounds apply to this requisition. Skipped rounds are unavailable for new scheduling."
              : "Round 1 is ready to schedule. Add more rounds here when needed."}
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Count</span>
            <button
              type="button"
              style={stepBtn}
              onClick={() =>
                setRounds((rs) =>
                  rs.length <= 1
                    ? rs
                    : rs.slice(0, -1).map((x, i) => ({ ...x, order: i + 1 }))
                )
              }
            >
              −
            </button>
            <b>{rounds.length}</b>
            <button
              type="button"
              style={stepBtn}
              onClick={() =>
                setRounds((rs) => [
                  ...rs,
                  {
                    name: `Round ${rs.length + 1}`,
                    order: rs.length + 1,
                  },
                ])
              }
            >
              +
            </button>
          </div>
          {rounds.map((round, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <label style={lab}>Round {i + 1} name</label>
              <input
                style={inp}
                value={round.name}
                onChange={(e) =>
                  setRounds((rs) =>
                    rs.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x
                    )
                  )
                }
              />
              <button
                type="button"
                className="ats-pipeline-action"
                disabled={busy || (round.applicable !== false && rounds.filter((item) => item.applicable !== false).length === 1)}
                onClick={() => setRounds((current) => current.map((item, index) =>
                  index === i ? { ...item, applicable: item.applicable === false } : item
                ))}
              >
                {round.applicable === false ? "Include" : "Skip"} Round {round.order}
              </button>
              <label style={lab}>Feedback form (optional)</label>
              <select style={inp} value={round.feedbackFormId || ""} onChange={(e) => setRounds((rs) => rs.map((x, j) => j === i ? { ...x, feedbackFormId: e.target.value } : x))}><option value="">Standard feedback</option>{round.feedbackFormId && !forms.some((f) => f.id === round.feedbackFormId) && <option value={round.feedbackFormId}>Form unavailable — choose another</option>}{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select>
            </div>
          ))}
          {rounds.every((round) => round.applicable === false) && <p role="status">Include at least one interview round.</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="ats-role-details-save"
              disabled={busy || rounds.every((round) => round.applicable === false)}
              onClick={save}
            >
              {busy ? "Saving…" : "Save rounds"}
            </button>
            {configured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                style={{
                  border: "1px solid #d9d3c5",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
