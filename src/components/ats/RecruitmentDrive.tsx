"use client";
import { useEffect, useState } from "react";
import { getInterviewRounds } from "@/lib/interviewPlan";
import { planDrive, type DriveSlot } from "@/lib/recruitmentDrive";
import type { Candidate, Interview, InterviewFormat, InterviewPlan, OrgSettings, Requisition } from "@/lib/types";

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

  function preview() {
    setMessage("");
    setUnplaced([]);
    const start = Date.parse(setup.start), end = Date.parse(setup.end), breakMinutes = Number(setup.gap);
    const people = Object.entries(roster).map(([id, override]) => ({ id, duration: Number(override || setup.minutes) }));
    const configured = panels.map(({ emails, room }) => ({
      interviewers: [...new Set(emails.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))],
      room: format === "in-person" ? room.trim() : "",
    }));
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

  function field(key: "start" | "end" | "minutes" | "gap" | "phone", label: string, type = "text") {
    return <label>{label}<input type={type} value={setup[key]} maxLength={key === "phone" ? 300 : undefined} onChange={(event) => setSetup({ ...setup, [key]: event.target.value })} /></label>;
  }

  return (
    <details className="ats-activity-history ats-drive">
      <summary>Recruitment Drive</summary>
      {interviews.some((item) => item.driveId) && <details>
        <summary>Booked drive interviews</summary>
        <ul className="ats-drive-roster">
          {interviews.filter((item) => item.driveId).sort((left, right) => left.datetime.localeCompare(right.datetime)).map((item) => (
            <li key={item.id}>
              <span>{new Date(item.datetime).toLocaleString()} · {candidateNames.get(item.candidateId) || item.candidateId} · {item.roundName || item.stage}</span>
              <span>{item.status}{item.calendarEventId ? " · Calendar invite created" : ""}</span>
            </li>
          ))}
        </ul>
      </details>}
      <fieldset disabled={busy || bookings.length > 0}>
        <legend>Drive setup</legend>
        <div className="ats-drive-fields">
          <label>Requisition<select value={reqId} onChange={(event) => {
            setReqId(event.target.value); setRoster({}); setCandidates([]); setPlan(null); setMessage(""); setLoading(!!event.target.value);
          }}><option value="">Select a requisition</option>{reqs.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label>
          <label>Round<select value={round} onChange={(event) => setRound(Number(event.target.value))}>{rounds.map((item) => <option key={item.order} value={item.order}>{item.order}. {item.name}</option>)}</select></label>
          <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as InterviewFormat)}>
            <option value="in-person">In person</option><option value="phone">Telephonic</option><option value="video" disabled={!calendarEnabled}>Video (Google Meet)</option>
          </select></label>
          {format === "in-person" && <label>Office<select value={setup.office} onChange={(event) => setSetup({ ...setup, office: event.target.value })}><option value="">Select an office</option>{offices.map((item, index) => <option key={index} value={index}>{item.name}{item.city ? ` · ${item.city}` : ""}</option>)}</select></label>}
          {format === "phone" && field("phone", "Call instructions")}
          {field("start", "Starts", "datetime-local")}{field("end", "Ends", "datetime-local")}
          {field("minutes", "Default interview duration (min)", "number")}{field("gap", "Panel break (min)", "number")}
        </div>
        <h4>Panels</h4>
        {panels.map((panel, index) => (
          <div key={index} className="ats-drive-fields">
            <label>Panel {index + 1} emails<input value={panel.emails} placeholder="Separate emails with commas" onChange={(event) => setPanels(panels.map((item, i) => i === index ? { ...item, emails: event.target.value } : item))} /></label>
            {format === "in-person" && <label>Room<input value={panel.room} maxLength={100} onChange={(event) => setPanels(panels.map((item, i) => i === index ? { ...item, room: event.target.value } : item))} /></label>}
            {panels.length > 1 && <button type="button" className="ats-pipeline-action" onClick={() => setPanels(panels.filter((_, i) => i !== index))}>Remove panel {index + 1}</button>}
          </div>
        ))}
        <button type="button" className="ats-pipeline-action" disabled={panels.length >= 4} onClick={() => setPanels([...panels, { emails: "", room: "" }])}>Add panel</button>
        <h4>Candidates</h4>
        {loading && <p role="status">Loading candidates…</p>}
        {reqId && !loading && !candidates.length && <p>No eligible candidates loaded for this requisition.</p>}
        <ul className="ats-drive-roster">
          {candidates.map((candidate) => {
            const selected = Object.prototype.hasOwnProperty.call(roster, candidate.id);
            return <li key={candidate.id}>
              <label><input type="checkbox" checked={selected} onChange={(event) => {
                const next = { ...roster };
                if (event.target.checked) next[candidate.id] = ""; else delete next[candidate.id];
                setRoster(next);
              }} /> {candidate.name}{candidate.candidateId ? ` · ${candidate.candidateId}` : ""}</label>
              {selected && <label>Minutes<input type="number" min="5" max="240" aria-label={`Interview minutes for ${candidate.name}`} value={roster[candidate.id]} placeholder={setup.minutes} onChange={(event) => setRoster({ ...roster, [candidate.id]: event.target.value })} /></label>}
            </li>;
          })}
        </ul>
        <button type="button" className="ats-primary-button" onClick={preview}>Preview timetable</button>
      </fieldset>
      {message && <p role="alert">{message}</p>}
      {!!unplaced.length && <p role="status">Unscheduled (round unavailable or no free slot): {unplaced.map(name).join(", ")}</p>}
      {!!bookings.length && <>
        <h4>Timetable</h4>
        <div className="ats-drive-table">
          <table><thead><tr><th>Starts</th><th>Candidate</th><th>Panel</th><th>Minutes</th><th>Booking</th></tr></thead>
            <tbody>{bookings.map((slot) => <tr key={slot.candidateId}>
              <td><input type="datetime-local" aria-label={`Start for ${name(slot.candidateId)}`} disabled={busy || slot.booked}
                value={localDateTime(slot.datetime)} onChange={(event) => {
                  const date = new Date(event.target.value);
                  if (!Number.isFinite(date.getTime())) return;
                  setBookings((current) => current.map((item) => item.candidateId === slot.candidateId ? { ...item, datetime: date.toISOString(), result: undefined } : item));
                }} /></td><td>{name(slot.candidateId)}</td>
              <td>{slot.panel.room && <>{slot.panel.room} · </>}{slot.panel.interviewers.join(", ")}</td>
              <td>{slot.durationMinutes}</td><td>{slot.result || "Ready"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="ats-drive-actions">
          <button type="button" className="ats-pipeline-action" disabled={busy} onClick={() => { setBookings([]); setUnplaced([]); }}>Back to setup</button>
          <button type="button" className="ats-primary-button" disabled={busy || bookings.every((slot) => slot.booked)} onClick={() => void confirm()}>
            {busy ? "Booking interviews…" : bookings.some((slot) => slot.result && !slot.booked) ? "Retry failed bookings" : calendarEnabled ? "Confirm and send invites" : "Confirm bookings"}
          </button>
        </div>
      </>}
      {!calendarEnabled && <p>Google Calendar is off. Bookings are saved in the ATS without emailing invitations.</p>}
    </details>
  );
}
