"use client";

import { IndianCityPicker } from "./IndianCityPicker";

import { useCallback, useEffect, useState } from "react";
import { cancelBtn, inp, lab, saveBtn } from "./ui";
import type { CandidateCustomField } from "@/lib/types";

const SOURCES = ["Job Board", "Employee Referral", "Consultant", "Direct / Inbound", "Career Page", "Campus Hiring", "Other"] as const;
type Source = (typeof SOURCES)[number] | "";
const JOB_BOARDS = ["Naukri", "Apna", "LinkedIn", "InstaHyre", "Internshala", "Others"];
const CONSULTANTS = [
  "ABC Recruiters",
  "TalentBridge Partners",
  "HireCraft Solutions",
  "PeopleFirst Consulting",
  "NextGen Staffing",
  "Others",
];

type ResumeDraft = {
  customValues?: Record<string, string>;
  possibleDuplicates?: { id: string; name: string }[];
  extractionMethod?: string;
  extractionWarning?: string;
  fileName: string;
  mime: string;
  base64: string;
  resumeText: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  suggestedLocation?: string;
  currentFixedCtc: string;
  currentVariableCtc: string;
  presentEsops: string;
  expectedCtc: string;
  skills: string[];
  experienceYears?: number;
  notice: string;
  source: Source;
  sourceDetail: string;
  sourceVendorId: string;
  sourceSubscriptionId: string;
  sourceNotes: string;
  remarks: string;
};

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

export function BatchResumeIntake({
  reqId,
  initialFiles,
  onClose,
  onBack,
  apiFetch,
  onSaved,
  vendorsSpendEnabled = false,
  managedConsultants = [],
  managedSubscriptions = [],
  customFields = [],
}: {
  reqId: string;
  initialFiles?: File[];
  onClose: () => void;
  onBack: () => void;
  apiFetch: (p: string, i?: RequestInit) => Promise<Response>;
  onSaved: () => void;
  vendorsSpendEnabled?: boolean;
  managedConsultants?: { id: string; name: string }[];
  managedSubscriptions?: { id: string; platformName: string }[];
  customFields?: CandidateCustomField[];
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>(initialFiles || []);
  const [drafts, setDrafts] = useState<ResumeDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const parseFiles = useCallback(async (filesToParse: File[]) => {
    if (!filesToParse.length) {
      setMessage("Choose one or more PDF, DOC, DOCX, or text resumes first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const files = await Promise.all(
        filesToParse.map(async (file) => ({
          fileName: file.name,
          mime: file.type,
          base64: await readAsBase64(file),
        }))
      );
      const response = await apiFetch("/api/candidates/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not parse resumes.");
      setDrafts(
        (data.resumes || []).map((resume: Omit<ResumeDraft, "base64" | "mime">, index: number) => {
          const original = files[index];
          return {
            ...resume,
            base64: original?.base64 || "",
            mime: original?.mime || "application/octet-stream",
            name: resume.name || "",
            email: resume.email || "",
            phone: (resume.phone || "").replace(/[^0-9]/g, "").slice(0, 10),
            location: "",
            suggestedLocation: resume.location,
            currentFixedCtc: "",
            currentVariableCtc: "",
            presentEsops: "",
            expectedCtc: "",
            skills: resume.skills || [],
            experienceYears: resume.experienceYears,
            notice: resume.notice || "",
            source: "",
            sourceDetail: "",
            sourceVendorId: "",
            sourceSubscriptionId: "",
            sourceNotes: "",
            remarks: "",
          };
        })
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse resumes.");
    } finally {
      setBusy(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (initialFiles?.length) {
      void parseFiles(initialFiles);
    }
  }, [initialFiles, parseFiles]);

  function updateDraft(index: number, patch: Partial<ResumeDraft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  function sourceDetailLabel(source: Source) {
    if (source === "Job Board") return "Select job board *";
    if (source === "Employee Referral") return "Employee code *";
    if (source === "Consultant") return "Select consultant *";
    return "Source detail";
  }

  async function saveAll() {
    const missingCustom = drafts.find((draft) => customFields.some((field) => field.required && !draft.customValues?.[field.id]?.trim()));
    if (missingCustom) { setMessage(`Complete the required custom fields for ${missingCustom.name || missingCustom.fileName}.`); return; }
    if (!drafts.length) {
      setMessage("Parse the selected resumes before saving.");
      return;
    }
    const incompleteDraft = drafts.find(
      (draft) =>
        !draft.name.trim() ||
        !draft.email.trim() ||
        !draft.phone.trim() ||
        !draft.location.trim() ||
        !draft.currentFixedCtc.trim() ||
        !draft.currentVariableCtc.trim() ||
        !draft.presentEsops.trim() ||
        !draft.expectedCtc.trim() ||
        !draft.notice.trim() ||
        !draft.base64
    );
    if (incompleteDraft) {
      setMessage(`Complete all required details for ${incompleteDraft.name || incompleteDraft.fileName}.`);
      return;
    }
    const invalidPhone = drafts.find((draft) => !/^\d{10}$/.test(draft.phone));
    if (invalidPhone) {
      setMessage(`Phone for ${invalidPhone.name || invalidPhone.fileName} must contain exactly 10 digits.`);
      return;
    }
    const invalidCtc = drafts.find(
      (draft) =>
        !/^\d+$/.test(draft.currentFixedCtc.trim()) ||
        !/^\d+$/.test(draft.currentVariableCtc.trim()) ||
        !/^\d+$/.test(draft.presentEsops.trim()) ||
        !/^\d+$/.test(draft.expectedCtc.trim())
    );
    if (invalidCtc) {
      setMessage(`CTC and ESOP fields for ${invalidCtc.name || invalidCtc.fileName} must contain numbers only.`);
      return;
    }
    const invalidNotice = drafts.find((draft) => !/^\d{1,2}$/.test(draft.notice.trim()));
    if (invalidNotice) {
      setMessage(`Notice period for ${invalidNotice.name || invalidNotice.fileName} must be a number up to 2 digits.`);
      return;
    }
    const incompleteRecruiterDetails = drafts.find((draft) => !draft.source ||
      (draft.source === "Job Board" && (vendorsSpendEnabled ? !draft.sourceSubscriptionId : !draft.sourceDetail.trim())) ||
      (draft.source === "Consultant" && (vendorsSpendEnabled ? !draft.sourceVendorId : !draft.sourceDetail.trim())) ||
      (draft.source === "Employee Referral" && !draft.sourceDetail.trim()) ||
      (draft.source === "Other" && !draft.sourceNotes.trim()));
    if (incompleteRecruiterDetails) {
      setMessage(`Select source details for ${incompleteRecruiterDetails.name || incompleteRecruiterDetails.fileName}.`);
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      for (const draft of drafts) {
        const response = await apiFetch("/api/candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reqId,
            name: draft.name.trim(),
            email: draft.email.trim(),
            phone: draft.phone.trim() || undefined,
            location: draft.location.trim() || undefined,
            currentCtc: draft.currentFixedCtc.trim(),
            currentFixedCtc: draft.currentFixedCtc.trim(),
            currentVariableCtc: draft.currentVariableCtc.trim(),
            presentEsops: draft.presentEsops.trim(),
            expectedCtc: draft.expectedCtc.trim() || undefined,
            skills: draft.skills,
            experienceYears: draft.experienceYears,
            notice: draft.notice.trim(),
            source: draft.source,
            sourceDetail: draft.source === "Consultant" && vendorsSpendEnabled
              ? managedConsultants.find((item) => item.id === draft.sourceVendorId)?.name
              : draft.source === "Job Board" && vendorsSpendEnabled
                ? managedSubscriptions.find((item) => item.id === draft.sourceSubscriptionId)?.platformName
                : draft.sourceDetail.trim(),
            sourceVendorId: vendorsSpendEnabled ? draft.sourceVendorId || undefined : undefined,
            sourceSubscriptionId: vendorsSpendEnabled ? draft.sourceSubscriptionId || undefined : undefined,
            sourceNotes: draft.sourceNotes.trim() || undefined,
            remarks: draft.remarks.trim() || undefined,
            customFields: draft.customValues || {},
            cvBase64: draft.base64,
            cvFileName: draft.fileName,
            cvMime: draft.mime,
            resumeText: draft.resumeText.trim() || undefined,
            consentCaptured: true,
            extractedName: draft.name.trim(),
            extractedEmail: draft.email.trim(),
            extractedPhone: draft.phone.trim() || undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Could not save ${draft.fileName}.`);
      }
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save candidates.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <a onClick={onBack} style={{ cursor: "pointer", color: "#3a6ea5" }}>← Back to requisition</a>
      <h3 style={{ marginTop: 8, marginBottom: 4 }}>Upload multiple resumes</h3>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        Select up to 50 resumes. The system will extract name, email, and phone for your review before anything is saved.
      </p>

      <label style={lab}>Resume files (PDF / DOC) *</label>
      <input
        type="file"
        required
        multiple
        accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
        style={{ ...inp, padding: 8 }}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          setSelectedFiles(files);
          void parseFiles(files);
        }}
      />
      {selectedFiles.length > 0 && (
        <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
          {selectedFiles.length} resume{selectedFiles.length === 1 ? "" : "s"} selected
        </div>
      )}
      {busy && !drafts.length && (
        <div style={{ fontSize: 13, color: "#555", marginTop: 10 }}>
          Reading resumes…
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <h4 style={{ margin: "20px 0 8px" }}>Review extracted details</h4>
          <div style={{ display: "grid", gap: 10 }}>
            {drafts.map((draft, index) => (
              <div key={`${draft.fileName}-${index}`} style={draftCard}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{draft.fileName}</div>
                <p className="premium-muted">{draft.extractionMethod || "Standard extraction"} · Verify details before saving.</p>
                {draft.extractionWarning && <p className="premium-duplicate-warning">{draft.extractionWarning}</p>}
                {Boolean(draft.possibleDuplicates?.length) && <p className="premium-duplicate-warning" role="status">Possible existing profile: {draft.possibleDuplicates!.map((c) => `${c.name} (${c.id})`).join(", ")}. Check the candidate record before creating another application.</p>}
                <div style={fieldGrid}>
                  <input style={inp} required value={draft.name} onChange={(e) => updateDraft(index, { name: e.target.value })} placeholder="Name *" />
                  <input style={inp} required type="email" value={draft.email} onChange={(e) => updateDraft(index, { email: e.target.value })} placeholder="Email *" />
                  <input style={inp} type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} required value={draft.phone} onChange={(e) => updateDraft(index, { phone: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) })} placeholder="10-digit phone *" />
                  <IndianCityPicker label="Location" inputStyle={inp} value={draft.location} initialQuery={draft.suggestedLocation} onChange={(location) => updateDraft(index, { location })} />
                </div>
                <div style={{ ...fieldGrid, marginTop: 8 }}>
                  <input style={inp} required inputMode="numeric" value={draft.currentFixedCtc} onChange={(e) => updateDraft(index, { currentFixedCtc: e.target.value.replace(/\D/g, "") })} placeholder="Fixed CTC *" />
                  <input style={inp} required inputMode="numeric" value={draft.currentVariableCtc} onChange={(e) => updateDraft(index, { currentVariableCtc: e.target.value.replace(/\D/g, "") })} placeholder="Variable CTC *" />
                </div>
                <input style={{ ...inp, marginTop: 8 }} required inputMode="numeric" pattern="[0-9]*" value={draft.presentEsops} onChange={(e) => updateDraft(index, { presentEsops: e.target.value.replace(/\D/g, "") })} placeholder="Present ESOPs * (numbers only)" />
                <input style={{ ...inp, marginTop: 8 }} required inputMode="numeric" value={draft.expectedCtc} onChange={(e) => updateDraft(index, { expectedCtc: e.target.value.replace(/\D/g, "") })} placeholder="Expected CTC *" />
                <div style={{ ...fieldGrid, marginTop: 8 }}>
                  <input style={inp} type="number" min="0" max="60" value={draft.experienceYears ?? ""} onChange={(e) => updateDraft(index, { experienceYears: e.target.value ? Number(e.target.value) : undefined })} placeholder="Experience (years)" />
                  <input style={inp} value={draft.skills.join(", ")} onChange={(e) => updateDraft(index, { skills: e.target.value.split(",").map((skill) => skill.trim()).filter(Boolean) })} placeholder="Skills, comma-separated" />
                </div>
                <input style={{ ...inp, marginTop: 8 }} required type="text" inputMode="numeric" pattern="[0-9]{1,2}" maxLength={2} value={draft.notice} onChange={(e) => updateDraft(index, { notice: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="Notice period * (0-99)" />
                <div style={{ ...fieldGrid, marginTop: 8 }}>
                  <select
                    style={inp}
                    value={draft.source}
                    onChange={(e) => updateDraft(index, { source: e.target.value as Source, sourceDetail: "" })}
                  >
                    <option value="">Select source *</option>
                    {SOURCES.map((item) => <option key={item} value={item}>{item === "Consultant" ? "Recruitment Consultant" : item === "Direct / Inbound" ? "Direct Application" : item}</option>)}
                  </select>
                  {draft.source === "Job Board" && (
                    <select style={inp} value={vendorsSpendEnabled ? draft.sourceSubscriptionId : draft.sourceDetail} onChange={(e) => updateDraft(index, vendorsSpendEnabled ? { sourceSubscriptionId: e.target.value } : { sourceDetail: e.target.value })}>
                      <option value="">{sourceDetailLabel(draft.source)}</option>
                      {vendorsSpendEnabled
                        ? managedSubscriptions.map((item) => <option key={item.id} value={item.id}>{item.platformName}</option>)
                        : JOB_BOARDS.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  )}
                  {draft.source === "Employee Referral" && (
                    <input style={inp} value={draft.sourceDetail} onChange={(e) => updateDraft(index, { sourceDetail: e.target.value })} placeholder={sourceDetailLabel(draft.source)} />
                  )}
                  {draft.source === "Consultant" && (
                    <select style={inp} value={vendorsSpendEnabled ? draft.sourceVendorId : draft.sourceDetail} onChange={(e) => updateDraft(index, vendorsSpendEnabled ? { sourceVendorId: e.target.value } : { sourceDetail: e.target.value })}>
                      <option value="">{sourceDetailLabel(draft.source)}</option>
                      {vendorsSpendEnabled
                        ? managedConsultants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
                        : CONSULTANTS.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  )}
                  {draft.source === "Other" && <input style={inp} value={draft.sourceNotes} onChange={(e) => updateDraft(index, { sourceNotes: e.target.value })} placeholder="Source description *" />}
                </div>
                {customFields.map((field) => <label key={field.id} style={lab}>{field.label}{field.required ? " *" : " (optional)"}<input style={inp} maxLength={500} value={draft.customValues?.[field.id] || ""} onChange={(e) => updateDraft(index, { customValues: { ...draft.customValues, [field.id]: e.target.value } })} /></label>)}
                <textarea style={{ ...inp, minHeight: 50, marginTop: 8 }} value={draft.remarks} onChange={(e) => updateDraft(index, { remarks: e.target.value })} placeholder="Recruiter remarks / notes" />
              </div>
            ))}
          </div>

        </>
      )}

      {message && <div style={{ color: "#a33", fontSize: 13, marginTop: 10 }}>{message}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button type="button" onClick={onClose} style={cancelBtn}>Cancel</button>
        {drafts.length > 0 && <button type="button" disabled={busy} onClick={saveAll} style={saveBtn}>{busy ? "Saving…" : `Confirm and save ${drafts.length}`}</button>}
      </div>
    </div>
  );
}

const fieldGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } as const;
const draftCard = { padding: 10, border: "1px solid #ebe6da", borderRadius: 8, background: "#fff" } as const;
