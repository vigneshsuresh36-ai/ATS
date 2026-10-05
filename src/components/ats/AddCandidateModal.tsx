"use client";

import { useState, type CSSProperties } from "react";
import { cancelBtn, inp, lab, saveBtn } from "./ui";
import { BatchResumeIntake } from "./BatchResumeIntake";

const SOURCES = ["Job Board", "Employee Referral", "Consultant"] as const;

type Source = (typeof SOURCES)[number] | "";

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
}: {
  reqId: string;
  reqTitle: string;
  onClose: () => void;
  onBack: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [currentFixedCtc, setCurrentFixedCtc] = useState("");
  const [currentVariableCtc, setCurrentVariableCtc] = useState("");
  const [presentEsops, setPresentEsops] = useState("");
  const [expectedCtc, setExpectedCtc] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<Source>("");
  const [jobBoard, setJobBoard] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [consultant, setConsultant] = useState("");
  const [remarks, setRemarks] = useState("");
  const [cvBase64, setCvBase64] = useState<string | undefined>();
  const [cvFileName, setCvFileName] = useState<string | undefined>();
  const [selectedResumeFiles, setSelectedResumeFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [parsingResume, setParsingResume] = useState(false);
  const [batchMode, setBatchMode] = useState(false);

  function sourceDetailValue(): string | undefined {
    if (source === "Job Board") return jobBoard || undefined;
    if (source === "Employee Referral") return employeeCode.trim() || undefined;
    if (source === "Consultant") return consultant || undefined;
    return undefined;
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
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not parse resume.");
    } finally {
      setParsingResume(false);
    }
  }

  async function submit() {
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
      alert("Location is required.");
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
    if (!cvBase64 || !cvFileName) {
      alert("Resume upload is required.");
      return;
    }
    if (!source) {
      alert("Select a source.");
      return;
    }
    const detail = sourceDetailValue();
    if (source === "Job Board" && !detail) {
      alert("Select a job board.");
      return;
    }
    if (source === "Employee Referral" && !detail) {
      alert("Enter the employee code.");
      return;
    }
    if (source === "Consultant" && !detail) {
      alert("Select a consultant.");
      return;
    }

    setBusy(true);
    try {
      const r = await apiFetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reqId,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          location: location.trim(),
          currentCtc: currentFixedCtc.trim(),
          currentFixedCtc: currentFixedCtc.trim(),
          currentVariableCtc: currentVariableCtc.trim(),
          presentEsops: presentEsops.trim(),
          expectedCtc: expectedCtc.trim(),
          notice: notice.trim(),
          source,
          sourceDetail: detail,
          remarks: remarks.trim() || undefined,
          cvBase64,
          cvFileName,
          cvMime: undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Failed to save candidate.");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  if (batchMode) {
    return (
      <BatchResumeIntake
        reqId={reqId}
        initialFiles={selectedResumeFiles}
        onClose={onClose}
        onBack={() => setBatchMode(false)}
        apiFetch={apiFetch}
        onSaved={onSaved}
      />
    );
  }

  return (
    <div>
      <a onClick={onBack} style={{ cursor: "pointer", color: "#3a6ea5" }}>
        ← Back to requisition
      </a>
      <h3 style={{ marginTop: 8, marginBottom: 4 }}>Add candidate</h3>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        For {reqTitle} <code style={{ fontSize: 12 }}>{reqId}</code>
      </div>

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
            onChange={(e) => setEmail(e.target.value)}
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
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
            placeholder="10-digit phone number"
          />
        </div>
        <div>
          <label style={lab} htmlFor="candidate-location">Location *</label>
          <input
            style={inp}
            id="candidate-location"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City / preferred location"
          />
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
      </div>

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
          Where this candidate came from — board, referral, or consultant.
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
                  {s}
                </option>
              ))}
            </select>
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
                {JOB_BOARDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          )}

          {source === "Employee Referral" && (
            <div>
              <label style={{ ...lab, marginTop: 0 }}>Employee code</label>
              <input
                style={inp}
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                placeholder="e.g. LT-1042"
              />
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
                {CONSULTANTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <label style={lab}>Remarks / notes</label>
      <textarea
        style={{ ...inp, minHeight: 72 }}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Strengths, constraints, interview notes…"
      />

      <label style={lab}>CV (PDF / DOC) * — select multiple for bulk upload</label>
      <input
        type="file"
        multiple
        required
        accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ ...inp, padding: 8 }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          setSelectedResumeFiles(files);
          if (files.length > 1) {
            setBatchMode(true);
            return;
          }
          const f = files[0];
          if (!f) {
            setCvBase64(undefined);
            setCvFileName(undefined);
            return;
          }
          void (async () => {
            try {
              const base64 = await readAsBase64(f);
              setCvBase64(base64);
              setCvFileName(f.name);
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

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <button type="button" onClick={onClose} style={cancelBtn}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          style={saveBtn}
        >
          {busy ? "Saving…" : "Save candidate"}
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
