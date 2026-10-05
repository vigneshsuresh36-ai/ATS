"use client";

import { Fragment, useState } from "react";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { formatSalaryRange } from "@/lib/salaryFormat";
import { Chip, prettyStatus, statusColor } from "./ui";
import type { Candidate, Requisition, Role } from "@/lib/types";

export function ApprovalsView({
  list,
  offerApprovals,
  apiFetch,
  onOpen,
  onOpenCandidate,
  onDone,
  role,
}: {
  list: Requisition[];
  offerApprovals: { candidate: Candidate; requisition: Requisition | null }[];
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onOpen: (id: string) => void;
  onOpenCandidate?: (id: string) => void;
  onDone: () => void;
  role: Role;
}) {
  const [reason, setReason] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [approvalType, setApprovalType] = useState<"requisitions" | "offers">("requisitions");

  async function downloadJd(r: Requisition) {
    const res = await apiFetch(`/api/requisitions/${r.id}/jd`);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not download JD.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.jdFileName || "job-description.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function act(id: string, action: "approve" | "reject") {
    const key = `requisition:${id}`;
    if (action === "reject" && !(reason[key] || "").trim()) {
      setExpanded(key);
      setReasonError(key);
      return;
    }
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/requisitions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason[key] }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error);
      else onDone();
    } finally {
      setBusyId(null);
    }
  }

  async function offerAct(candidateId: string, action: "offerApprove" | "offerReject") {
    const key = `offer:${candidateId}`;
    if (action === "offerReject" && !(reason[key] || "").trim()) {
      setExpanded(key);
      setReasonError(key);
      return;
    }
    setBusyId(candidateId);
    try {
      const response = await apiFetch(`/api/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason[key] }),
      });
      const data = await response.json();
      if (!response.ok) alert(data.error);
      else onDone();
    } finally {
      setBusyId(null);
    }
  }

  if (role === "Recruiter") {
    return (
      <div className="ats-approvals">
        <div className="ats-approval-header">
          <div>
            <h2 className="ats-heading-section">My offer requests</h2>
            <p className="ats-heading-subtitle">Track Department Head decisions on offers you submitted.</p>
          </div>
          <div className="ats-approval-summary" aria-label="Offer request status counts">
            <div><strong>{offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length}</strong><span>Pending</span></div>
            <div><strong>{offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Approved").length}</strong><span>Approved</span></div>
            <div><strong>{offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Rejected").length}</strong><span>Rejected</span></div>
          </div>
        </div>
        {offerApprovals.length === 0 ? (
          <p className="ats-approval-empty">You have not submitted any offer requests.</p>
        ) : (
          <div className="ats-table-wrap">
            <table className="ats-table ats-offer-approval-table">
              <thead>
                <tr><th>Candidate</th><th>Position</th><th>Submitted</th><th>Tentative DOJ</th><th>Fixed CTC</th><th>Variable CTC</th><th>ESOPs</th><th>Joining bonus</th><th>Relocation</th><th>Status</th></tr>
              </thead>
              <tbody>
                {offerApprovals.map(({ candidate, requisition }) => (
                  <tr key={candidate.id}>
                    <td>
                      {onOpenCandidate ? (
                        <button type="button" className="ats-link-btn" onClick={() => onOpenCandidate(candidate.id)}>{candidate.name}</button>
                      ) : <b>{candidate.name}</b>}
                    </td>
                    <td>{requisition?.title || candidate.reqId}</td>
                    <td>{formatDate(candidate.offerRequestedAt, "—")}</td>
                    <td>{formatDate(candidate.tentativeDoj, "—")}</td>
                    <td>{candidate.offeredFixedCtc || candidate.offeredSalary || "—"}</td>
                    <td>{candidate.offeredVariableCtc || "—"} ({candidate.offeredVariablePeriod || "—"})</td>
                    <td>{candidate.offeredEsops || "—"}</td>
                    <td>{candidate.joiningBonus || "—"}</td>
                    <td>{candidate.relocationAssistance === undefined ? "—" : candidate.relocationAssistance ? "Yes" : "No"}</td>
                    <td>
                      <Chip color={statusColor(candidate.offerApprovalStatus || "Pending")}>
                        {candidate.offerApprovalStatus || "Pending"}
                      </Chip>
                      {candidate.offerApprovalStatus === "Rejected" && candidate.offerRejectReason && <div className="ats-sub">{candidate.offerRejectReason}</div>}
                      {candidate.offerDecisionAt && <div className="ats-sub">Decided {formatDateTime(candidate.offerDecisionAt)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (role === "HiringManager") {
    const pendingRequisitions = list.filter((requisition) => requisition.status === "PendingApproval").length;
    const pendingOffers = offerApprovals.filter(({ candidate }) => candidate.offerApprovalStatus === "Pending").length;
    return (
      <div className="ats-approvals">
        <div className="ats-approval-header">
          <div>
            <h2 className="ats-heading-section">My approval tracking</h2>
            <p className="ats-heading-subtitle">Track decisions for requisitions you raised and offers in those hiring pipelines.</p>
          </div>
          <div className="ats-approval-summary" aria-label="Items awaiting approval">
            <div><strong>{pendingRequisitions}</strong><span>Requisitions pending</span></div>
            <div><strong>{pendingOffers}</strong><span>Offers pending</span></div>
          </div>
        </div>

        <section className="ats-approval-section">
          <div className="ats-approval-section-head">
            <div><h3 className="ats-heading-panel">Requisitions raised by me</h3><p className="ats-heading-subtitle">Approval status and approver details</p></div>
            <span className="ats-req-count">{list.length} requisitions</span>
          </div>
          {list.length ? (
            <div className="ats-table-wrap">
              <table className="ats-table">
                <thead><tr><th>Position</th><th>Department</th><th>Openings</th><th>Status</th><th>Decision by</th><th>Decision date</th></tr></thead>
                <tbody>
                  {list.map((requisition) => (
                    <tr key={requisition.id}>
                      <td><button type="button" className="ats-link-btn" onClick={() => onOpen(requisition.id)}>{requisition.title}</button><div className="ats-sub">{requisition.id}</div>{requisition.rejectionReason && <div className="ats-approval-error">{requisition.rejectionReason}</div>}</td>
                      <td>{requisition.department}</td>
                      <td className="num">{requisition.openings}</td>
                      <td><Chip color={statusColor(requisition.status)}>{prettyStatus(requisition.status)}</Chip></td>
                      <td>{requisition.approvedByName || requisition.approvedBy || "—"}</td>
                      <td>{formatDate(requisition.approvedAt, "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ats-approval-empty">You have not raised any requisitions.</p>}
        </section>

        <section className="ats-approval-section">
          <div className="ats-approval-section-head">
            <div><h3 className="ats-heading-panel">Offer approval status</h3><p className="ats-heading-subtitle">Offers under requisitions you raised</p></div>
            <span className="ats-req-count">{offerApprovals.length} offers</span>
          </div>
          {offerApprovals.length ? (
            <div className="ats-table-wrap">
              <table className="ats-table ats-offer-approval-table">
                <thead><tr><th>Candidate</th><th>Position</th><th>Offer status</th><th>Tentative DOJ</th><th>Fixed CTC</th><th>Variable CTC</th><th>ESOPs</th><th>Joining bonus</th><th>Relocation</th><th>Decision date</th></tr></thead>
                <tbody>
                  {offerApprovals.map(({ candidate, requisition }) => (
                    <tr key={candidate.id}>
                      <td><button type="button" className="ats-link-btn" onClick={() => onOpenCandidate?.(candidate.id)}>{candidate.name}</button></td>
                      <td>{requisition?.title || candidate.reqId}</td>
                      <td><Chip color={statusColor(candidate.offerApprovalStatus || "Pending")}>{candidate.offerApprovalStatus || "Pending"}</Chip>{candidate.offerApprovalStatus === "Rejected" && candidate.offerRejectReason && <div className="ats-approval-error">{candidate.offerRejectReason}</div>}</td>
                      <td>{formatDate(candidate.tentativeDoj, "—")}</td>
                      <td>{candidate.offeredFixedCtc || candidate.offeredSalary || "—"}</td>
                      <td>{candidate.offeredVariableCtc || "—"} ({candidate.offeredVariablePeriod || "—"})</td>
                      <td>{candidate.offeredEsops || "—"}</td>
                      <td>{candidate.joiningBonus || "—"}</td>
                      <td>{candidate.relocationAssistance === undefined ? "—" : candidate.relocationAssistance ? "Yes" : "No"}</td>
                      <td>{formatDate(candidate.offerDecisionAt, "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="ats-approval-empty">No offer requests on your requisitions yet.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="ats-approvals">
      <div className="ats-approval-header">
        <div>
          <h2 className="ats-heading-section">Approval queue</h2>
          <p className="ats-heading-subtitle">Review requisition requests and proposed candidate offers.</p>
        </div>
        <div className="ats-approval-summary" aria-label="Pending approvals">
          <div><strong>{list.length}</strong><span>Requisitions</span></div>
          <div><strong>{offerApprovals.length}</strong><span>Offers</span></div>
        </div>
      </div>

      <div className="ats-approval-tabs" role="tablist" aria-label="Approval type">
        <button
          type="button"
          role="tab"
          aria-selected={approvalType === "requisitions"}
          className={approvalType === "requisitions" ? "is-active" : ""}
          onClick={() => setApprovalType("requisitions")}
        >
          Requisition approvals <span>{list.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={approvalType === "offers"}
          className={approvalType === "offers" ? "is-active" : ""}
          onClick={() => setApprovalType("offers")}
        >
          Offer approvals <span>{offerApprovals.length}</span>
        </button>
      </div>

      {approvalType === "offers" && <section className="ats-approval-section">
          <div className="ats-approval-section-head">
            <div>
              <h3 className="ats-heading-panel">Offer approvals</h3>
              <p className="ats-heading-subtitle">Review a candidate’s proposed compensation and joining date.</p>
            </div>
            <span className="ats-req-count">{offerApprovals.length} pending</span>
          </div>
          {offerApprovals.length === 0 ? (
            <p className="ats-approval-empty">No offer approvals pending.</p>
          ) : <div className="ats-table-wrap">
            <table className="ats-table ats-offer-approval-table">
              <thead><tr><th>Candidate</th><th>Department</th><th>Role</th><th>Tentative DOJ</th><th>Fixed CTC</th><th>Variable CTC</th><th>ESOPs</th><th>Joining bonus</th><th>Relocation</th><th className="actions">Actions</th></tr></thead>
              <tbody>
                {offerApprovals.map(({ candidate, requisition }) => {
                  const key = `offer:${candidate.id}`;
                  const open = expanded === key;
                  return (
                    <Fragment key={candidate.id}>
                      <tr>
                        <td><b>{candidate.name}</b><div className="ats-sub">{candidate.email}</div></td>
                        <td>{requisition?.department || "—"}</td>
                        <td>{requisition?.title || candidate.reqId}</td>
                        <td>{formatDate(candidate.tentativeDoj, "—")}</td>
                        <td>{candidate.offeredFixedCtc || candidate.offeredSalary || "—"}</td>
                        <td>{candidate.offeredVariableCtc || "—"} ({candidate.offeredVariablePeriod || "—"})</td>
                        <td>{candidate.offeredEsops || "—"}</td>
                        <td>{candidate.joiningBonus || "—"}</td>
                        <td>{candidate.relocationAssistance === undefined ? "—" : candidate.relocationAssistance ? "Yes" : "No"}</td>
                        <td className="actions">
                          <div className="ats-action-row">
                            {onOpenCandidate && <button type="button" className="ats-btn-secondary" aria-label={`Review full candidate details for ${candidate.name}`} onClick={() => onOpenCandidate(candidate.id)}>Review candidate</button>}
                            <button type="button" className="ats-btn-approve" disabled={busyId === candidate.id} onClick={() => offerAct(candidate.id, "offerApprove")}>Approve</button>
                            <button type="button" className="ats-btn-reject" disabled={busyId === candidate.id} onClick={() => setExpanded(open ? null : key)}>Reject</button>
                          </div>
                        </td>
                      </tr>
                      {open && <tr className="ats-expand-row"><td colSpan={10}>
                        <div className="ats-expand-panel">
                          <label className="ats-expand-label" htmlFor={`offer-rej-${candidate.id}`}>Rejection reason (required)</label>
                          <input id={`offer-rej-${candidate.id}`} className="ats-expand-input" required aria-invalid={reasonError === key} aria-describedby={reasonError === key ? `offer-rej-error-${candidate.id}` : undefined} value={reason[key] || ""} onChange={(e) => {
                            setReason((current) => ({ ...current, [key]: e.target.value }));
                            if (e.target.value.trim()) setReasonError(null);
                          }} placeholder="Explain why this offer is being rejected" />
                          {reasonError === key && <p id={`offer-rej-error-${candidate.id}`} className="ats-approval-error" role="alert">Enter a rejection reason to continue.</p>}
                          <div className="ats-action-row" style={{ marginTop: 10 }}><button type="button" className="ats-btn-reject" disabled={busyId === candidate.id} onClick={() => offerAct(candidate.id, "offerReject")}>Confirm reject</button></div>
                        </div>
                      </td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
            }
      </section>}

      {approvalType === "requisitions" && <section className="ats-approval-section">
        <div className="ats-approval-section-head">
          <div>
            <h3 className="ats-heading-panel">Requisition approvals</h3>
            <p className="ats-heading-subtitle">Review requests to open or fill a role before recruiting begins.</p>
          </div>
          <span className="ats-req-count">{list.length} pending</span>
        </div>
        {list.length === 0 ? (
          <p className="ats-approval-empty">No requisition approvals pending.</p>
        ) : (
        <div className="ats-table-wrap">
          <table className="ats-table ats-approvals-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Status</th>
                <th>Department</th>
                <th>Location</th>
                <th>HM</th>
                <th>Exp</th>
                <th>Salary</th>
                <th className="num">Openings</th>
                <th>JD</th>
                <th className="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const key = `requisition:${r.id}`;
                const open = expanded === key;
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() =>
                        setExpanded((cur) => (cur === key ? null : key))
                      }
                    >
                      <td className="mono" title={r.id}>
                        {r.id.replace(/^REQ_/, "")}
                      </td>
                      <td className="title">{r.title}</td>
                      <td>
                        <Chip color={statusColor(r.status)}>
                          {prettyStatus(r.status)}
                        </Chip>
                      </td>
                      <td>{r.department}</td>
                      <td className="loc" title={r.location || undefined}>
                        {r.location || "—"}
                      </td>
                      <td>
                        <div>{r.raisedByName}</div>
                        <div className="ats-sub">{r.raisedByEmail}</div>
                      </td>
                      <td className="nowrap">{r.level || "—"}</td>
                      <td className="nowrap">
                        {formatSalaryRange(r.salaryMin, r.salaryMax)}
                      </td>
                      <td className="num">{r.openings}</td>
                      <td
                        className="nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.jdPath && r.jdFileName ? (
                          <button
                            type="button"
                            className="ats-link-btn"
                            onClick={() => downloadJd(r)}
                          >
                            Download
                          </button>
                        ) : r.jdFileName ? (
                          <span className="ats-muted" title={r.jdFileName}>
                            File
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className="actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="ats-action-row">
                          <button
                            type="button"
                            className="ats-btn-secondary"
                            onClick={() => onOpen(r.id)}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="ats-btn-approve"
                            disabled={busyId === r.id}
                            onClick={() => act(r.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="ats-btn-reject"
                            disabled={busyId === r.id}
                            onClick={() => setExpanded(open ? null : key)}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="ats-expand-row">
                        <td colSpan={11}>
                          <div className="ats-expand-panel">
                            <div className="ats-expand-meta">
                              <span>
                                Join: <b>{r.priority || "—"}</b>
                              </span>
                              <span>
                                Raised:{" "}
                                <b>
                                  {formatDateTime(r.createdAt, "—")}
                                </b>
                              </span>
                            </div>
                            <div className="ats-expand-meta">
                              <span>
                                Type: <b>{r.requisitionType || "—"}</b>
                              </span>
                              {r.requisitionType === "New" && (
                                <span>
                                  Business justification: <b>{r.businessJustification || "—"}</b>
                                </span>
                              )}
                              {r.requisitionType === "Replacement" && (
                                <span>
                                  Employee code being replaced: <b>{r.replacementEmployeeCode || "—"}</b>
                                </span>
                              )}
                            </div>
                            {r.notes && (
                              <div className="ats-expand-notes">
                                <div className="ats-expand-label">Notes</div>
                                {r.notes}
                              </div>
                            )}
                            <label
                              className="ats-expand-label"
                              htmlFor={`rej-${r.id}`}
                            >
                              Rejection reason (required)
                            </label>
                            <input
                              id={`rej-${r.id}`}
                              className="ats-expand-input"
                              required
                              aria-invalid={reasonError === key}
                              aria-describedby={reasonError === key ? `rej-error-${r.id}` : undefined}
                              placeholder="Explain why this requisition is being rejected"
                              value={reason[key] || ""}
                              onChange={(e) => {
                                setReason((s) => ({ ...s, [key]: e.target.value }));
                                if (e.target.value.trim()) setReasonError(null);
                              }}
                            />
                            {reasonError === key && <p id={`rej-error-${r.id}`} className="ats-approval-error" role="alert">Enter a rejection reason to continue.</p>}
                            <div
                              className="ats-action-row"
                              style={{ marginTop: 10 }}
                            >
                              <button
                                type="button"
                                className="ats-btn-approve"
                                disabled={busyId === r.id}
                                onClick={() => act(r.id, "approve")}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="ats-btn-reject"
                                disabled={busyId === r.id}
                                onClick={() => act(r.id, "reject")}
                              >
                                Confirm reject
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </section>}
    </div>
  );
}

