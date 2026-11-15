"use client";
import { useEffect, useState } from "react";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { planDrive, type DriveSlot } from "@/lib/recruitmentDrive";
import type { Candidate, Interview, InterviewFormat, InterviewPlan, OrgSettings, Requisition } from "@/lib/types";
import { DateTimeField } from "./DateTimeField";
import { prettyStatus } from "./ui";

type Booking = DriveSlot & { booked?: boolean; result?: string };
function localDateTime(iso: string) {
  const time = new Date(iso);
  return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const eligible = new Set(["HMApproved", "Screened", "Shortlist", "Interview", "Interview Scheduled", "Selected", "Debrief", "On Hold"]);

export function RecruitmentDrive({ reqs, offices, interviews, calendarEnabled, apiFetch, onBooked, candidateNames }: {
  reqs: Requisition[];
  offices: NonNullable<OrgSettings["officeLocations"]>;
  interviews: Interview[];
  candidateNames: Map<string, string>;
  calendarEnabled: boolean;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onBooked: (interview: Interview) => void;
}) {
  const [reqId, setReqId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [round, setRound] = useState(1);
  const [roster, setRoster] = useState<Record<string, string>>({});
  const [panels, setPanels] = useState([{ emails: "", room: "" }]);
  const [setup, setSetup] = useState({ start: "", end: "", minutes: "30", gap: "10", office: "", phone: "" });
  const [format, setFormat] = useState<InterviewFormat>("in-person");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [driveId, setDriveId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const rounds = getInterviewRounds(plan);
  const office = setup.office === "" ? undefined : offices[Number(setup.office)];
  const location = office && [...new Set([office.name, office.address, office.city].filter(Boolean))].join(", ");
  const name = (id: string) => candidates.find((candidate) => candidate.id === id)?.name || id;

  useEffect(() => {
    if (!reqId) return;
    let active = true;
    async function load(path: string) {
      const response = await apiFetch(path);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load requisition.");
      return data;
    }
    const id = encodeURIComponent(reqId);
    Promise.all([load(`/api/candidates?reqId=${id}`), load(`/api/requisitions/${id}/plan`)])
      .then(([people, config]) => {
        if (!active) return;
        setCandidates((people.candidates as Candidate[]).filter((candidate) => !candidate.archived && eligible.has(candidate.stage)));
        setPlan(config.plan);
        setRound(getInterviewRounds(config.plan)[0]?.order ?? 1);
      })
      .catch((error: Error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reqId, apiFetch]);

  function configuredPanels() {
    return panels.map(({ emails, room }) => ({
      interviewers: [...new Set(emails.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))],
      room: format === "in-person" ? room.trim() : "",
    }));
  }

  function preview() {
    setMessage("");
    setUnplaced([]);
    const start = Date.parse(setup.start), end = Date.parse(setup.end), breakMinutes = Number(setup.gap);
    const people = Object.entries(roster).map(([id, override]) => ({ id, duration: Number(override || setup.minutes) }));
    const configured = configuredPanels();
    if (!reqId || loading || !rounds.some((item) => item.order === round)) return setMessage("Choose an open requisition and round.");
    if (!(start > Date.now() && end > start && end - start <= 86400000)) return setMessage("Choose a future drive window of up to 24 hours.");
    if (!people.length || people.length > 100 || people.some(({ duration }) => !Number.isInteger(duration) || duration < 5 || duration > 240)) return setMessage("Select 1–100 candidates with durations of 5–240 minutes.");
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120) return setMessage("Enter a break of 0–120 minutes.");
    if ((format === "in-person" && !office) || (format === "phone" && !setup.phone.trim()) || (format === "video" && !calendarEnabled)) return setMessage("Complete the details for the selected format.");
    if (configured.some((panel) => !panel.interviewers.length || panel.interviewers.length > 20 || panel.interviewers.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (format === "in-person" && !panel.room))) return setMessage("Enter valid panelist emails and a room for each in-person panel.");
    const prior = new Map<string, Set<number>>();
    for (const item of interviews) {
      if (item.reqId !== reqId || item.status === "Cancelled") continue;
      const booked = prior.get(item.candidateId) || new Set<number>();
      booked.add(item.roundIndex || 1);
      prior.set(item.candidateId, booked);
    }
    const ready = people.filter(({ id }) => rounds.find((item) => !prior.get(id)?.has(item.order))?.order === round);
    const result = planDrive({ start, end, breakMinutes, panels: configured, candidates: ready, existing: interviews, office: location });
    setUnplaced([...people.filter((candidate) => !ready.includes(candidate)).map(({ id }) => id), ...result.unplaced]);
    setBookings(result.slots);
    setDriveId(crypto.randomUUID());
  }

  async function confirm() {
    setMessage("");
    if (bookings.some((slot) => !slot.booked && (Date.parse(slot.datetime) < Date.parse(setup.start) || Date.parse(slot.datetime) + slot.durationMinutes * 60000 > Date.parse(setup.end)))) {
      setMessage("Edited slots must fit inside the drive window.");
      return;
    }
    setBusy(true);
    for (const slot of bookings.filter((item) => !item.booked)) {
      let update: Partial<Booking>;
      try {
        const response = await apiFetch("/api/schedule", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reqId, roundIndex: round, candidateId: slot.candidateId, datetime: slot.datetime,
            durationMinutes: slot.durationMinutes, breakMinutes: Number(setup.gap), driveId,
            interviewers: slot.panel.interviewers.join(","), room: slot.panel.room,
            format, officeName: office?.name, officeCity: office?.city || "", phoneInstructions: setup.phone,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Booking failed.");
        onBooked(data.interview);
        update = { booked: true, result: data.inviteSent ? "Booked · invite sent" : "Booked · no email invite" };
      } catch (error) {
        update = { result: error instanceof Error ? error.message : "Booking failed." };
      }
      setBookings((current) => current.map((item) => item.candidateId === slot.candidateId ? { ...item, ...update } : item));
    }
    setBusy(false);
  }

  const configured = configuredPanels();
  const startMs = Date.parse(setup.start), endMs = Date.parse(setup.end);
  const windowMinutes = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? Math.round((endMs - startMs) / 60000) : 0;
  const perInterview = Number(setup.minutes) + Number(setup.gap);
  const capacity = windowMinutes > 0 && perInterview > 0 ? Math.floor(windowMinutes / perInterview) * panels.length : 0;
  const selectedCount = Object.keys(roster).length;
  const allSelected = candidates.length > 0 && candidates.every((candidate) => Object.prototype.hasOwnProperty.call(roster, candidate.id));
  const shortWhen = (ms: number) => Number.isFinite(ms) ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

  function updateSlot(candidateId: string, patch: Partial<Booking>) {
    setBookings((current) => current.map((item) => item.candidateId === candidateId ? { ...item, ...patch, result: undefined } : item));
  }
  const panelKey = (panel: { interviewers: string[]; room: string }) => `${panel.interviewers.join(",")}|${panel.room}`;
  const slotEnd = (slot: Booking) => Date.parse(slot.datetime) + slot.durationMinutes * 60000;
  function problem(slot: Booking): string {
    if (slot.booked) return "";
    if (!Number.isInteger(slot.durationMinutes) || slot.durationMinutes < 5 || slot.durationMinutes > 240) return "Minutes must be 5–240";
    if (Date.parse(slot.datetime) < startMs || slotEnd(slot) > endMs) return "Outside the drive window";
    const clash = bookings.find((other) => other.candidateId !== slot.candidateId && panelKey(other.panel) === panelKey(slot.panel) && Date.parse(slot.datetime) < slotEnd(other) && Date.parse(other.datetime) < slotEnd(slot));
    return clash ? `Overlaps with ${name(clash.candidateId)}` : "";
  }
  const problems = bookings.filter((slot) => problem(slot));
  const sorted = [...bookings].sort((left, right) => left.datetime.localeCompare(right.datetime));
  const firstStart = sorted.length ? Date.parse(sorted[0].datetime) : NaN;
  const lastEnd = sorted.length ? Math.max(...sorted.map(slotEnd)) : NaN;
  const formats: { id: InterviewFormat; label: string; disabled?: boolean }[] = [{ id: "in-person", label: "In person" }, { id: "phone", label: "Telephonic" }, { id: "video", label: "Video", disabled: !calendarEnabled }];

  function resetSetup() {
    setRoster({}); setPanels([{ emails: "", room: "" }]); setSetup({ start: "", end: "", minutes: "30", gap: "10", office: "", phone: "" }); setMessage(""); setUnplaced([]);
  }

  return (
    <details className="ats-activity-history ats-drive">
      <summary>Recruitment Drive</summary>
      {interviews.some((item) => item.driveId) && <details>
        <summary>Booked drive interviews</summary>
        <ul className="drive-booked">
          {interviews.filter((item) => item.driveId).sort((left, right) => left.datetime.localeCompare(right.datetime)).map((item) => (
            <li key={item.id}>
              <span>{new Date(item.datetime).toLocaleString()} · {candidateNames.get(item.candidateId) || item.candidateId} · {item.roundName || item.stage}</span>
              <span>{item.status}{item.calendarEventId ? " · Calendar invite created" : ""}</span>
            </li>
          ))}
        </ul>
      </details>}

      {bookings.length === 0 ? <div className="drive-page">
        <p className="drive-lead">Book many interviews in one go. Pick the role, the time window and the panels, then preview the timetable before anything is booked.</p>
        <nav className="drive-steps" aria-label="Setup steps">
          {["Role and round", "Time window", "Panels", "Candidates"].map((label, index) => <a key={label} href={`#drive-step-${index + 1}`}><b>{index + 1}</b>{label}</a>)}
        </nav>

        <fieldset disabled={busy} className="drive-set">
          <section className="drive-card" id="drive-step-1">
            <h3><i>1</i>Role and round</h3>
            <p className="drive-hint">Which role are you interviewing for, and which round?</p>
            <div className="drive-grid">
              <label>Requisition<select value={reqId} onChange={(event) => {
                setReqId(event.target.value); setRoster({}); setCandidates([]); setPlan(null); setMessage(""); setLoading(!!event.target.value);
              }}><option value="">Select a requisition</option>{reqs.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label>
              <label>Round<select value={round} onChange={(event) => setRound(Number(event.target.value))}>{rounds.map((item) => <option key={item.order} value={item.order}>{item.order}. {item.name}</option>)}</select></label>
              <div className="drive-field"><span className="drive-label">Format</span>
                <div className="drive-seg" role="group" aria-label="Interview format">{formats.map((item) => <button type="button" key={item.id} className={format === item.id ? "is-on" : ""} aria-pressed={format === item.id} disabled={item.disabled} title={item.disabled ? "Turn on Google Calendar to use video interviews" : undefined} onClick={() => setFormat(item.id)}>{item.label}</button>)}</div>
              </div>
              {format === "in-person" && <label>Office<select value={setup.office} onChange={(event) => setSetup({ ...setup, office: event.target.value })}><option value="">Select an office</option>{offices.map((item, index) => <option key={index} value={index}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>)}</select></label>}
              {format === "phone" && <label>Call instructions<input value={setup.phone} maxLength={300} onChange={(event) => setSetup({ ...setup, phone: event.target.value })} /></label>}
            </div>
          </section>

          <section className="drive-card" id="drive-step-2">
            <h3><i>2</i>Time window</h3>
            <p className="drive-hint">Interviews are placed inside this window, up to 24 hours.</p>
            <div className="drive-grid">
              <div className="drive-field"><span className="drive-label">Starts</span><DateTimeField type="datetime-local" aria-label="Drive starts" value={setup.start} onChange={(event) => setSetup({ ...setup, start: event.target.value })} /></div>
              <div className="drive-field"><span className="drive-label">Ends</span><DateTimeField type="datetime-local" aria-label="Drive ends" value={setup.end} onChange={(event) => setSetup({ ...setup, end: event.target.value })} /></div>
              <label>Interview length (min)<input type="number" min="5" max="240" value={setup.minutes} onChange={(event) => setSetup({ ...setup, minutes: event.target.value })} /></label>
              <label>Break between interviews (min)<input type="number" min="0" max="120" value={setup.gap} onChange={(event) => setSetup({ ...setup, gap: event.target.value })} /></label>
            </div>
            {windowMinutes > 0 && <p className="drive-window">⏱ <b>{Math.floor(windowMinutes / 60)} h {windowMinutes % 60} min</b> window · room for about <b>{capacity}</b> interview{capacity === 1 ? "" : "s"} across {panels.length} panel{panels.length === 1 ? "" : "s"}</p>}
          </section>

          <section className="drive-card" id="drive-step-3">
            <h3><i>3</i>Panels</h3>
            <p className="drive-hint">Each panel interviews one candidate at a time. Add up to 4.</p>
            {panels.map((panel, index) => (
              <div key={index} className="drive-panel">
                <div className="drive-panel-head"><strong>Panel {index + 1}</strong>{panels.length > 1 && <button type="button" className="drive-link" onClick={() => setPanels(panels.filter((_, i) => i !== index))}>Remove</button>}</div>
                <div className="drive-grid drive-grid-2">
                  <div className="drive-field"><span className="drive-label">Interviewer emails</span><EmailChips label={`Interviewer emails for panel ${index + 1}`} value={panel.emails} onChange={(emails) => setPanels(panels.map((item, i) => i === index ? { ...item, emails } : item))} /></div>
                  {format === "in-person" && <label>Room<input value={panel.room} maxLength={100} placeholder="e.g. Meeting Room 2" onChange={(event) => setPanels(panels.map((item, i) => i === index ? { ...item, room: event.target.value } : item))} /></label>}
                </div>
              </div>
            ))}
            <button type="button" className="drive-add" disabled={panels.length >= 4} onClick={() => setPanels([...panels, { emails: "", room: "" }])}>＋ Add panel</button>
          </section>

          <section className="drive-card" id="drive-step-4">
            <h3><i>4</i>Candidates</h3>
            <p className="drive-hint">Select who to schedule. Leave the minutes empty to use the default.</p>
            {loading && <p role="status">Loading candidates…</p>}
            {!reqId && <p className="drive-empty">Choose a requisition in step 1 to see its candidates.</p>}
            {reqId && !loading && !candidates.length && <p className="drive-empty">No eligible candidates loaded for this requisition.</p>}
            {candidates.length > 0 && <>
              <div className="drive-tools"><b>{selectedCount} of {candidates.length} selected</b>{selectedCount > 0 && <button type="button" className="drive-link" onClick={() => setRoster({})}>Clear selection</button>}</div>
              <div className="drive-table-wrap"><table className="drive-table"><thead><tr>
                <th style={{ width: 44 }}><input type="checkbox" aria-label="Select all candidates" checked={allSelected} onChange={(event) => setRoster(event.target.checked ? Object.fromEntries(candidates.map((candidate) => [candidate.id, roster[candidate.id] ?? ""])) : {})} /></th>
                <th>Candidate</th><th>Candidate ID</th><th>Stage</th><th style={{ width: 150 }}>Minutes</th></tr></thead>
                <tbody>{candidates.map((candidate) => {
                  const selected = Object.prototype.hasOwnProperty.call(roster, candidate.id);
                  return <tr key={candidate.id} className={selected ? "is-selected" : ""}>
                    <td><input type="checkbox" aria-label={`Select ${candidate.name}`} checked={selected} onChange={(event) => { const next = { ...roster }; if (event.target.checked) next[candidate.id] = ""; else delete next[candidate.id]; setRoster(next); }} /></td>
                    <td><b>{candidate.name}</b></td><td>{candidate.candidateId || "—"}</td><td><span className="drive-tag">{prettyStatus(candidate.stage)}</span></td>
                    <td>{selected ? <input type="number" min="5" max="240" aria-label={`Interview minutes for ${candidate.name}`} value={roster[candidate.id]} placeholder={setup.minutes} onChange={(event) => setRoster({ ...roster, [candidate.id]: event.target.value })} /> : <span className="drive-muted">—</span>}</td>
                  </tr>;
                })}</tbody></table></div>
            </>}
          </section>
        </fieldset>

        {message && <p role="alert" className="drive-alert">{message}</p>}
        {!!unplaced.length && <p role="status" className="drive-alert">Unscheduled (round unavailable or no free slot): {unplaced.map(name).join(", ")}</p>}
        {!calendarEnabled && <p className="drive-banner"><b>Google Calendar is off.</b> Bookings are saved in the ATS without emailing invitations.</p>}

        <div className="drive-bar">
          <div className="drive-sum"><div>Candidates<b>{selectedCount}</b></div><div>Panels<b>{configured.length}</b></div><div>Window<b>{windowMinutes > 0 ? `${shortWhen(startMs)} – ${shortWhen(endMs)}` : "Not set"}</b></div></div>
          <div className="drive-bar-actions"><button type="button" className="drive-ghost" onClick={resetSetup} disabled={busy}>Reset</button><button type="button" className="drive-primary" onClick={preview} disabled={busy}>Preview timetable →</button></div>
        </div>
      </div> : <div className="drive-page">
        <p className="drive-lead">Check the timetable and change anything that needs it. Nothing is booked until you confirm.</p>
        <div className="drive-stats">
          <div><span>Scheduled</span><b>{bookings.length}</b></div>
          <div><span>Unscheduled</span><b>{unplaced.length}</b></div>
          <div><span>Time used</span><b>{Number.isFinite(firstStart) ? `${shortWhen(firstStart)} – ${shortWhen(lastEnd)}` : "—"}</b></div>
        </div>
        {!!unplaced.length && <p role="status" className="drive-alert">Unscheduled (round unavailable or no free slot): {unplaced.map(name).join(", ")}</p>}
        <div className="drive-table-wrap"><table className="drive-table drive-timetable"><thead><tr><th>Starts</th><th>Candidate</th><th>Panel</th><th style={{ width: 110 }}>Minutes</th><th>Status</th><th style={{ width: 44 }}><span className="drive-sr">Remove</span></th></tr></thead>
          <tbody>{sorted.map((slot) => {
            const issue = problem(slot);
            const panelIndex = Math.max(0, configured.findIndex((panel) => panelKey(panel) === panelKey(slot.panel)));
            return <tr key={slot.candidateId} className={issue ? "has-issue" : ""}>
              <td><DateTimeField type="datetime-local" aria-label={`Start for ${name(slot.candidateId)}`} disabled={busy || slot.booked}
                value={localDateTime(slot.datetime)} onChange={(event) => {
                  const date = new Date(event.target.value);
                  if (!Number.isFinite(date.getTime())) return;
                  updateSlot(slot.candidateId, { datetime: date.toISOString() });
                }} /></td>
              <td><b>{name(slot.candidateId)}</b></td>
              <td>{configured.length > 1 && !slot.booked
                ? <select aria-label={`Panel for ${name(slot.candidateId)}`} value={panelIndex} disabled={busy} onChange={(event) => updateSlot(slot.candidateId, { panel: configured[Number(event.target.value)] })}>{configured.map((panel, index) => <option key={index} value={index}>Panel {index + 1}{panel.room ? ` · ${panel.room}` : ""}</option>)}</select>
                : <span>{slot.panel.room && <>{slot.panel.room} · </>}{slot.panel.interviewers.join(", ")}</span>}</td>
              <td>{slot.booked ? slot.durationMinutes : <input type="number" min="5" max="240" aria-label={`Minutes for ${name(slot.candidateId)}`} disabled={busy} value={slot.durationMinutes} onChange={(event) => updateSlot(slot.candidateId, { durationMinutes: Number(event.target.value) })} />}</td>
              <td><span className={`drive-status${slot.booked ? " is-ok" : issue || (slot.result && !slot.booked) ? " is-bad" : ""}`}>{slot.result || issue || "Ready"}</span></td>
              <td>{!slot.booked && <button type="button" className="drive-x" aria-label={`Remove ${name(slot.candidateId)} from this drive`} title="Remove from this drive" disabled={busy} onClick={() => setBookings((current) => current.filter((item) => item.candidateId !== slot.candidateId))}>×</button>}</td>
            </tr>;
          })}</tbody></table></div>
        {message && <p role="alert" className="drive-alert">{message}</p>}
        {!calendarEnabled && <p className="drive-banner"><b>Google Calendar is off.</b> No invitations will be emailed. Bookings are saved in the ATS only.</p>}
        <div className="drive-bar">
          <span className="drive-note">{problems.length ? `${problems.length} row${problems.length === 1 ? " needs" : "s need"} attention before you can confirm.` : "Everything fits inside the drive window."}</span>
          <div className="drive-bar-actions">
            <button type="button" className="drive-ghost" disabled={busy} onClick={() => { setBookings([]); setUnplaced([]); setMessage(""); }}>← Back to setup</button>
            <button type="button" className="drive-primary" disabled={busy || bookings.every((slot) => slot.booked) || problems.length > 0 || bookings.length === 0} onClick={() => void confirm()}>
              {busy ? "Booking interviews…" : bookings.some((slot) => slot.result && !slot.booked) ? "Retry failed bookings" : calendarEnabled ? "Confirm and send invites" : "Confirm bookings"}
            </button>
          </div>
        </div>
      </div>}
    </details>
  );
}

/** Email box that turns each address into a removable chip. The value stays a comma-separated string. */
function EmailChips({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [draft, setDraft] = useState("");
  const emails = value.split(",").map((email) => email.trim()).filter(Boolean);
  function commit(text: string) {
    const parts = text.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...emails.map((email) => email.toLowerCase()), ...parts])].join(","));
    setDraft("");
  }
  return (
    <div className="drive-chips">
      {emails.map((email) => <span className="drive-chip" key={email}>{email}<button type="button" aria-label={`Remove ${email}`} onClick={() => onChange(emails.filter((item) => item !== email).join(","))}>×</button></span>)}
      <input aria-label={label} value={draft} placeholder={emails.length ? "Add another email" : "Type an email and press Enter"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onPaste={(event) => { const text = event.clipboardData.getData("text"); if (/[\s,;]/.test(text.trim())) { event.preventDefault(); commit(text); } }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === "," || event.key === " " || event.key === ";") && draft.trim()) { event.preventDefault(); commit(draft); }
          else if (event.key === "Backspace" && !draft && emails.length) onChange(emails.slice(0, -1).join(","));
        }} />
    </div>
  );
}
