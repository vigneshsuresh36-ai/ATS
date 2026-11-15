"use client";

import { useState, type CSSProperties } from "react";

type Item = Record<string, unknown>;
type ReportData = Record<string, Item[]>;
type ReportSchema = { label: string; dateField: string; fields: { key: string; label: string }[] };

const reportSchemas: Record<string, ReportSchema> = {
  candidates: {
    label: "Candidates",
    dateField: "createdAt",
    fields: [
      { key: "id", label: "Candidate ID" }, { key: "name", label: "Name" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
      { key: "location", label: "Location" }, { key: "stage", label: "Stage" },
      { key: "reqId", label: "Requisition ID" }, { key: "requisitionTitle", label: "Requisition" },
      { key: "department", label: "Department" }, { key: "recruiter", label: "Recruiter" },
      { key: "source", label: "Source" },
      { key: "sourceDetail", label: "Source detail" }, { key: "experienceYears", label: "Experience (years)" },
      { key: "skills", label: "Skills" }, { key: "createdAt", label: "Created at" },
      { key: "updatedAt", label: "Updated at" },
    ],
  },
  requisitions: {
    label: "Requisitions",
    dateField: "createdAt",
    fields: [
      { key: "id", label: "Requisition ID" }, { key: "title", label: "Title" },
      { key: "department", label: "Department" }, { key: "requisitionType", label: "Type" },
      { key: "location", label: "Location" }, { key: "employment", label: "Employment" },
      { key: "level", label: "Level" }, { key: "priorityLevel", label: "Priority" },
      { key: "priority", label: "Joining window" },
      { key: "openings", label: "Openings" }, { key: "status", label: "Status" },
      { key: "raisedBy", label: "Raised by" }, { key: "recruiter", label: "Recruiter" },
      { key: "createdAt", label: "Created at" }, { key: "updatedAt", label: "Updated at" },
    ],
  },
  interviews: {
    label: "Interviews",
    dateField: "datetime",
    fields: [
      { key: "id", label: "Interview ID" }, { key: "candidateName", label: "Candidate" },
      { key: "candidateEmail", label: "Candidate email" }, { key: "requisitionTitle", label: "Requisition" },
      { key: "department", label: "Department" }, { key: "round", label: "Round" },
      { key: "interviewerEmails", label: "Interviewers" }, { key: "datetime", label: "Scheduled at" },
      { key: "status", label: "Status" }, { key: "createdAt", label: "Created at" },
    ],
  },
  employeeReferrals: {
    label: "Employee referrals",
    dateField: "createdAt",
    fields: [
      { key: "candidateId", label: "Candidate ID" }, { key: "candidateName", label: "Candidate" },
      { key: "candidateEmail", label: "Candidate email" }, { key: "referrerName", label: "Referrer" },
      { key: "referrerEmail", label: "Referrer email" }, { key: "requisitionTitle", label: "Requisition" },
      { key: "department", label: "Department" }, { key: "location", label: "Location" },
      { key: "stage", label: "Stage" }, { key: "referralBonus", label: "Joining bonus" },
      { key: "bonusEarned", label: "Joining bonus earned" }, { key: "joiningPayoutStatus", label: "Joining payout status" },
      { key: "interviewPayoutCount", label: "Interview payouts" }, { key: "interviewPayoutTotal", label: "Interview payout total" },
      { key: "createdAt", label: "Referred at" }, { key: "updatedAt", label: "Updated at" },
    ],
  },
  referralPayouts: {
    label: "Referral payouts",
    dateField: "earnedAt",
    fields: [
      { key: "id", label: "Payout ID" }, { key: "candidateName", label: "Candidate" },
      { key: "referrerName", label: "Referrer" }, { key: "referrerEmail", label: "Referrer email" },
      { key: "requisitionTitle", label: "Requisition" }, { key: "kind", label: "Payout type" },
      { key: "roundName", label: "Interview round" }, { key: "amount", label: "Amount" },
      { key: "status", label: "Status" }, { key: "decision", label: "Decision" },
      { key: "earnedAt", label: "Earned at" }, { key: "joiningDate", label: "Joining date" },
      { key: "dueAt", label: "Due at" }, { key: "paidAt", label: "Paid at" },
      { key: "paidBy", label: "Paid by" },
    ],
  },
};

export function ReportsView({ data }: { data: Record<string, unknown> | null }) {
  return (
    <div className="ats-analytics" style={{ marginTop: 20 }}>
      <ReportBuilder reportData={data?.reportData as ReportData | undefined} />
    </div>
  );
}

function ReportBuilder({ reportData }: { reportData?: ReportData }) {
  const [dataset, setDataset] = useState("candidates");
  const [selectedFields, setSelectedFields] = useState<string[]>(reportSchemas.candidates.fields.map((field) => field.key));
  const [reportName, setReportName] = useState("ATS report");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const schema = reportSchemas[dataset];
  const rows = reportData?.[dataset] || [];
  const invalidDates = !!dateFrom && !!dateTo && dateFrom > dateTo;

  function changeDataset(value: string) {
    setDataset(value);
    setSelectedFields(reportSchemas[value].fields.map((field) => field.key));
  }

  function toggleField(key: string) {
    setSelectedFields((current) => current.includes(key)
      ? current.filter((field) => field !== key)
      : [...current, key]);
  }

  function downloadReport() {
    if (!reportData || !selectedFields.length || invalidDates) return;
    const filteredRows = rows.filter((row) => {
      const date = String(row[schema.dateField] || "").slice(0, 10);
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
    });
    const headers = schema.fields.filter((field) => selectedFields.includes(field.key));
    const csv = [headers.map((field) => csvCell(field.label)).join(","), ...filteredRows.map((row) =>
      headers.map((field) => csvCell(row[field.key])).join(",")
    )].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${reportName.trim().replace(/[^\w.-]+/g, "_") || "ATS_report"}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section style={reportCard} aria-label="Custom report builder">
      <header style={{ marginBottom: 14 }}>
        <h2 className="ats-heading-section">Build a Report</h2>
        <p className="ats-heading-subtitle">Choose a dataset, fields, and date range, then download a CSV.</p>
      </header>
      {!reportData ? <p style={{ color: "#777", fontSize: 13 }}>Loading report data...</p> : <>
        <div style={reportControls}>
          <label style={reportLabel}>Dataset
            <select value={dataset} onChange={(event) => changeDataset(event.target.value)} style={reportInput}>
              {Object.entries(reportSchemas).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
            </select>
          </label>
          <label style={reportLabel}>Report filename
            <input value={reportName} onChange={(event) => setReportName(event.target.value)} maxLength={80} style={reportInput} />
          </label>
          <label style={reportLabel}>From
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} style={reportInput} />
          </label>
          <label style={reportLabel}>To
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} style={reportInput} />
          </label>
        </div>
        <div style={reportFields} role="group" aria-label={`Fields to include in ${schema.label} report`}>
          {schema.fields.map((field) => <label key={field.key} style={reportField}>
            <input type="checkbox" checked={selectedFields.includes(field.key)} onChange={() => toggleField(field.key)} />
            {field.label}
          </label>)}
        </div>
        <div style={reportFooter}>
          <span style={{ color: invalidDates ? "#a33" : "#777", fontSize: 12 }} role={invalidDates ? "alert" : undefined}>
            {invalidDates ? "The start date must be before the end date." : `${filteredCount(rows, schema.dateField, dateFrom, dateTo)} rows match your selection.`}
          </span>
          <button type="button" className="ats-primary-button" onClick={downloadReport} disabled={!selectedFields.length || invalidDates || !rows.length}>
            Download CSV
          </button>
        </div>
      </>}
    </section>
  );
}

function filteredCount(rows: Item[], dateField: string, from: string, to: string) {
  return rows.filter((row) => {
    const date = String(row[dateField] || "").slice(0, 10);
    return (!from || date >= from) && (!to || date <= to);
  }).length;
}

function csvCell(value: unknown) {
  let text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const reportCard: CSSProperties = { background: "#fff", border: "1px solid #ebe6da", borderRadius: 8, padding: 18, boxShadow: "0 1px 0 rgba(40,35,20,.03)" };
const reportControls: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, margin: "14px 0" };
const reportLabel: CSSProperties = { display: "grid", gap: 5, color: "#555", fontSize: 12, fontWeight: 650 };
const reportInput: CSSProperties = { boxSizing: "border-box", width: "100%", minHeight: 38, border: "1px solid #dcd7ca", borderRadius: 6, padding: "7px 9px", background: "#fff", color: "#2c2c28", font: "inherit" };
const reportFields: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8, padding: "12px 0", borderTop: "1px solid #f0ece3", borderBottom: "1px solid #f0ece3" };
const reportField: CSSProperties = { display: "flex", alignItems: "center", gap: 7, color: "#444", fontSize: 12, minHeight: 26 };
const reportFooter: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" };