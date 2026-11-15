"use client";

import { IndianCityPicker } from "./IndianCityPicker";

import { useEffect, useState, type CSSProperties } from "react";
import type { Candidate, CandidateCustomField } from "@/lib/types";
import { candidateSourceLabel } from "@/lib/candidateSource";
import { cancelBtn, inp, lab, saveBtn } from "./ui";
import { BatchResumeIntake } from "./BatchResumeIntake";

const SOURCES = ["Job Board", "Employee Referral", "Consultant", "Direct / Inbound", "Campus Hiring"] as const;

type Source = (typeof SOURCES)[number] | "Career Page" | "Other" | "Social Media" | "Social CV" | "Talent Pool" | "";

const JOB_BOARDS = [
  "Naukri",
  "Apna",
  "LinkedIn",
  "InstaHyre",
  "Internshala",
  "Others",
] as const;

const CONSULTANTS = [
  "ABC Recruiters",
  "TalentBridge Partners",
  "HireCraft Solutions",
  "PeopleFirst Consulting",
  "NextGen Staffing",
  "Others",
] as const;

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",")[1] : raw);
    };
    reader.readAsDataURL(file);
  });
}

export function AddCandidateModal({
  reqId,
  reqTitle,
  onClose,
  onBack,
  apiFetch,
  onSaved,
  candidate,
  vendorsSpendEnabled = false,
}: {
  reqId: string;
  reqTitle: string;
  onClose: () => void;
  onBack: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onSaved: () => void;
  candidate?: Candidate;
  vendorsSpendEnabled?: boolean;
}) {
  const initialSource: Source = (candidateSourceLabel(candidate?.source) as Source) || "";
  const [name, setName] = useState(candidate?.name || "");
  const [email, setEmail] = useState(candidate?.email || "");
  const [phone, setPhone] = useState(candidate?.phone || "");
  const [location, setLocation] = useState("");
  const [customFields, setCustomFields] = useState<CandidateCustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => Object.fromEntries((candidate?.customFields || []).map((field) => [field.id, field.value])));
  const [customFieldsError, setCustomFieldsError] = useState("");
  const [customFieldsLoading, setCustomFieldsLoading] = useState(true);
  useEffect(() => { let active = true; apiFetch("/api/org").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(); if (active) setCustomFields((data.org.candidateCustomFields || []).filter((field: CandidateCustomField) => field.enabled)); }).catch(() => { if (active) setCustomFieldsError("Could not load candidate fields. Reopen this form to try again."); }).finally(() => { if (active) setCustomFieldsLoading(false); }); return () => { active = false; }; }, [apiFetch]);
  const [currentFixedCtc, setCurrentFixedCtc] = useState(candidate?.currentFixedCtc || candidate?.currentCtc || "");
  const [currentVariableCtc, setCurrentVariableCtc] = useState(candidate?.currentVariableCtc || "");
  const [presentEsops, setPresentEsops] = useState(candidate?.presentEsops || "0");
  const [expectedCtc, setExpectedCtc] = useState(candidate?.expectedCtc || "");
  const [skills, setSkills] = useState((candidate?.skills || []).join(", "));
  const [experienceYears, setExperienceYears] = useState(candidate?.experienceYears === undefined ? "" : String(candidate.experienceYears));
  const [notice, setNotice] = useState(candidate?.notice || "");
  const [source, setSource] = useState<Source>(initialSource);
  const [jobBoard, setJobBoard] = useState(candidate?.source === "Job Board" ? candidate.sourceSubscriptionId || candidate.sourceDetail || "" : "");
  const [employeeCode, setEmployeeCode] = useState(candidate?.source === "Employee Referral" ? candidate.sourceDetail || "" : "");
  const [referralEmployees, setReferralEmployees] = useState<{ code: string; name: string }[]>([]);
  const [employeeLookupError, setEmployeeLookupError] = useState("");
  const [consultant, setConsultant] = useState(candidate?.source === "Consultant" ? candidate.sourceVendorId || candidate.sourceDetail || "" : "");
  const [sourceNotes, setSourceNotes] = useState(candidate?.sourceNotes || "");
  const [managedConsultants, setManagedConsultants] = useState<{ id: string; name: string }[]>([]);
  const [managedSubscriptions, setManagedSubscriptions] = useState<{ id: string; platformName: string }[]>([]);
  const [remarks, setRemarks] = useState(candidate?.remarks || "");
  const [cvBase64, setCvBase64] = useState<string | undefined>();
  const [cvFileName, setCvFileName] = useState<string | undefined>();
  const [cvMime, setCvMime] = useState<string | undefined>();
  const [selectedResumeFiles, setSelectedResumeFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [profileMatches, setProfileMatches] = useState<{ profileId: string; candidateId: string; name: string }[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [parsingResume, setParsingResume] = useState(false);
  const [batchMode, setBatchMode] = useState(false);

  useEffect(() => {
    if (source !== "Employee Referral") return;
    let cancelled = false;
    setEmployeeLookupError("");
    apiFetch("/api/team/referral-employees").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load employee codes.");
      if (!cancelled) setReferralEmployees(data.employees || []);
    }).catch((error) => { if (!cancelled) setEmployeeLookupError(error instanceof Error ? error.message : "Could not load employee codes."); });
    return () => { cancelled = true; };
  }, [apiFetch, source]);

  useEffect(() => {
    if (!vendorsSpendEnabled) return;
    let cancelled = false;
    apiFetch("/api/vendors-spend?resource=catalog")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load managed source options.");
        if (!cancelled) {
          setManagedConsultants(data.consultants || []);
          setManagedSubscriptions(data.subscriptions || []);
        }
      })
      .catch((error) => { if (!cancelled) alert(error instanceof Error ? error.message : "Could not load source options."); });
    return () => { cancelled = true; };
  }, [apiFetch, vendorsSpendEnabled]);

  function sourceDetailValue(): string | undefined {
    if (source === "Job Board") return vendorsSpendEnabled
      ? managedSubscriptions.find((subscription) => subscription.id === jobBoard)?.platformName
      : jobBoard || undefined;
    if (source === "Employee Referral") return employeeCode.trim() || undefined;
    if (source === "Consultant") return vendorsSpendEnabled
      ? managedConsultants.find((item) => item.id === consultant)?.name
      : consultant || undefined;
    if (["Social Media", "Other"].includes(source)) return sourceNotes.trim() || undefined;
    if (source === "Social CV" || source === "Talent Pool") return candidate?.sourceDetail || undefined;
    return undefined;
  }

  async function downloadCurrentResume() {
    if (!candidate) return;
    const response = await apiFetch(`/api/talent-pool/${candidate.id}/cv?reqId=${encodeURIComponent(reqId)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Could not download current resume.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = candidate.cvFileName || "resume.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function parseSingleResume(file: File) {
    setParsingResume(true);
    try {
      const base64 = await readAsBase64(file);
      const response = await apiFetch("/api/candidates/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ fileName: file.name, mime: file.type, base64 }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not parse resume.");

      const resume = data.resumes?.[0];
      if (resume?.name) setName(resume.name);
      if (resume?.email) setEmail(resume.email);
      if (resume?.phone) setPhone(resume.phone.replace(/[^0-9]/g, "").slice(0, 10));
      if (resume?.skills?.length) setSkills(resume.skills.join(", "));
      if (resume?.experienceYears !== undefined) setExperienceYears(String(resume.experienceYears));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not parse resume.");
    } finally {
      setParsingResume(false);
    }
  }

  async function submit() {
    if (customFieldsLoading || customFieldsError) { alert(customFieldsError || "Candidate fields are still loading."); return; }
    const missing = customFields.find((field) => field.required && !customValues[field.id]?.trim());
    if (missing) { alert(`${missing.label} is required.`); return; }
    if (!name.trim()) {
      alert("Name is required.");
      return;
    }
    if (!email.trim()) {
      alert("Email is required.");
      return;
    }
    if (!phone.trim()) {
      alert("Phone is required.");
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      alert("Phone must contain exactly 10 digits.");
      return;
    }
    if (!location.trim()) {
      alert("Choose a city from the location suggestions.");
      return;
    }
    if (experienceYears.trim() === "" || !Number.isFinite(Number(experienceYears)) || Number(experienceYears) < 0 || Number(experienceYears) > 60) {
      alert("Enter experience in years between 0 and 60.");
      return;
    }
    if (!currentFixedCtc.trim()) {
      alert("Present Fixed CTC is required.");
      return;
    }
    if (!currentVariableCtc.trim()) {
      alert("Present Variable CTC is required.");
      return;
    }
    if (!presentEsops.trim()) {
      alert("Present ESOPs is required.");
      return;
    }
    if (!expectedCtc.trim()) {
      alert("Expected CTC is required.");
      return;
    }
    if (![currentFixedCtc, currentVariableCtc, presentEsops, expectedCtc].every((value) => /^\d+$/.test(value.trim()))) {
      alert("CTC and ESOP fields must contain numbers only.");
      return;
    }
    if (!notice.trim()) {
      alert("Notice period is required.");
      return;
    }
    if (!/^\d{1,2}$/.test(notice.trim())) {
      alert("Notice period must be a number up to 2 digits.");
      return;
    }
    if ((!cvBase64 || !cvFileName) && !candidate?.cvPath) {
      alert("Resume upload is required.");
      return;
    }
    if (!source) {
      alert("Select a source.");
      return;
    }
    const detail = sourceDetailValue();
    if (source === "Job Board" && !detail) {
      alert(vendorsSpendEnabled ? "Select a managed job board subscription." : "Select a job board.");
      return;
    }
    if (source === "Employee Referral" && !detail) {
      alert("Enter the employee code.");
      return;
    }
    if (source === "Employee Referral" && !referralEmployees.some((employee) => employee.code.toLowerCase() === detail?.toLowerCase())) {
      alert("Select an active employee code from Teams & Access.");
      return;
    }
    if (source === "Consultant" && !detail) {
      alert(vendorsSpendEnabled ? "Select a managed consultant." : "Select a consultant.");
      return;
    }
    if (source === "Other" && !detail) {
      alert("Describe the recruitment source.");
      return;
    }

    setBusy(true);
    try {
      const r = await apiFetch(candidate ? `/api/candidates/${candidate.id}/forward` : "/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reqId,
          candidateProfileId: selectedProfileId || undefined,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          location: location.trim(),
          currentCtc: currentFixedCtc.trim(),
          currentFixedCtc: currentFixedCtc.trim(),
          currentVariableCtc: currentVariableCtc.trim(),
          presentEsops: presentEsops.trim(),
          expectedCtc: expectedCtc.trim(),
          skills: skills.split(",").map((skill) => skill.trim()).filter(Boolean),
          experienceYears: experienceYears ? Number(experienceYears) : undefined,
          notice: notice.trim(),
          source,
          sourceDetail: detail,
          sourceVendorId: source === "Consultant" && vendorsSpendEnabled ? consultant : undefined,
          sourceSubscriptionId: source === "Job Board" && vendorsSpendEnabled ? jobBoard : undefined,
          sourceNotes: sourceNotes.trim() || undefined,
          remarks: remarks.trim() || undefined,
          customFields: customValues,
          cvBase64,
          cvFileName,
          cvMime,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.code === "CANDIDATE_PROFILE_MATCH" && Array.isArray(d.matches)) {
          setProfileMatches(d.matches);
          setSelectedProfileId("");
          return;
        }
        alert(d.error || "Failed to save candidate.");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (batchMode && !candidate && (customFieldsLoading || customFieldsError)) return <p role="status">{customFieldsError || "Loading candidate fields…"}</p>;
  if (batchMode && !candidate) {
    return (
      <BatchResumeIntake
        reqId={reqId}
        initialFiles={selectedResumeFiles}
        onClose={onClose}
        onBack={() => setBatchMode(false)}
        apiFetch={apiFetch}
        vendorsSpendEnabled={vendorsSpendEnabled}
        managedConsultants={managedConsultants}
        managedSubscriptions={managedSubscriptions}
        customFields={customFields}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div>
      <a onClick={onBack} style={{ cursor: "pointer", color: "#3a6ea5" }}>
        {candidate ? "← Back to Talent Pool" : "← Back to requisition"}
      </a>
      <h3 style={{ marginTop: 8, marginBottom: 4 }}>{candidate ? "Review candidate before forwarding" : "Add candidate"}</h3>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        {candidate ? "Confirm or edit all candidate details for " : "For "}{reqTitle} <code style={{ fontSize: 12 }}>{reqId}</code>
      </div>
      {profileMatches.length > 0 && !candidate && <fieldset style={{ margin: "0 0 14px", padding: 12, border: "1px solid #d5c6a5", borderRadius: 6 }}>
        <legend style={{ padding: "0 5px", fontSize: 12, fontWeight: 700 }}>Possible existing candidate</legend>
        <p style={{ margin: "0 0 8px", color: "#5c5b55", fontSize: 12 }}>Review the matching profile and select it to add a separate application without creating another candidate profile.</p>
        {profileMatches.map((profile) => <label key={profile.profileId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12, cursor: "pointer" }}>
          <input type="radio" name="candidate-profile-match" checked={selectedProfileId === profile.profileId} onChange={() => setSelectedProfileId(profile.profileId)} />
          <span><strong>{profile.name}</strong> <span style={{ color: "#6b6b67" }}>{profile.candidateId}</span></span>
        </label>)}
        {!selectedProfileId && <small style={{ color: "#8a5b16" }}>Choose a profile before submitting.</small>}
      </fieldset>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <div>
          <label style={lab}>Name *</label>
          <input
            style={inp}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
          />
        </div>
        <div>
          <label style={lab}>Email *</label>
          <input
            style={inp}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setSelectedProfileId(""); setProfileMatches([]); }}
            placeholder="candidate@email.com"
          />
        </div>
        <div>
          <label style={lab} htmlFor="candidate-phone">Phone *</label>
          <input
            style={inp}
            id="candidate-phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            required
            value={phone}
            onChange={(e) => { setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10)); setSelectedProfileId(""); setProfileMatches([]); }}
            placeholder="10-digit phone number"
          />
        </div>
        <div>
          <label style={lab} htmlFor="candidate-location">Location *</label>
          <IndianCityPicker id="candidate-location" inputStyle={inp} value={location} onChange={setLocation} initialQuery={candidate?.location} />
        </div>
        <div>
            <label style={lab}>Present Fixed CTC *</label>
          <input
            style={inp}
              required
            inputMode="numeric"
            value={currentFixedCtc}
            onChange={(e) => setCurrentFixedCtc(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 1800000"
          />
        </div>
        <div>
            <label style={lab}>Present Variable CTC *</label>
          <input
            style={inp}
              required
            inputMode="numeric"
            value={currentVariableCtc}
            onChange={(e) => setCurrentVariableCtc(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 200000"
          />
        </div>
        <div>
          <label style={lab}>Present ESOPs *</label>
          <input
            style={inp}
            required
            inputMode="numeric"
            pattern="[0-9]*"
            value={presentEsops}
            onChange={(e) => setPresentEsops(e.target.value.replace(/\D/g, ""))}
            placeholder="Numbers only"
          />
        </div>
        <div>
          <label style={lab}>Expected CTC *</label>
          <input
            style={inp}
            required
            inputMode="numeric"
            value={expectedCtc}
            onChange={(e) => setExpectedCtc(e.target.value.replace(/\D/g, ""))}
            placeholder="e.g. 2400000"
          />
        </div>
        <div>
          <label style={lab}>Experience (years) *</label>
          <input style={inp} required type="number" min="0" max="60" value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} placeholder="e.g. 5" />
        </div>
      </div>

      <label style={lab}>Skills (optional)</label>
      <input style={inp} value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Optional, comma-separated skills" />

      <label style={lab}>Notice period *</label>
      <input
        style={inp}
        required
        type="text"
        inputMode="numeric"
        pattern="[0-9]{1,2}"
        maxLength={2}
        value={notice}
        onChange={(e) => setNotice(e.target.value.replace(/\D/g, "").slice(0, 2))}
        placeholder="e.g. 30"
      />

      <div style={sourcePanel}>
        <div style={sourcePanelTitle}>Source *</div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#7a7a72" }}>
          Where this candidate came from — board, referral, consultant, or direct inbound contact.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <div>
            <label style={{ ...lab, marginTop: 0 }}>Channel</label>
            <select
              style={inp}
              value={source}
              onChange={(e) => {
                const next = e.target.value as Source;
                setSource(next);
                setJobBoard("");
                setEmployeeCode("");
                setConsultant("");
              }}
            >
              <option value="">Select source…</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s === "Consultant" ? "Recruitment Consultant" : s === "Direct / Inbound" ? "Direct Application" : s}
                </option>
              ))}
              {candidate?.source === "Social CV" && <option value="Social CV">Social CV</option>}
              {source === "Social Media" && <option value="Social Media" disabled>Social Media (previously recorded)</option>}
              {candidate?.source === "Talent Pool" && <option value="Talent Pool">Talent Pool</option>}
              {source === "Career Page" && <option value="Career Page" disabled>Career Page (previously recorded)</option>}
              {source === "Other" && <option value="Other" disabled>Other (previously recorded)</option>}
            </select>
            {source === "Direct / Inbound" && <small style={{ display: "block", marginTop: 6, color: "#666" }}>For direct applications, such as those received through your careers page, by email, or as walk-ins.</small>}
          </div>

          {source === "Job Board" && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Job board</label>
              <select
                style={inp}
                value={jobBoard}
                onChange={(e) => setJobBoard(e.target.value)}
              >
                <option value="">Select board…</option>
                {vendorsSpendEnabled
                  ? managedSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.platformName}</option>)
                  : JOB_BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          )}

          {source === "Employee Referral" && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Employee code</label>
              <input
                style={inp}
                className="ats-employee-code-input"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="e.g. LT-1042"
              />
              {employeeCode.trim() && !referralEmployees.some((employee) => employee.code.toLowerCase() === employeeCode.trim().toLowerCase()) && (
                <div aria-label="Matching employees">
                  {referralEmployees.filter((employee) => `${employee.code} ${employee.name}`.toLowerCase().includes(employeeCode.trim().toLowerCase())).slice(0, 3).map((employee) => (
                    <button className="ats-employee-suggestion" key={employee.code} type="button" style={{ display: "block", width: "100%", textAlign: "left", padding: "8px" }} onClick={() => setEmployeeCode(employee.code)}>{employee.code} · {employee.name}</button>
                  ))}
                </div>
              )}
              <small style={{ display: "block", marginTop: 6, color: employeeLookupError ? "#a33" : "#666" }}>{employeeLookupError || "Choose an active employee code from Teams & Access."}</small>
            </div>
          )}

          {source === "Consultant" && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Consultant</label>
              <select
                style={inp}
                value={consultant}
                onChange={(e) => setConsultant(e.target.value)}
              >
                <option value="">Select consultant…</option>
                {vendorsSpendEnabled
                  ? managedConsultants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
                  : CONSULTANTS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {source === "Social CV" && candidate?.sourceDetail && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Social link recruiter</label>
              <input style={inp} value={candidate.sourceDetail} readOnly />
            </div>
          )}
          {source === "Talent Pool" && candidate?.sourceDetail && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Original source</label>
              <input style={inp} value={candidate.sourceDetail} readOnly />
            </div>
          )}
          {source === "Social Media" && <div><label style={{ ...lab, marginTop: 0 }}>Platform (optional)</label><input style={inp} value={sourceNotes} onChange={(event) => setSourceNotes(event.target.value)} placeholder="e.g. LinkedIn, Instagram" /></div>}
          {source === "Other" && <div><label style={{ ...lab, marginTop: 0 }}>Source description *</label><input style={inp} value={sourceNotes} onChange={(event) => setSourceNotes(event.target.value)} placeholder="Describe the source" /></div>}
        </div>
      </div>

      {customFields.map((field) => <div key={field.id}><label style={lab} htmlFor={`custom-${field.id}`}>{field.label}{field.required ? " *" : " (optional)"}</label><input id={`custom-${field.id}`} style={inp} maxLength={500} required={field.required} value={customValues[field.id] || ""} onChange={(event) => setCustomValues((values) => ({ ...values, [field.id]: event.target.value }))} /></div>)}
      {customFieldsError && <p role="alert">{customFieldsError}</p>}
      <label style={lab}>Remarks / notes</label>
      <textarea
        style={{ ...inp, minHeight: 72 }}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Strengths, constraints, interview notes…"
      />

      <label style={lab}>{candidate ? "Replace CV (optional)" : "CV (PDF / DOC) * — select multiple for bulk upload"}</label>
      <input
        type="file"
        multiple={!candidate}
        required={!candidate}
        accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ ...inp, padding: 8 }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          setSelectedResumeFiles(files);
          if (files.length > 1) {
            if (candidate) return;
            setBatchMode(true);
            return;
          }
          const f = files[0];
          if (!f) {
            setCvBase64(undefined);
            setCvFileName(undefined);
            setCvMime(undefined);
            return;
          }
          void (async () => {
            try {
              const base64 = await readAsBase64(f);
              setCvBase64(base64);
              setCvFileName(f.name);
              setCvMime(f.type || undefined);
              await parseSingleResume(f);
            } catch (error) {
              alert(error instanceof Error ? error.message : "Could not read resume.");
            }
          })();
        }}
      />
      {parsingResume && (
        <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
          Extracting name, email, and phone…
        </div>
      )}
      {selectedResumeFiles.length > 1 && (
        <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
          {selectedResumeFiles.length} resumes selected. They will be reviewed individually before saving.
        </div>
      )}
      {cvFileName && selectedResumeFiles.length <= 1 && (
        <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
          Attached: {cvFileName}
        </div>
      )}
      {candidate?.cvFileName && !cvFileName && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12, color: "#555" }}>
          <span>Current resume: {candidate.cvFileName}</span>
          <button type="button" className="ats-link-btn" onClick={() => void downloadCurrentResume()}>Download</button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <button type="button" onClick={onClose} style={{ ...cancelBtn, width: candidate ? 160 : 110 }}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          style={{ ...saveBtn, width: candidate ? 160 : 110 }}
        >
          {busy ? (candidate ? "Forwarding…" : "Submitting…") : (candidate ? "Confirm and forward" : "Submit")}
        </button>
      </div>
    </div>
  );
}

const sourcePanel: CSSProperties = {
  marginTop: 14,
  padding: 14,
  background: "#faf9f6",
  border: "1px solid #ebe6da",
  borderRadius: 12,
};

const sourcePanelTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#2c2c28",
  marginBottom: 2,
};
