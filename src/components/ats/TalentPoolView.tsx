"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "@/lib/dateFormat";
import { AddCandidateModal } from "@/components/ats/AddCandidateModal";
import { compileTalentPoolSearch } from "@/lib/talentPoolSearch";
import { candidateSourceLabel } from "@/lib/candidateSource";
import type { Candidate, Requisition } from "@/lib/types";

const UNASSIGNED_REQ_ID = "TALENT_POOL";

type ResumeDraft = {
  file: File;
  base64: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  skills: string[];
  experienceYears?: number;
  sourceDetail: string;
  currentCtc: string;
  expectedCtc: string;
  remarks: string;
  resumeText: string;
  candidateMatches?: { profileId: string; candidateId: string; name: string }[];
  candidateProfileId?: string;
};

function fileToBase64(file: File) {
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

function TalentFilterIcon({ name }: { name: "source" | "location" | "experience" | "profile" | "sort" | "notice" }) {
  const paths = {
    source: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
    location: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    experience: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5h8v2M3 12h18m-11 0v2h4v-2" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    sort: <path d="M7 4v16m0-16-3 3m3-3 3 3M17 20V4m0 16 3-3m-3 3-3-3" />,
    notice: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M7 2v4m10-4v4M3 9h18m-13 4h3m-3 4h6" /></>,
  };

  return <svg className="ats-talent-filter-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function compareNumericValues(left?: string | number, right?: string | number) {
  const leftNumber = left === undefined || left === "" ? null : Number(String(left).replace(/,/g, ""));
  const rightNumber = right === undefined || right === "" ? null : Number(String(right).replace(/,/g, ""));
  const validLeft = leftNumber !== null && Number.isFinite(leftNumber);
  const validRight = rightNumber !== null && Number.isFinite(rightNumber);
  if (!validLeft) return validRight ? 1 : 0;
  if (!validRight) return -1;
  return leftNumber! - rightNumber!;
}

function TalentPoolResumeUpload({
  apiFetch,
  onClose,
  onSaved,
}: {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved: (savedCount: number, complete: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<ResumeDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");

  async function parseFiles(files: File[]) {
    if (!files.length) return;
    if (files.length > 50) {
      setMessage("Choose up to 50 resumes at a time.");
      return;
    }
    if (files.some((file) => file.size > 8 * 1024 * 1024)) {
      setMessage("Each resume must be smaller than 8 MB.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const uploaded = await Promise.all(files.map(async (file) => ({
        file,
        base64: await fileToBase64(file),
      })));
      const response = await apiFetch("/api/candidates/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: await Promise.all(uploaded.map(async ({ file, base64 }) => ({ fileName: file.name, mime: file.type, base64 }))),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not parse resumes.");
      setDrafts((data.resumes || []).map((resume: { fileName: string; name?: string; email?: string; phone?: string; skills?: string[]; experienceYears?: number; resumeText?: string }) => {
        const original = uploaded.find((item) => item.file.name === resume.fileName);
        return {
          file: original?.file as File,
          base64: original?.base64 || "",
          name: resume.name || "",
          email: resume.email || "",
          phone: (resume.phone || "").replace(/\D/g, "").slice(0, 10),
          location: "",
          skills: resume.skills || [],
          experienceYears: resume.experienceYears,
          sourceDetail: "",
          currentCtc: "",
          expectedCtc: "",
          remarks: "",
          resumeText: resume.resumeText || "",
        };
      }));
      setConsent(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not parse resumes.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(index: number, patch: Partial<ResumeDraft>) {
    setDrafts((current) => current.map((draft, currentIndex) => currentIndex === index ? { ...draft, ...patch } : draft));
  }

  async function saveDrafts() {
    const invalidDraft = drafts.find((draft) => !draft.base64);
    if (invalidDraft) {
      setMessage(`Could not read ${invalidDraft.file.name}. Please select the file again.`);
      return;
    }
    setBusy(true);
    setMessage("");
    let savedCount = 0;
    const failedDrafts: ResumeDraft[] = [];
    const failures: string[] = [];
    try {
      for (const draft of drafts) {
        try {
          const response = await apiFetch("/api/talent-pool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: draft.file.name,
              mime: draft.file.type,
              base64: draft.base64,
              name: draft.name.trim(),
              email: draft.email.trim(),
              phone: draft.phone.trim(),
              location: draft.location.trim(),
              skills: draft.skills,
              experienceYears: draft.experienceYears,
              sourceDetail: draft.sourceDetail.trim(),
              currentCtc: draft.currentCtc.trim(),
              expectedCtc: draft.expectedCtc.trim(),
              remarks: draft.remarks.trim(),
              extractedName: draft.name.trim(),
              extractedEmail: draft.email.trim(),
              extractedPhone: draft.phone.trim(),
              consentCaptured: consent,
              candidateProfileId: draft.candidateProfileId,
            }),
          });
          const data = await response.json();
          if (!response.ok) {
            if (data.code === "CANDIDATE_PROFILE_MATCH" && Array.isArray(data.matches)) {
              failedDrafts.push({ ...draft, candidateMatches: data.matches, candidateProfileId: undefined });
              failures.push(`${draft.file.name}: choose an existing profile below to continue.`);
              continue;
            }
            throw new Error(data.error || `Could not save ${draft.file.name}.`);
          }
          savedCount += 1;
        } catch (error) {
          failedDrafts.push(draft);
          failures.push(`${draft.file.name}: ${error instanceof Error ? error.message : "Could not save resume."}`);
        }
      }
      const complete = failedDrafts.length === 0;
      if (complete) {
        onSaved(savedCount, true);
      } else {
        setDrafts(failedDrafts);
        setConsent(false);
        setMessage(`${savedCount} saved. ${failures.join(" ")}`);
        onSaved(savedCount, false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ats-talent-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ats-talent-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="talent-upload-title">
        <div className="ats-talent-upload-head">
          <div><span className="ats-talent-upload-kicker">Unassigned candidates</span><h2 id="talent-upload-title">Add resumes to the library</h2></div>
          <button type="button" className="ats-talent-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="ats-talent-upload-copy">Save promising profiles for future roles. They won’t be attached to a requisition until you forward them.</p>
        <label className="ats-talent-file-label">Resume files
          <input type="file" multiple accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={(event) => void parseFiles(Array.from(event.target.files || []))} />
        </label>
        {busy && drafts.length === 0 && <p className="ats-talent-upload-status">Reading resumes…</p>}
        {drafts.length > 0 && <div className="ats-talent-upload-drafts">
          {drafts.map((draft, index) => <article className="ats-talent-upload-draft" key={`${draft.file.name}-${index}`}>
            <strong>{draft.file.name}</strong>
            <div className="ats-talent-upload-grid">
              <label>Name<input value={draft.name} onChange={(event) => updateDraft(index, { name: event.target.value })} placeholder="Not recorded" /></label>
              <label>Email<input type="email" value={draft.email} onChange={(event) => updateDraft(index, { email: event.target.value, candidateMatches: undefined, candidateProfileId: undefined })} /></label>
              <label>Phone<input value={draft.phone} onChange={(event) => updateDraft(index, { phone: event.target.value.replace(/\D/g, "").slice(0, 10), candidateMatches: undefined, candidateProfileId: undefined })} /></label>
              <label>Location<input value={draft.location} onChange={(event) => updateDraft(index, { location: event.target.value })} /></label>
              <label>Original source<input value={draft.sourceDetail} onChange={(event) => updateDraft(index, { sourceDetail: event.target.value })} placeholder="Gmail, personal contact, event…" /></label>
              <label>Experience (years)<input type="number" min="0" max="60" value={draft.experienceYears ?? ""} onChange={(event) => updateDraft(index, { experienceYears: event.target.value ? Number(event.target.value) : undefined })} /></label>
              <label>Current CTC (optional)<input inputMode="numeric" value={draft.currentCtc} onChange={(event) => updateDraft(index, { currentCtc: event.target.value.replace(/\D/g, "") })} placeholder="Not recorded" /></label>
              <label>Expected CTC (optional)<input inputMode="numeric" value={draft.expectedCtc} onChange={(event) => updateDraft(index, { expectedCtc: event.target.value.replace(/\D/g, "") })} placeholder="Not recorded" /></label>
            </div>
            {draft.candidateMatches?.length ? <fieldset className="ats-talent-duplicate-choice">
              <legend>Possible existing candidate</legend>
              <p>Select the matching profile to add this resume to the same candidate record.</p>
              {draft.candidateMatches.map((profile) => <label key={profile.profileId}>
                <input type="radio" name={`candidate-profile-${index}`} checked={draft.candidateProfileId === profile.profileId} onChange={() => updateDraft(index, { candidateProfileId: profile.profileId })} />
                <span><strong>{profile.name}</strong> <small>{profile.candidateId}</small></span>
              </label>)}
            </fieldset> : null}
            <label>Skills<input value={draft.skills.join(", ")} onChange={(event) => updateDraft(index, { skills: event.target.value.split(",").map((skill) => skill.trim()).filter(Boolean) })} /></label>
            <label>Notes<textarea value={draft.remarks} onChange={(event) => updateDraft(index, { remarks: event.target.value })} /></label>
          </article>)}
          <label className="ats-talent-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I confirm we have permission to retain these resumes and candidate details for future hiring.</label>
        </div>}
        {message && <p className="ats-talent-upload-error" role="alert">{message}</p>}
        <div className="ats-talent-upload-actions">
          <button type="button" className="ats-talent-secondary" onClick={onClose}>Close</button>
          {drafts.length > 0 && <button type="button" className="ats-talent-forward" disabled={busy} onClick={() => void saveDrafts()}>{busy ? "Saving…" : `Save ${drafts.length} resume${drafts.length === 1 ? "" : "s"}`}</button>}
        </div>
      </div>
    </div>
  );
}

type Match = {
  candidate: Candidate;
  score: number;
  alreadyAssigned: boolean;
  canViewDetails: boolean;
  matchedSkills: string[];
  requiredSkills: string[];
  history: {
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

type SavedSearch = {
  id: string;
  name: string;
  query: string;
  sourceFilter: string;
  locationFilter: string;
  experienceFilter: string;
  candidateTypeFilter: string;
  noticePeriodFilter: string;
  sortOrder: string;
};

export function TalentPoolView({
  requisitions,
  apiFetch,
  vendorsSpendEnabled = false,
  onOpenCandidate,
  onDone,
}: {
  requisitions: Requisition[];
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  vendorsSpendEnabled?: boolean;
  onOpenCandidate: (id: string) => void;
  onDone: (message: string) => void;
}) {
  const openRequisitions = useMemo(
    () => requisitions.filter((item) => ["Approved", "Position Reopened", "Partially Fulfilled"].includes(item.status)),
    [requisitions]
  );
  const [forwardReqId, setForwardReqId] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((current) => {
        if (current === searchInput) return current;
        setAiEvidence(null); setAiSummary("");
        return searchInput;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [aiPosition, setAiPosition] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEvidence, setAiEvidence] = useState<Record<string, string> | null>(null);
  const [aiSummary, setAiSummary] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [experienceFilter, setExperienceFilter] = useState("");
  const [candidateTypeFilter, setCandidateTypeFilter] = useState("");
  const [noticePeriodFilter, setNoticePeriodFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("newest");
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [activeInPool, setActiveInPool] = useState(0);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [forwardFormOpen, setForwardFormOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"quick" | "saved" | "xray">("quick");
  const [xraySite, setXraySite] = useState("linkedin");
  const [xrayPosition, setXrayPosition] = useState("");
  const [xrayBusy, setXrayBusy] = useState(false);
  const [xrayError, setXrayError] = useState("");
  const [xraySearch, setXraySearch] = useState<{
    googleUrl: string;
    results: { title: string; description: string; url: string }[];
    notice?: string;
  } | null>(null);
  const xrayRequest = useRef<AbortController | null>(null);
  useEffect(() => () => xrayRequest.current?.abort(), []);

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchesReady, setSavedSearchesReady] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("ats-talent-pool-saved-searches");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setSavedSearches(parsed);
      }
    } catch {
      setSavedSearches([]);
    } finally {
      setSavedSearchesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!savedSearchesReady) return;
    try {
      window.localStorage.setItem("ats-talent-pool-saved-searches", JSON.stringify(savedSearches));
    } catch {
      setMessage("Saved searches could not be stored in this browser.");
    }
  }, [savedSearches, savedSearchesReady]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    apiFetch("/api/talent-pool?scope=all")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load candidates.");
        if (!cancelled) {
          setMatches(data.candidates || []);
          setTotalCandidates(Number(data.totalCandidates ?? data.candidates?.length ?? 0));
          setActiveInPool(Number(data.activeInPool ?? data.candidates?.length ?? 0));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMatches([]);
          setMessage(error instanceof Error ? error.message : "Could not load candidates.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  const booleanSearch = useMemo(() => {
    try {
      return { matches: compileTalentPoolSearch(query), error: "" };
    } catch (error) {
      return { matches: () => false, error: error instanceof Error ? error.message : "Invalid Boolean search." };
    }
  }, [query]);

  const sourceOptions = useMemo(() => [...new Set(matches.map(({ candidate }) => candidate.sourceDetail || candidateSourceLabel(candidate.source) || "Unknown"))].sort(), [matches]);
  const locationOptions = useMemo(() => [...new Set(matches.map(({ candidate }) => candidate.location).filter(Boolean))].sort(), [matches]);
  const filteredMatches = useMemo(() => matches.filter(({ candidate }) => {
    if (aiEvidence && !(candidate.id in aiEvidence)) return false;
    const searchText = [
      candidate.name, candidate.candidateId, candidate.applicationId, candidate.email, candidate.phone, candidate.location, candidate.source, candidateSourceLabel(candidate.source),
      candidate.sourceDetail, candidate.remarks, candidate.stage, candidate.expectedCtc,
      ...(candidate.skills || []),
    ].filter(Boolean).join(" ").toLowerCase();
    if (!booleanSearch.matches(searchText)) return false;
    if (sourceFilter && (candidate.sourceDetail || candidateSourceLabel(candidate.source) || "Unknown") !== sourceFilter) return false;
    if (locationFilter && candidate.location !== locationFilter) return false;
    if (candidateTypeFilter === "unassigned" && candidate.reqId !== UNASSIGNED_REQ_ID) return false;
    if (candidateTypeFilter === "previous" && candidate.reqId === UNASSIGNED_REQ_ID) return false;
    const years = candidate.experienceYears;
    const noticeDays = candidate.notice ? Number(candidate.notice) : undefined;
    if (experienceFilter === "0-2" && (years === undefined || years > 2)) return false;
    if (experienceFilter === "3-5" && (years === undefined || years < 3 || years > 5)) return false;
    if (experienceFilter === "6-10" && (years === undefined || years < 6 || years > 10)) return false;
    if (experienceFilter === "11+" && (years === undefined || years < 11)) return false;
    if (noticePeriodFilter === "0-15" && (noticeDays === undefined || noticeDays > 15)) return false;
    if (noticePeriodFilter === "16-30" && (noticeDays === undefined || noticeDays < 16 || noticeDays > 30)) return false;
    if (noticePeriodFilter === "31-60" && (noticeDays === undefined || noticeDays < 31 || noticeDays > 60)) return false;
    if (noticePeriodFilter === "61+" && (noticeDays === undefined || noticeDays < 61)) return false;
    return true;
  }), [aiEvidence, booleanSearch, candidateTypeFilter, experienceFilter, locationFilter, matches, noticePeriodFilter, sourceFilter]);

  async function searchXray(requisitionId: string, site: string) {
    xrayRequest.current?.abort();
    setXraySearch(null);
    setXrayError("");
    setXrayBusy(Boolean(requisitionId));
    if (!requisitionId) return;

    const request = new AbortController();
    xrayRequest.current = request;
    try {
      const response = await apiFetch("/api/talent-pool/xray", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requisitionId, site }),
        signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not search for public profiles.");
      if (!request.signal.aborted) setXraySearch(data);
    } catch (error) {
      if (!request.signal.aborted) setXrayError(error instanceof Error ? error.message : "Could not search for public profiles.");
    } finally {
      if (!request.signal.aborted) setXrayBusy(false);
    }
  }

  async function searchWithAi(positionId: string) {
    if (!positionId || aiBusy) return;
    setAiBusy(true); setMessage(""); setAiEvidence(null); setAiSummary("");
    try {
      const response = await apiFetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "pool-position", requisitionId: positionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not review the talent pool.");
      setQuery(""); setSearchInput(""); setSourceFilter(""); setLocationFilter(""); setExperienceFilter(""); setCandidateTypeFilter(""); setNoticePeriodFilter("");
      setAiEvidence(Object.fromEntries((result.matches as { id: string; evidence: string }[]).map((item) => [item.id, item.evidence])));
      setAiSummary(`AI reviewed ${result.reviewed} of ${result.total} accessible profiles; ${result.unreadable} had no readable resume. Review the evidence before making decisions.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not review the talent pool."); }
    finally { setAiBusy(false); }
  }
  const sortedMatches = useMemo(() => [...filteredMatches].sort((left, right) => {
    if (sortOrder === "name") return left.candidate.name.localeCompare(right.candidate.name);
    if (sortOrder === "ctc") return compareNumericValues(left.candidate.expectedCtc, right.candidate.expectedCtc);
    if (sortOrder === "experience") return compareNumericValues(left.candidate.experienceYears, right.candidate.experienceYears);
    if (sortOrder === "notice") return compareNumericValues(left.candidate.notice, right.candidate.notice);
    return right.candidate.createdAt.localeCompare(left.candidate.createdAt);
  }), [filteredMatches, sortOrder]);
  const allVisibleSelected = sortedMatches.length > 0 && sortedMatches.every(({ candidate }) => selectedCandidateIds.includes(candidate.id));

  function applySavedSearch(search: SavedSearch) {
    setSearchInput(search.query);
    setQuery(search.query);
    setSourceFilter(search.sourceFilter);
    setLocationFilter(search.locationFilter);
    setExperienceFilter(search.experienceFilter);
    setCandidateTypeFilter(search.candidateTypeFilter);
    setNoticePeriodFilter(search.noticePeriodFilter || "");
    setSortOrder(search.sortOrder);
    setSearchMode("quick");
  }

  function saveCurrentSearch() {
    const name = saveSearchName.trim();
    if (!name) {
      setMessage("Enter a name for this saved search.");
      return;
    }
    setSavedSearches((current) => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      query,
      sourceFilter,
      locationFilter,
      experienceFilter,
      candidateTypeFilter,
      noticePeriodFilter,
      sortOrder,
    }, ...current]);
    setSaveSearchName("");
    setSavingSearch(false);
    setSearchMode("saved");
    setMessage("");
  }

  function exportResults() {
    const columns = ["Name", "Email", "Phone", "Location", "Source", "Experience years", "Expected CTC", "Notice", "Skills", "Stage", "Requisition", "Added"];
    const candidatesToExport = selectedCandidateIds.length
      ? sortedMatches.filter(({ candidate }) => selectedCandidateIds.includes(candidate.id))
      : sortedMatches;
    const rows = candidatesToExport.map(({ candidate }) => [
      candidate.name,
      candidate.email,
      candidate.phone,
      candidate.location,
      candidate.sourceDetail || candidateSourceLabel(candidate.source),
      candidate.experienceYears,
      candidate.expectedCtc,
      candidate.notice,
      (candidate.skills || []).join("; "),
      candidate.reqId === UNASSIGNED_REQ_ID ? "Unassigned" : candidate.stage,
      candidate.reqId === UNASSIGNED_REQ_ID ? "" : candidate.reqId,
      candidate.createdAt,
    ]);
    const csv = [columns, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "talent-pool-candidates.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function toggleCandidateSelection(id: string) {
    setSelectedCandidateIds((current) => current.includes(id) ? current.filter((candidateId) => candidateId !== id) : [...current, id]);
  }

  function toggleVisibleSelection() {
    const visibleIds = sortedMatches.map(({ candidate }) => candidate.id);
    setSelectedCandidateIds((current) => allVisibleSelected
      ? current.filter((candidateId) => !visibleIds.includes(candidateId))
      : [...new Set([...current, ...visibleIds])]);
  }

  function beginForward(candidate: Candidate) {
    setSelected(candidate);
    setForwardReqId("");
    setForwardFormOpen(false);
  }

  async function downloadCv(candidate: Candidate) {
    const response = await apiFetch(`/api/talent-pool/${candidate.id}/cv`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setMessage(data.error || "Could not download CV.");
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

  return (
    <section className="ats-talent-pool">
      <header className="ats-talent-hero">
        <div className="ats-talent-hero-icon" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><circle cx="12" cy="10" r="4"/><path d="M4 26v-2a8 8 0 0 1 16 0v2M22 7a4 4 0 0 1 0 8m2 3a7 7 0 0 1 4 6v2"/></svg></div>
        <div className="ats-talent-hero-copy"><span className="ats-talent-eyebrow">TALENT POOL</span><h1>Find the right talent, faster</h1><p>Search, filter, and manage candidate profiles across your ATS and resume library.</p></div>
        <div className="ats-talent-stats" aria-label="Talent Pool counts">
          <div><span>Total Candidates</span><strong>{totalCandidates.toLocaleString()}</strong><small>Across your ATS</small></div>
          <div><span>Active in Pool</span><strong>{activeInPool.toLocaleString()}</strong><small>Eligible for future positions</small></div>
        </div>
      </header>

      <section className="ats-talent-search-panel" aria-label="Search and filter candidates">
        <div className="ats-talent-search-modebar">
          <div className="ats-talent-mode-tabs" role="tablist" aria-label="Search mode">
            <button type="button" role="tab" aria-selected={searchMode === "quick"} className={searchMode === "quick" ? "is-active" : ""} onClick={() => setSearchMode("quick")}>Quick Search</button>
            <button type="button" role="tab" aria-selected={searchMode === "saved"} className={searchMode === "saved" ? "is-active" : ""} onClick={() => setSearchMode("saved")}>Saved Searches <span>{savedSearches.length}</span></button>
            <button type="button" role="tab" aria-selected={searchMode === "xray"} className={searchMode === "xray" ? "is-active" : ""} onClick={() => setSearchMode("xray")}>X-ray Search</button>
          </div>
          <div className="ats-talent-mode-actions">
            <button type="button" className="ats-talent-icon-action" onClick={exportResults} disabled={sortedMatches.length === 0} title={selectedCandidateIds.length ? `Export ${selectedCandidateIds.length} selected candidates` : "Export filtered candidates"} aria-label={selectedCandidateIds.length ? `Export ${selectedCandidateIds.length} selected candidates` : "Export filtered candidates"}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2v10m0 0 4-4m-4 4L6 8M3 13v4h14v-4" /></svg></button>
            <button type="button" className={`ats-talent-icon-action${savingSearch ? " is-active" : ""}`} onClick={() => { setSearchMode("quick"); setSavingSearch((current) => !current); }} title={savingSearch ? "Cancel saving search" : "Save current search"} aria-label={savingSearch ? "Cancel saving search" : "Save current search"}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3.5h10l2 2V17H4zM7 3.5v5h6v-5M7 17v-5h6v5" /></svg></button>
            <button type="button" className="ats-talent-icon-action" onClick={() => setUploadOpen(true)} title="Upload resumes to Talent Pool" aria-label="Upload resumes to Talent Pool"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M3 12v4.5A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V12" /></svg></button>
          </div>
        </div>

        {searchMode === "quick" ? <>
          <div className="ats-talent-search-row">
            <label className="ats-talent-search">
              <span className="ats-talent-search-field"><span className="ats-talent-search-icon" aria-hidden="true">⌕</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setQuery(searchInput); }} placeholder="Search by name, skills, designation, location, experience, etc..." aria-label="Search candidates" /></span>
            </label>
            <select className="ats-talent-ai-position-select" aria-label="AI search: select a position" value={aiPosition} disabled={aiBusy || loading} onChange={(event) => { const value = event.target.value; setAiPosition(value); setAiEvidence(null); setAiSummary(""); if (value) void searchWithAi(value); }}><option value="">{aiBusy ? "AI reviewing CVs…" : "✦ AI search: select a position"}</option>{openRequisitions.map((req) => <option key={req.id} value={req.id}>{req.title} · {req.id}</option>)}</select>
          </div>
          {aiEvidence && <div className="ats-talent-ai-position"><button type="button" onClick={() => { setAiEvidence(null); setAiSummary(""); }}>Clear AI results</button></div>}
          {aiSummary && <p className="ats-talent-ai-summary" role="status">{aiSummary}</p>}
          <div className="ats-talent-filters">
            <label className="ats-talent-filter-control"><TalentFilterIcon name="source" /><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter by source"><option value="">Source</option>{sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
            <label className="ats-talent-filter-control"><TalentFilterIcon name="location" /><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Filter by location"><option value="">Location</option>{locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
            <label className="ats-talent-filter-control"><TalentFilterIcon name="experience" /><select value={experienceFilter} onChange={(event) => setExperienceFilter(event.target.value)} aria-label="Filter by experience"><option value="">Experience</option><option value="0-2">0–2 years</option><option value="3-5">3–5 years</option><option value="6-10">6–10 years</option><option value="11+">11+ years</option></select></label>
            <label className="ats-talent-filter-control"><TalentFilterIcon name="profile" /><select value={candidateTypeFilter} onChange={(event) => setCandidateTypeFilter(event.target.value)} aria-label="Filter by profile"><option value="">Profile</option><option value="unassigned">Unassigned</option><option value="previous">Previously assigned</option></select></label>
            <label className="ats-talent-filter-control"><TalentFilterIcon name="notice" /><select value={noticePeriodFilter} onChange={(event) => setNoticePeriodFilter(event.target.value)} aria-label="Filter by notice period"><option value="">Notice Period</option><option value="0-15">0–15 days</option><option value="16-30">16–30 days</option><option value="31-60">31–60 days</option><option value="61+">61+ days</option></select></label>
            <label className="ats-talent-filter-control"><TalentFilterIcon name="sort" /><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort candidates"><option value="newest">Sort By</option><option value="name">Name</option><option value="ctc">CTC</option><option value="experience">Experience</option><option value="notice">Notice period</option></select></label>
          </div>
          {savingSearch && <form className="ats-talent-save-search" onSubmit={(event) => { event.preventDefault(); saveCurrentSearch(); }}><label>Save current search<input autoFocus value={saveSearchName} onChange={(event) => setSaveSearchName(event.target.value)} placeholder="e.g. Senior frontend engineers" /></label><button type="submit">Save search</button><button type="button" className="ats-talent-cancel-save" onClick={() => setSavingSearch(false)}>Cancel</button></form>}
        </> : searchMode === "xray" ? (
          <>
            <div className="ats-talent-save-search ats-talent-xray">
              <label className="ats-talent-xray-source">
                Search site
                <select value={xraySite} onChange={(event) => {
                  const site = event.target.value;
                  setXraySite(site);
                  void searchXray(xrayPosition, site);
                }}>
                  <option value="linkedin">LinkedIn profiles</option>
                  <option value="github">GitHub</option>
                </select>
              </label>
              <label>
                Open position
                <select value={xrayPosition} onChange={(event) => {
                  const position = event.target.value;
                  setXrayPosition(position);
                  void searchXray(position, xraySite);
                }}>
                  <option value="">{openRequisitions.length ? "Select a position" : "No open positions available"}</option>
                  {openRequisitions.map((req) => <option key={req.id} value={req.id}>{req.title} · {req.id}</option>)}
                </select>
              </label>
            </div>
            {xrayBusy && <p className="ats-talent-xray-note" role="status">Searching public profiles…</p>}
            {xrayError && <p className="ats-talent-xray-note" role="alert">{xrayError}</p>}
            {xraySearch && (
              <section className="ats-talent-xray-results" aria-label="Public search results">
                <div className="ats-talent-xray-results-heading">
                  <strong>Public search results</strong>
                  <a href={xraySearch.googleUrl} target="_blank" rel="noopener noreferrer">Open search on Google ↗</a>
                </div>
                <p className="ats-talent-xray-note" role="status">
                  {xraySearch.notice || (xraySearch.results.length ? `${xraySearch.results.length} public ${xraySearch.results.length === 1 ? "profile" : "profiles"} found` : "No public profiles found for this position.")}
                </p>
                {xraySearch.results.length > 0 && (
                  <ul>
                    {xraySearch.results.map((result) => (
                      <li key={result.url}>
                        <a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a>
                        {result.description && <p>{result.description}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        ) : <div className="ats-talent-saved-searches">
          {savedSearches.length === 0 ? <p>No saved searches yet. Run a search and save its filters to reuse it.</p> : savedSearches.map((search) => <div className="ats-talent-saved-search" key={search.id}><button type="button" onClick={() => applySavedSearch(search)}><strong>{search.name}</strong><span>{search.query || "All candidates"}</span></button><button type="button" aria-label={`Delete ${search.name}`} onClick={() => setSavedSearches((current) => current.filter((item) => item.id !== search.id))}>×</button></div>)}
        </div>}
      </section>

      <div className="ats-talent-results-head">
        <div><strong>{loading ? "Loading candidates…" : `${filteredMatches.length.toLocaleString()} candidates`}</strong><span>{searchMode === "xray" ? "ATS results from Quick Search" : "Matching your search criteria"}</span></div>
        {selectedCandidateIds.length > 0 && <span className="ats-talent-selected-count">{selectedCandidateIds.length} selected</span>}
      </div>

      {message && <p className="ats-talent-message" role="status">{message}</p>}
      {booleanSearch.error && <p className="ats-talent-search-error" role="alert">{booleanSearch.error}</p>}
      {!loading && !booleanSearch.error && sortedMatches.length === 0 && <div className="ats-talent-empty"><strong>{matches.length ? "No resumes match these filters" : "Your resume pool is empty"}</strong><span>{matches.length ? "Adjust your search or filters to see more profiles." : "Add resumes from personal contacts, email, and other sourcing channels."}</span></div>}

      <div className="ats-talent-list is-list">
        <div className="ats-talent-table-head"><div className="ats-talent-table-candidate-heading"><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} aria-label="Select all visible candidates" /></label><span>Candidate</span></div><span>Source</span><span>Experience</span><span>Expected CTC</span><span>Notice</span><span>Actions</span></div>
        {sortedMatches.map(({ candidate, history, canViewDetails }) => (
          <article className="ats-talent-candidate" key={candidate.id}>
            <div className="ats-talent-candidate-main">
              <label className="ats-talent-row-select"><input type="checkbox" checked={selectedCandidateIds.includes(candidate.id)} onChange={() => toggleCandidateSelection(candidate.id)} aria-label={`Select ${candidate.name}`} /></label>
              <div className="ats-talent-avatar" aria-hidden="true">{candidate.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div>
              <div className="ats-talent-person">
                {canViewDetails ? <button type="button" className="ats-talent-name" onClick={() => onOpenCandidate(candidate.id)}>{candidate.name}</button> : <strong className="ats-talent-name">{candidate.name}</strong>}
                {candidate.candidateId && <small className="ats-candidate-id-subtle">{candidate.candidateId}</small>}
                {(candidate.stage === "Candidate Backed Out" || candidate.backedOutAt) && <span className="ats-talent-backed-out-badge">Backed-Out</span>}
                <div className="ats-talent-contact">{candidate.email || "Email not provided"}{candidate.phone ? ` · ${candidate.phone}` : ""}{candidate.location ? ` · ${candidate.location}` : ""}</div>
                {!!candidate.skills?.length && <div className="ats-talent-skills">{candidate.skills.slice(0, 8).map((skill) => <span key={skill}>{skill}</span>)}</div>}
                {aiEvidence?.[candidate.id] && <p className="ats-talent-ai-evidence"><strong>AI evidence:</strong> {aiEvidence[candidate.id]}</p>}
                <button type="button" className="ats-talent-history-toggle" aria-expanded={expandedHistoryId === candidate.id} onClick={() => setExpandedHistoryId((current) => current === candidate.id ? null : candidate.id)}>Interview history <span>{history.length}</span></button>
                {expandedHistoryId === candidate.id && <div className="ats-talent-history">
                  {history.length === 0 ? <p>No prior interviews or feedback recorded.</p> : history.map((item, index) => <section className="ats-talent-history-item" key={`${item.reqId}-${item.datetime}-${index}`}>
                    <div className="ats-talent-history-head"><strong>{item.reqTitle}</strong><span>{formatDateTime(item.datetime, "Date not recorded")}</span></div>
                    <div className="ats-talent-history-meta">{item.roundName} · {item.status}</div>
                    <div className="ats-talent-history-meta"><b>Interviewers:</b> {item.interviewers.length ? item.interviewers.join(", ") : "Not recorded"}</div>
                    {item.feedback.map((entry, feedbackIndex) => <div className="ats-talent-feedback" key={`${entry.createdAt}-${feedbackIndex}`}>
                      <div><b>{entry.interviewer || "Interviewer"}</b><span>{formatDateTime(entry.createdAt, "")}</span>{entry.rating ? <span>Rating {entry.rating}/5</span> : null}</div>
                      {entry.recommendation && <p><b>Recommendation:</b> {entry.recommendation}</p>}{entry.feedback && <p>{entry.feedback}</p>}
                    </div>)}
                  </section>)}
                </div>}
              </div>
            </div>
            <div className="ats-talent-candidate-facts">
              <span><small>Source</small>{candidate.sourceDetail || candidateSourceLabel(candidate.source) || "Not recorded"}</span>
              <span><small>Experience</small>{candidate.experienceYears !== undefined ? `${candidate.experienceYears} years` : "—"}</span>
              <span><small>Expected CTC</small>{candidate.expectedCtc || "No records"}</span>
              <span><small>Notice</small>{candidate.notice ? `${candidate.notice} days` : "—"}</span>
            </div>
            <div className="ats-talent-candidate-actions">
              <div className="ats-talent-match"><strong>{candidate.reqId === UNASSIGNED_REQ_ID ? "Saved" : candidate.stage}</strong><span>{candidate.reqId === UNASSIGNED_REQ_ID ? "profile" : "stage"}</span></div>
              <div className="ats-talent-action-row">
                {candidate.cvPath && <button type="button" className="ats-talent-secondary" onClick={() => void downloadCv(candidate)}>Resume</button>}
                <button type="button" className="ats-talent-forward" disabled={!openRequisitions.length} title={!openRequisitions.length ? "No open positions available" : undefined} onClick={() => beginForward(candidate)}>Forward</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {uploadOpen && <TalentPoolResumeUpload
        apiFetch={apiFetch}
        onClose={() => setUploadOpen(false)}
        onSaved={(savedCount, complete) => {
          if (savedCount) {
            apiFetch("/api/talent-pool?scope=all").then(async (response) => {
              const data = await response.json();
              if (response.ok) {
                setMatches(data.candidates || []);
                setTotalCandidates(Number(data.totalCandidates ?? data.candidates?.length ?? 0));
                setActiveInPool(Number(data.activeInPool ?? data.candidates?.length ?? 0));
              }
            });
            setMessage(`${savedCount} resume${savedCount === 1 ? "" : "s"} added to the library.`);
          }
          if (complete) setUploadOpen(false);
        }}
      />}

      {selected && (
        <div className="ats-talent-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelected(null); setForwardReqId(""); setForwardFormOpen(false); } }}>
          <div className="ats-talent-forward-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${selected.name} before forwarding`}>
            {forwardFormOpen ? <AddCandidateModal
              reqId={forwardReqId}
              reqTitle={openRequisitions.find((item) => item.id === forwardReqId)?.title || "Selected position"}
              candidate={selected}
              vendorsSpendEnabled={vendorsSpendEnabled}
              apiFetch={apiFetch}
              onClose={() => { setSelected(null); setForwardReqId(""); setForwardFormOpen(false); }}
              onBack={() => setForwardFormOpen(false)}
              onSaved={() => {
                const forwardedCandidate = selected;
                const positionName = openRequisitions.find((item) => item.id === forwardReqId)?.title || forwardReqId;
                setSelected(null);
                setForwardReqId("");
                setForwardFormOpen(false);
                if (!forwardedCandidate) return;
                setMatches((current) => current.filter((match) => match.candidate.id !== forwardedCandidate.id));
                setSelectedCandidateIds((current) => current.filter((candidateId) => candidateId !== forwardedCandidate.id));
                setActiveInPool((current) => Math.max(0, current - 1));
                onDone(`${forwardedCandidate.name} was forwarded to ${positionName}.`);
              }}
            /> : <div className="ats-talent-forward-picker">
              <span className="ats-talent-upload-kicker">Forward candidate</span>
              <h2>Choose a position</h2>
              <p>{selected.name} will be added to the selected requisition for review.</p>
              {(!selected.expectedCtc || !(selected.currentFixedCtc || selected.currentCtc)) && <p role="status">CTC: No records for {!(selected.currentFixedCtc || selected.currentCtc) && !selected.expectedCtc ? "current and expected CTC" : !selected.expectedCtc ? "expected CTC" : "current CTC"}. Please update the details if available before forwarding.</p>}
              <label className="ats-talent-position"><span>Open requisition</span><select value={forwardReqId} onChange={(event) => setForwardReqId(event.target.value)}><option value="">Select a position</option>{openRequisitions.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.id}</option>)}</select></label>
              <div className="ats-talent-upload-actions"><button type="button" className="ats-talent-secondary" onClick={() => { setSelected(null); setForwardReqId(""); }}>Cancel</button><button type="button" className="ats-talent-forward" disabled={!forwardReqId} onClick={() => setForwardFormOpen(true)}>Continue</button></div>
            </div>}
          </div>
        </div>
      )}
    </section>
  );
}
