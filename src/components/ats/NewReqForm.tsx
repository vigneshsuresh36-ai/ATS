"use client";

import { useState } from "react";
import { DEPARTMENTS } from "@/lib/roles";
import { departmentOptions, requiresSubDepartment } from "@/lib/requisitionScope";
import type { OrgSettings, RequisitionAccessScope } from "@/lib/types";
import { DualRange } from "./DualRange";
import { cancelBtn, inp, lab, saveBtn, stepBtn } from "./ui";

function employeeCodeCount(value: string) {
  return new Set(value.split(/[\s,]+/).map((code) => code.trim()).filter(Boolean)).size;
}

export function NewReqForm({
  raisedBy,
  allowedDepartments,
  officeLocations = [],
  businessUnits = [],
  organization,
  accessScopes,
  subDepartments = [],
  departmentRequired = true,
  businessUnitRequired = false,
  apiFetch,
  onClose,
  onSave,
}: {
  raisedBy: string;
  allowedDepartments: string[];
  officeLocations?: { name: string; city?: string }[];
  businessUnits?: string[];
  organization?: OrgSettings | null;
  accessScopes?: RequisitionAccessScope[];
  subDepartments?: { department: string; name: string }[];
  departmentRequired?: boolean;
  businessUnitRequired?: boolean;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<string>("");
  const [subDepartment, setSubDepartment] = useState("");
  const [businessUnit, setBusinessUnit] = useState("");
  const units = accessScopes ? businessUnits.filter((unit) => accessScopes.some((scope) => scope.businessUnit === unit)) : businessUnits;
  const unitScopes = accessScopes?.filter((scope) => scope.businessUnit === businessUnit);
  const orgDepartments = organization && businessUnit ? departmentOptions(organization, businessUnit) : [...DEPARTMENTS, ...allowedDepartments];
  const depts = allowedDepartments.filter((name) => orgDepartments.includes(name) && (!unitScopes || unitScopes.some((scope) => scope.department === name)));
  const departmentScopes = unitScopes?.filter((scope) => scope.department === department);
  const specificTeams = departmentScopes?.length && departmentScopes.every((scope) => scope.subDepartment);
  const subRequired = requiresSubDepartment(department, { businessUnits }) || !!specificTeams;
  const teams = subDepartments.filter((item) => item.department === department && (!specificTeams || departmentScopes?.some((scope) => scope.subDepartment === item.name)));
  const [requisitionType, setRequisitionType] = useState<"" | "New" | "Replacement">("");
  const [businessJustification, setBusinessJustification] = useState("");
  const [replacementEmployeeCode, setReplacementEmployeeCode] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationFocused, setLocationFocused] = useState(false);
  const [employment, setEmployment] = useState("Full-time");
  const [expLo, setExpLo] = useState(2);
  const [expHi, setExpHi] = useState(5);
  const [salLo, setSalLo] = useState("");
  const [salHi, setSalHi] = useState("");
  const [joinLo, setJoinLo] = useState(15);
  const [joinHi, setJoinHi] = useState(30);
  const [openings, setOpenings] = useState(1);
  const [notes, setNotes] = useState("");
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  async function draftJobDescription() {
    if (!title.trim() && !notes.trim() && !jdText.trim()) { setAiError("Add a title or describe the role first."); return; }
    setAiBusy(true); setAiError("");
    try {
      const question = `Draft a job description from these details. Title: ${title}; Department: ${department}; Location: ${locations.join(", ")}; Employment: ${employment}; Experience: ${expLo}-${expHi} years; Notes: ${notes}; Existing description: ${jdText}`.slice(0, 2000);
      const response = await apiFetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "job-draft", question }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not draft the job description.");
      setJdText(result.answer);
    } catch (error) { setAiError(error instanceof Error ? error.message : "Could not draft the job description."); }
    finally { setAiBusy(false); }
  }

  function toggleLocation(city: string) {
    setLocations((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city]
    );
  }

  const locationMatches = locationQuery.trim()
    ? officeLocations
        .filter((office) =>
          `${office.name} ${office.city || ""}`
            .toLowerCase()
            .includes(locationQuery.trim().toLowerCase())
        )
        .slice(0, 3)
    : [];

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>New requisition</h3>
      <div style={{ fontSize: 12, color: "#777", marginBottom: 12 }}>
        Requests go to the selected department’s Department Head for approval. Requests without a department go to Admins.
      </div>
      <label style={lab}>Title *</label>
      <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label style={lab}>Business unit {businessUnitRequired ? "*" : "(optional)"}</label>
      <select style={inp} required={businessUnitRequired} value={businessUnit} onChange={(event) => { setBusinessUnit(event.target.value); setDepartment(""); setSubDepartment(""); }}><option value="">Select business unit</option>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
      <label style={lab}>Department {departmentRequired || businessUnitRequired ? "*" : "(optional)"}</label>
      <select style={inp} required={departmentRequired || businessUnitRequired} disabled={businessUnitRequired && !businessUnit} value={department} onChange={(event) => { setDepartment(event.target.value); setSubDepartment(""); }}><option value="">Select department</option>{depts.map((name) => <option key={name}>{name}</option>)}</select>
      {department && (teams.length > 0 || subRequired) && <><label style={lab}>Sub-department {subRequired ? "*" : "(optional)"}</label><select style={inp} required={subRequired} value={subDepartment} onChange={(event) => setSubDepartment(event.target.value)}><option value="">Select sub-department</option>{teams.map(({ name }) => <option key={name}>{name}</option>)}</select></>}
      <label style={lab}>Requisition type *</label>
      <select
        style={inp}
        value={requisitionType}
        onChange={(e) => {
          const value = e.target.value as "" | "New" | "Replacement";
          setRequisitionType(value);
          if (value !== "New") setBusinessJustification("");
          if (value !== "Replacement") setReplacementEmployeeCode("");
          if (value !== "New") setOpenings(1);
        }}
      >
        <option value="">Select type</option>
        <option value="New">New</option>
        <option value="Replacement">Replacement</option>
      </select>
      {requisitionType === "New" && (
        <>
          <label style={lab}>Business justification *</label>
          <textarea
            style={{ ...inp, minHeight: 80 }}
            value={businessJustification}
            onChange={(e) => setBusinessJustification(e.target.value)}
            placeholder="Why is this new position required?"
          />
        </>
      )}
      {requisitionType === "Replacement" && (
        <>
          <label style={lab}>Employee codes being replaced *</label>
          <input
            style={inp}
            value={replacementEmployeeCode}
            onChange={(e) => {
              const value = e.target.value;
              const maxOpenings = employeeCodeCount(value) || 1;
              setReplacementEmployeeCode(value);
              setOpenings((current) => Math.min(current, maxOpenings));
            }}
            placeholder="Enter employee codes, separated by commas"
          />
        </>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={lab} htmlFor="req-location-search">Location *</label>
          <div style={{ position: "relative" }}>
            <input id="req-location-search" style={inp} value={locationQuery} placeholder="Search office name or city" autoComplete="off" onChange={(event) => setLocationQuery(event.target.value)} onFocus={() => setLocationFocused(true)} onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setLocationFocused(false); }} />
            {locationFocused && locationQuery.trim() && <div className="ats-location-suggestions" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, maxHeight: 200, overflowY: "auto", background: "#fff", border: "1px solid #ddd", borderRadius: 8 }}>
              {locationMatches.map((office) => { const label = office.city ? `${office.name} · ${office.city}` : office.name; return <button key={JSON.stringify([office.name, office.city])} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!locations.includes(label)) toggleLocation(label); setLocationQuery(""); setLocationFocused(false); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: "#fff", border: 0, cursor: "pointer" }}><strong>{office.name}</strong>{office.city && <span style={{ color: "#666" }}> · {office.city}</span>}{locations.includes(label) && <span> ✓</span>}</button>; })}
              {locationMatches.length === 0 && <div style={{ padding: 12, color: "#666", fontSize: 12 }}>{officeLocations.length ? "No matching locations." : "Ask your Admin to add office locations in Settings → Company Profile."}</div>}
            </div>}
          </div>
          {locations.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{locations.map((location) => <button key={location} type="button" onClick={() => toggleLocation(location)} aria-label={`Remove ${location}`} style={{ border: "1px solid #ddd", borderRadius: 6, background: "#f4f4f3", padding: "5px 8px", cursor: "pointer" }}>{location} ×</button>)}</div>}
        </div>
        <div>
          <label style={lab}>Employment</label>
          <select style={inp} value={employment} onChange={(e) => setEmployment(e.target.value)}>
            <option>Full-time</option>
            <option>Contract</option>
            <option>Intern</option>
          </select>
        </div>
      </div>
      <label style={lab}>
        Experience (years): {expLo}–{expHi}
      </label>
      <DualRange
        min={0}
        max={30}
        lo={expLo}
        hi={expHi}
        onChange={(a, b) => {
          setExpLo(a);
          setExpHi(b);
        }}
      />
      <label style={lab}>
        Salary range (annual ₹)
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={lab} htmlFor="salary-from">From *</label>
          <input id="salary-from" style={inp} type="text" inputMode="numeric" pattern="[0-9]*" required value={salLo} onChange={(event) => setSalLo(event.target.value.replace(/\D/g, ""))} placeholder="e.g. 620000" />
        </div>
        <div>
          <label style={lab} htmlFor="salary-to">To *</label>
          <input id="salary-to" style={inp} type="text" inputMode="numeric" pattern="[0-9]*" required value={salHi} onChange={(event) => setSalHi(event.target.value.replace(/\D/g, ""))} placeholder="e.g. 710000" />
        </div>
      </div>
      <label style={lab}>
        Joining timeline (days): {joinLo}–{joinHi}
      </label>
      <DualRange
        min={15}
        max={90}
        lo={joinLo}
        hi={joinHi}
        onChange={(a, b) => {
          setJoinLo(a);
          setJoinHi(b);
        }}
      />
      <label style={lab}>Openings</label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" disabled={!requisitionType || openings <= 1} aria-label="Decrease openings" onClick={() => setOpenings((n) => Math.max(1, n - 1))} style={stepBtn}>
          −
        </button>
        <b>{openings}</b>
        <button
          type="button"
          disabled={
            !requisitionType || (requisitionType === "Replacement" &&
            openings >= Math.max(1, employeeCodeCount(replacementEmployeeCode))
            )
          }
          onClick={() =>
            setOpenings((n) =>
              requisitionType === "Replacement"
                ? Math.min(n + 1, Math.max(1, employeeCodeCount(replacementEmployeeCode)))
                : n + 1
            )
          }
          style={stepBtn}
          aria-label="Increase openings"
        >
          +
        </button>
      </div>
      {!requisitionType && <small style={{ color: "#777" }}>Select a requisition type to change the number of openings.</small>}
      <label style={lab}>Raised by</label>
      <div
        style={{
          background: "#f6f5f1",
          border: "1px solid #e2ddd0",
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 14,
        }}
      >
        {raisedBy}
      </div>
      <label style={lab}>Notes</label>
      <textarea
        style={{ ...inp, minHeight: 80 }}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes for approvers / recruiters"
      />
      <label style={lab}>Job description *</label>
      <button type="button" className="ats-draft-ai-button" style={cancelBtn} disabled={aiBusy} onClick={() => void draftJobDescription()}>{aiBusy ? "Drafting…" : "✦ Draft with AI"}</button>
      <small style={{ display: "block", color: "#666", marginTop: 5 }}>Review and edit the draft before submitting. Generating replaces the text below.</small>
      {aiError && <p role="alert">{aiError}</p>}
      <textarea
        required
        maxLength={20000}
        style={{ ...inp, minHeight: 180 }}
        value={jdText}
        onChange={(event) => setJdText(event.target.value)}
        placeholder="Describe the role, responsibilities, qualifications, and experience required."
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={cancelBtn}>
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            if ((departmentRequired || businessUnitRequired) && !department) { alert("Select a department."); return; }
            if (businessUnitRequired && !businessUnit) { alert("Select a business unit."); return; }
            if (subRequired && !subDepartment) { alert("Select a sub-department."); return; }
            if (!requisitionType) {
              alert("Select whether this is a new or replacement requisition.");
              return;
            }
            if (requisitionType === "New" && !businessJustification.trim()) {
              alert("Business justification is required for a new requisition.");
              return;
            }
            if (requisitionType === "Replacement" && !replacementEmployeeCode.trim()) {
              alert("Enter the employee code being replaced.");
              return;
            }
            if (
              requisitionType === "Replacement" &&
              openings > employeeCodeCount(replacementEmployeeCode)
            ) {
              alert("Openings cannot exceed the number of employee codes entered.");
              return;
            }
            if (!locations.length) {
              alert("Select at least one location.");
              return;
            }
            if (!jdText.trim()) {
              alert("Enter the job description before submitting.");
              return;
            }
            const salaryFrom = Number(salLo);
            const salaryTo = Number(salHi);
            if (!Number.isSafeInteger(salaryFrom) || !Number.isSafeInteger(salaryTo) || salaryFrom <= 0 || salaryTo < salaryFrom) {
              alert("Enter a valid annual salary range with From less than or equal to To.");
              return;
            }
            setBusy(true);
            try {
              await onSave({
                title,
                department,
                subDepartment,
                lob: businessUnit,
                requisitionType,
                businessJustification: businessJustification.trim() || undefined,
                replacementEmployeeCode: replacementEmployeeCode.trim() || undefined,
                locations,
                location: locations.join(", "),
                employment,
                level: `${expLo}-${expHi} years`,
                salaryMin: salaryFrom,
                salaryMax: salaryTo,
                priority: `${joinLo}-${joinHi} days`,
                openings,
                notes,
                jdText: jdText.trim(),
              });
            } finally {
              setBusy(false);
            }
          }}
          style={saveBtn}
        >
          Submit for approval
        </button>
      </div>
    </div>
  );
}
