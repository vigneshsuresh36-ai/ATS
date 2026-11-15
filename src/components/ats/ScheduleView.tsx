"use client";

import { RecruitmentDrive } from "./RecruitmentDrive";
import { ActivityHistory } from "./ActivityHistory";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatDate } from "@/lib/dateFormat";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { cancelBtn, inp, lab, saveBtn, prettyStatus } from "./ui";
import type {
  Candidate,
  Interview,
  InterviewPlan,
  InterviewFormat,
  OrgSettings,
  Requisition,
} from "@/lib/types";

const SCHEDULABLE = new Set([
  "HMApproved",
  "Screened",
  "Shortlist",
  "Interview",
  "Interview Scheduled",
  "Selected",
  "Debrief",
  "On Hold",
]);

export function ScheduleView({
  reqs,
  officeLocations = [],
  apiFetch,
  onDone,
  readOnly = false,
  initialReqId,
  initialCandidateId,
  initialRoundIndex,
}: {
  reqs: Requisition[];
  officeLocations?: OrgSettings["officeLocations"];
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onDone: () => void;
  readOnly?: boolean;
  initialReqId?: string;
  initialCandidateId?: string;
  initialRoundIndex?: number;
}) {
  const [reqId, setReqId] = useState(initialReqId || "");
  const [cands, setCands] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState(initialCandidateId || "");
  const [format, setFormat] = useState<InterviewFormat | "">("");
  const [officeKey, setOfficeKey] = useState("");
  const [phoneInstructions, setPhoneInstructions] = useState("");
  const [datetime, setDatetime] = useState("");
  const [interviewers, setInterviewers] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [slots, setSlots] = useState<{ start: string }[]>([]);
  const [slotNote, setSlotNote] = useState("");
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [roundIndex, setRoundIndex] = useState(initialRoundIndex || 1);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [allInterviews, setAllInterviews] = useState<Interview[]>([]);
  const [allCandidates, setAllCandidates] = useState<Candidate[]>([]);
  const [calendarDate, setCalendarDate] = useState(() => toDateKey(new Date()));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch("/api/schedule")
      .then((r) => r.json())
      .then((d) => setCalendarEnabled(!!d.calendarEnabled))
      .catch(() => setCalendarEnabled(false));
  }, [apiFetch]);

  useEffect(() => {
    Promise.all([
      apiFetch("/api/schedule").then((r) => r.json()),
      apiFetch("/api/candidates").then((r) => r.json()),
    ])
      .then(([scheduleData, candidateData]) => {
        setAllInterviews(scheduleData.interviews || []);
        setAllCandidates(candidateData.candidates || []);
      })
      .catch(() => {
        setAllInterviews([]);
        setAllCandidates([]);
      });
  }, [apiFetch]);

  useEffect(() => {
    if (!reqId) {
      setCands([]);
      setPlan(null);
      return;
    }
    Promise.all([
      apiFetch(`/api/candidates?reqId=${reqId}`).then((r) => r.json()),
      apiFetch(`/api/requisitions/${reqId}/plan`).then((r) => r.json()),
    ]).then(([cd, pd]) => {
      setCands(
        (cd.candidates || []).filter((c: Candidate) =>
          SCHEDULABLE.has(c.stage)
        )
      );
      setPlan(pd.plan || null);
    });
  }, [reqId, apiFetch]);

  useEffect(() => {
    if (!candidateId) {
      setInterviews([]);
      return;
    }
    apiFetch(`/api/schedule?candidateId=${encodeURIComponent(candidateId)}`)
      .then((r) => r.json())
      .then((d) => setInterviews(d.interviews || []))
      .catch(() => setInterviews([]));
  }, [candidateId, apiFetch]);

  const rounds = useMemo(() => getInterviewRounds(plan), [plan]);

  const bookedRounds = useMemo(() => {
    const set = new Set<number>();
    for (const iv of interviews) {
      if (iv.status === "Cancelled") continue;
      set.add(iv.roundIndex || 1);
    }
    return set;
  }, [interviews]);

  const availableRounds = useMemo(() => {
    const nextRound = rounds.find((round) => !bookedRounds.has(round.order));
    return nextRound ? [nextRound] : [];
  }, [rounds, bookedRounds]);

  useEffect(() => {
    if (!availableRounds.length) return;
    const preferred =
      initialRoundIndex &&
      availableRounds.some((r) => r.order === initialRoundIndex)
        ? initialRoundIndex
        : availableRounds[0].order;
    setRoundIndex(preferred);
  }, [availableRounds, initialRoundIndex, candidateId]);

  const selectedCand = cands.find((c) => c.id === candidateId);
  const candidatesById = useMemo(
    () => new Map(allCandidates.map((candidate) => [candidate.id, candidate])),
    [allCandidates]
  );
  const requisitionsById = useMemo(
    () => new Map(reqs.map((requisition) => [requisition.id, requisition])),
    [reqs]
  );
  const dayInterviews = useMemo(
    () =>
      allInterviews
        .filter((interview) =>
          interview.status !== "Reschedule Requested" &&
          toDateKey(new Date(interview.datetime)) === calendarDate
        )
        .sort((a, b) => a.datetime.localeCompare(b.datetime)),
    [allInterviews, calendarDate]
  );
  const office = officeLocations.find((item) => JSON.stringify([item.name, item.city || ""]) === officeKey);
  const canSubmit =
    !!format &&
    (format !== "video" || calendarEnabled) &&
    (format !== "in-person" || !!office) &&
    (format !== "phone" || !!phoneInstructions.trim()) &&
    !!reqId &&
    !!candidateId &&
    !!datetime &&
    !!interviewers.trim() &&
    availableRounds.length > 0 &&
    availableRounds.some((r) => r.order === roundIndex);

  async function schedule() {
    if (!canSubmit) {
      alert("Fill in the interview format, its required details, and the scheduling fields.");
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reqId,
          candidateId,
          datetime: new Date(datetime).toISOString(),
          durationMinutes,
          format,
          ...(format === "in-person" && office ? { officeName: office.name, officeCity: office.city || "" } : {}),
          ...(format === "phone" ? { phoneInstructions } : {}),
          interviewers,
          roundIndex,
        }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error);
      else {
        if (d.interview) {
          setAllInterviews((current) => [...current, d.interview]);
          setAllCandidates((current) =>
            current.map((candidate) =>
              candidate.id === candidateId
                ? { ...candidate, stage: "Interview Scheduled" }
                : candidate
            )
          );
        }
        if (d.inviteSent) {
          alert("Interview scheduled — calendar invites sent.");
        }
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  function shiftCalendarDate(days: number) {
    const next = new Date(`${calendarDate}T12:00:00`);
    next.setDate(next.getDate() + days);
    setCalendarDate(toDateKey(next));
  }

  return (
    <div style={{ width: "100%" }}>
      {!readOnly && <RecruitmentDrive reqs={reqs} offices={officeLocations} interviews={allInterviews} candidateNames={new Map(allCandidates.map((item) => [item.id, item.name]))} calendarEnabled={calendarEnabled} apiFetch={apiFetch} onBooked={(interview) => {
        setAllInterviews((current) => [...current.filter((item) => item.id !== interview.id), interview]);
        setAllCandidates((current) => current.map((candidate) => candidate.id === interview.candidateId ? { ...candidate, stage: "Interview Scheduled" } : candidate));
        if (candidateId === interview.candidateId) setInterviews((current) => [...current.filter((item) => item.id !== interview.id), interview]);
      }} />}
      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={calendarToolbar}>
          <div>
            <h2 className="ats-heading-section">Interview calendar</h2>
            <div className="ats-heading-subtitle">
              Day-wise overview of scheduled interviews and candidate status.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={calendarButton} onClick={() => shiftCalendarDate(-1)}>
              ←
            </button>
            <button type="button" style={todayButton} onClick={() => setCalendarDate(toDateKey(new Date()))}>
              Today
            </button>
            <button type="button" style={calendarButton} onClick={() => shiftCalendarDate(1)}>
              →
            </button>
          </div>
        </div>
        <div style={calendarDateLabel}>{formatDate(calendarDate)}</div>
        {dayInterviews.length === 0 ? (
          <div style={calendarEmpty}>No interviews scheduled for this day.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {dayInterviews.map((interview) => {
              const candidate = candidatesById.get(interview.candidateId);
              const requisition = requisitionsById.get(interview.reqId);
              return (
                <div key={interview.id} style={calendarItem}>
                  <div style={calendarTime}>{formatInterviewTime(interview.datetime)}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>
                      {candidate?.name || "Candidate unavailable"}
                    </div>
                    <div style={{ color: "#666", fontSize: 12, marginTop: 3 }}>
                      {requisition?.title || interview.reqId} · {interview.roundName || `Round ${interview.roundIndex || 1}`}
                    </div>
                    <div style={{ color: "#777", fontSize: 12, marginTop: 3 }}>
                      With {interview.interviewerEmails?.join(", ") || "Interviewer not listed"}
                      {interview.driveId && " · Recruitment Drive"}
                    </div>
                    {interview.format === "in-person" && <div>In person · {interview.location}</div>}
                    {interview.format === "phone" && <div>Telephonic · {interview.phoneInstructions}</div>}
                    {interview.format === "video" && interview.meetLink && <a href={interview.meetLink} target="_blank" rel="noreferrer">Join Google Meet</a>}
                  </div>
                  <div style={statusStack}>
                    <ActivityHistory path={`/api/schedule?activity=${encodeURIComponent(interview.id)}`} apiFetch={apiFetch} />
                    <span style={interviewStatus(interview.status)}>{interview.status}{interview.rescheduleRequestedBy ? ` · ${interview.rescheduleRequestedBy}` : ""}</span>
                    <span style={candidateStatus}>{candidate ? prettyStatus(candidate.stage) : "Unknown"}</span>
                    {interview.feedbackPending && (
                      <span style={feedbackPendingStatus}>
                        Feedback pending · {interview.feedbackAgeDays || 0}d
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {readOnly ? (
        <div style={panel}>
          <h2 className="ats-heading-section">Team schedule</h2>
          <p className="ats-heading-subtitle">
              Read-only view. Interviews are scheduled and changed by the assigned Recruiter.
          </p>
        </div>
      ) : <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 className="ats-heading-section">
            Schedule interview
          </h2>
          <p className="ats-heading-subtitle">
            Book the next open round for an HM-approved candidate. Duplicate
            rounds stay locked.
          </p>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "8px 12px",
            borderRadius: 999,
            background: calendarEnabled ? "#eef7f0" : "#f3f2ed",
            color: calendarEnabled ? "#2f5d3a" : "#777",
            border: `1px solid ${calendarEnabled ? "#cfe3d4" : "#e6e2d6"}`,
          }}
        >
          {calendarEnabled ? "Calendar invites on" : "Calendar invites off"}
        </div>
      </div>

      <section style={panel}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
          className="ats-sched-grid"
        >
          <div style={col}>
            <h3 className="ats-heading-panel">Who</h3>
            <label style={{ ...lab, marginTop: 0 }}>
              Requisition (approved only)
            </label>
            <select
              style={inp}
              value={reqId}
              onChange={(e) => {
                setReqId(e.target.value);
                setCandidateId("");
                setInterviews([]);
              }}
            >
              <option value="">—</option>
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.title}
                </option>
              ))}
            </select>

            <label style={lab}>Candidate (HM approved+)</label>
            <select
              style={inp}
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
            >
              <option value="">—</option>
              {cands.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` (${c.email})` : ""} — {prettyStatus(c.stage)}
                </option>
              ))}
            </select>

            {rounds.length > 0 && (
              <>
                <label style={lab}>Round</label>
                {!candidateId ? (
                  <p style={{ fontSize: 13, color: "#888", margin: "6px 0 0" }}>
                    Select a candidate to see available rounds.
                  </p>
                ) : availableRounds.length === 0 ? (
                  <div style={mutedBox}>
                    {selectedCand
                      ? `All configured rounds are already scheduled for ${selectedCand.name}.`
                      : "No rounds left to schedule for this candidate."}
                  </div>
                ) : (
                  <select
                    style={inp}
                    value={roundIndex}
                    onChange={(e) => setRoundIndex(Number(e.target.value))}
                  >
                    {availableRounds.map((r) => (
                      <option key={r.order} value={r.order}>
                        {r.order}. {r.name}
                      </option>
                    ))}
                  </select>
                )}
                {candidateId && bookedRounds.size > 0 && (
                  <p style={{ fontSize: 12, color: "#888", marginTop: 10 }}>
                    Already scheduled:{" "}
                    {[...bookedRounds]
                      .sort((a, b) => a - b)
                      .map((n) => `R${n}`)
                      .join(", ")}
                  </p>
                )}
              </>
            )}
          </div>

          <div style={col}>
            <h3 className="ats-heading-panel">When and where</h3>
            <label style={lab} htmlFor="interview-format">Interview format *</label>
            <select id="interview-format" style={inp} value={format} onChange={(event) => setFormat(event.target.value as InterviewFormat | "")}>
              <option value="">Choose a format</option>
              <option value="in-person">In person</option>
              <option value="phone">Telephonic</option>
              <option value="video" disabled={!calendarEnabled}>Video (Google Meet){calendarEnabled ? "" : " — Calendar off"}</option>
            </select>
            {format && !calendarEnabled && <p>This booking is saved in the ATS. Connect Google Calendar to send invites.</p>}
            {format === "in-person" && <>
              <label style={lab} htmlFor="interview-office">Office location *</label>
              <select id="interview-office" style={inp} value={officeKey} onChange={(event) => setOfficeKey(event.target.value)}>
                <option value="">Choose an office</option>
                {officeLocations.map((item) => {
                  const key = JSON.stringify([item.name, item.city || ""]);
                  return <option key={key} value={key}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>;
                })}
              </select>
              <p>{office ? [...new Set([office.name, office.address, office.city].filter(Boolean))].join(", ") : officeLocations.length ? "Choose a saved office location." : "Add an office or city in Settings → Company Profile → Office locations."}</p>
            </>}
            {format === "phone" && <>
              <label style={lab} htmlFor="interview-phone">Call instructions *</label>
              <input id="interview-phone" style={inp} value={phoneInstructions} maxLength={300} onChange={(event) => setPhoneInstructions(event.target.value)} placeholder="e.g. The recruiter will call you at the scheduled time" />
            </>}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 0.6fr",
                gap: 12,
              }}
              className="ats-sched-when"
            >
              <div>
                <label style={{ ...lab, marginTop: 0 }}>Date & time *</label>
                <input
                  type="datetime-local"
                  style={inp}
                  required
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                />
              </div>
              <div>
                <label style={{ ...lab, marginTop: 0 }}>Duration (min)</label>
                <input
                  type="number"
                  min={15}
                  step={15}
                  style={inp}
                  value={durationMinutes}
                  onChange={(e) =>
                    setDurationMinutes(Number(e.target.value) || 60)
                  }
                />
              </div>
            </div>

            <label style={lab}>Interviewer emails *</label>
            <input
              style={inp}
              required
              placeholder="panel1@company.com, panel2@company.com"
              value={interviewers}
              onChange={(e) => setInterviewers(e.target.value)}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 14,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                style={cancelBtn}
                onClick={async () => {
                  try {
                    const date = datetime.slice(0, 10) || toDateKey(new Date());
                    const intervals = [10, 11, 14, 15, 16].map((hour) => {
                      const start = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`);
                      return { start: start.toISOString(), end: new Date(start.getTime() + durationMinutes * 60000).toISOString() };
                    });
                    const r = await apiFetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, intervals, interviewers }) });
                    const d = await r.json();
                    if (!r.ok) throw new Error(d.error || "Could not check availability.");
                    setSlots((d.slots || []).map((slot: { start: string }) => {
                      const value = new Date(slot.start);
                      return { start: `${toDateKey(value)}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` };
                    }));
                    setSlotNote(d.slots?.length ? d.note || "Pick a suggested time" : "No available suggested times were found.");
                  } catch (error) { setSlots([]); setSlotNote(error instanceof Error ? error.message : "Could not check availability."); }
                }}
              >
                Suggest slots
              </button>
              {slotNote && <span role="status" style={{ fontSize: 12, color: "#666" }}>{slotNote}</span>}
            </div>
            {slots.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    style={slotChip}
                    onClick={() => setDatetime(s.start.slice(0, 16))}
                  >
                    {s.start.replace("T", " ").slice(0, 16)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid #f0ece3",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            style={{
              ...saveBtn,
              minWidth: 140,
              opacity: canSubmit && !busy ? 1 : 0.55,
              cursor: canSubmit && !busy ? "pointer" : "not-allowed",
            }}
            disabled={!canSubmit || busy}
            onClick={schedule}
          >
            {busy ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </section>
      </>}

      <style>{`
        @media (max-width: 800px) {
          .ats-sched-grid, .ats-sched-when {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInterviewTime(datetime: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(datetime));
}

const panel: CSSProperties = {
  background: "#fff",
  border: "1px solid #ebe6da",
  borderRadius: 14,
  padding: 20,
  boxShadow: "0 1px 0 rgba(40,35,20,.03)",
  width: "100%",
  boxSizing: "border-box",
};

const col: CSSProperties = {
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

const mutedBox: CSSProperties = {
  background: "#f3f2ed",
  border: "1px solid #e6e2d6",
  borderRadius: 8,
  padding: 10,
  fontSize: 13,
  color: "#666",
  marginTop: 6,
};

const slotChip: CSSProperties = {
  background: "#faf9f6",
  color: "#333",
  border: "1px solid #e2ddd0",
  borderRadius: 8,
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

const calendarToolbar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const calendarButton: CSSProperties = {
  border: "1px solid #e2ddd0",
  background: "#fff",
  borderRadius: 8,
  width: 34,
  height: 32,
  cursor: "pointer",
  fontSize: 16,
};

const todayButton: CSSProperties = {
  ...calendarButton,
  width: "auto",
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 700,
};

const calendarDateLabel: CSSProperties = {
  margin: "18px 0 10px",
  fontWeight: 700,
  color: "#2d2d28",
};

const calendarEmpty: CSSProperties = {
  border: "1px dashed #ded8ca",
  borderRadius: 8,
  padding: 16,
  color: "#777",
  fontSize: 13,
};

const calendarItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "11px 12px",
  border: "1px solid #ebe6da",
  borderRadius: 9,
  background: "#faf9f6",
};

const calendarTime: CSSProperties = {
  width: 62,
  flexShrink: 0,
  fontWeight: 700,
  color: "#3a6ea5",
};

const statusStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 4,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const candidateStatus: CSSProperties = {
  color: "#555",
};

const feedbackPendingStatus: CSSProperties = {
  color: "#a15c00",
  fontWeight: 700,
};

function interviewStatus(status: Interview["status"]): CSSProperties {
  return {
    color: status === "Cancelled" ? "#a33" : status === "Completed" ? "#2f6f4f" : "#8a5a00",
    fontWeight: 700,
  };
}
