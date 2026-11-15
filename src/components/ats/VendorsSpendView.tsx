"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { Requisition, Role } from "@/lib/types";
import { DateTimeField } from "./DateTimeField";

type RecordRow = Record<string, unknown> & { id: string };
type Resource = "consultants" | "subscriptions" | "invoices" | "placementFees" | "guarantees" | "expenses" | "budgets" | "feeRules";
type Section = "overview" | "consultants" | "subscriptions" | "invoices" | "renewals" | "cost" | "budgets";
type ConsultantProfileTab = "Overview" | "Commercial Terms" | "Candidates" | "Invoices" | "Agreements" | "Performance";
type Field = { key: string; label: string; kind?: "number" | "date" | "email" | "textarea" | "checkbox" | "select"; required?: boolean; options?: string[]; rows?: number };

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "consultants", label: "Recruitment Consultants" },
  { id: "subscriptions", label: "Job Board Subscriptions" },
  { id: "invoices", label: "Invoices & Payments" },
  { id: "renewals", label: "Renewals & Reminders" },
  { id: "cost", label: "Cost Per Hire Analytics" },
  { id: "budgets", label: "Recruitment Budget" },
];

const FORM_FIELDS: Record<Resource, Field[]> = {
  consultants: [
    { key: "name", label: "Consultant / Agency Name", required: true }, { key: "contactPerson", label: "Contact Person", required: true },
    { key: "email", label: "Email Address", kind: "email", required: true }, { key: "mobile", label: "Mobile Number" },
    { key: "alternateContact", label: "Alternate Contact" }, { key: "address", label: "Registered Address", kind: "textarea" },
    { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "website", label: "Website" },
    { key: "specialization", label: "Specialization (comma-separated)" }, { key: "hiringLocations", label: "Hiring Locations (comma-separated)" },
    { key: "feeType", label: "Fee Type", kind: "select", required: true, options: ["Percentage of Annual CTC", "Fixed Amount Per Hire"] },
    { key: "defaultFee", label: "Default Fee % / Amount", kind: "number", required: true }, { key: "feeCalculationBasis", label: "Fee Calculation Basis" },
    { key: "paymentTerms", label: "Payment Terms" }, { key: "invoiceDueDays", label: "Invoice Due Days", kind: "number" },
    { key: "replacementGuaranteeDays", label: "Replacement Guarantee Days", kind: "number" }, { key: "freeReplacements", label: "Free Replacements", kind: "number" },
    { key: "feeCap", label: "Fee Cap", kind: "number" }, { key: "gstApplicable", label: "GST Applicable", kind: "checkbox" },
    { key: "gstNumber", label: "GST Number" }, { key: "pan", label: "PAN" }, { key: "bankDetails", label: "Bank Details (optional)", kind: "textarea" },
    { key: "agreementStartDate", label: "Agreement Start Date", kind: "date" }, { key: "agreementExpiryDate", label: "Agreement Expiry Date", kind: "date" },
    { key: "agreementStatus", label: "Agreement Status", kind: "select", options: ["Active", "Expired", "Pending"] },
    { key: "renewalReminderDays", label: "Renewal Reminder Days (comma-separated)" }, { key: "agreementRemarks", label: "Agreement Remarks", kind: "textarea" },
    { key: "internalNotes", label: "Internal Notes", kind: "textarea" }, { key: "status", label: "Status", kind: "select", required: true, options: ["Active", "Inactive", "Expired", "Blacklisted"] },
  ],
  subscriptions: [
    { key: "platformName", label: "Platform Name", required: true }, { key: "subscriptionType", label: "Subscription Type" },
    { key: "reference", label: "Subscription ID / Reference" }, { key: "cost", label: "Subscription Cost (INR)", kind: "number", required: true },
    { key: "billingFrequency", label: "Billing Frequency", kind: "select", options: ["Monthly", "Quarterly", "Annual", "One-time"] },
    { key: "startDate", label: "Subscription Start Date", kind: "date", required: true }, { key: "expiryDate", label: "Subscription Expiry Date", kind: "date", required: true },
    { key: "renewalDate", label: "Renewal Date", kind: "date" }, { key: "licensesPurchased", label: "Licenses Purchased", kind: "number" },
    { key: "assignedRecruiterEmails", label: "Assigned Recruiter Emails (comma-separated)" }, { key: "resumeCredits", label: "Resume Credits (manual reference)", kind: "number" },
    { key: "postingCredits", label: "Job Posting Credits (manual reference)", kind: "number" }, { key: "accountManager", label: "Account Manager" },
    { key: "accountManagerEmail", label: "Account Manager Email", kind: "email" }, { key: "accountManagerContact", label: "Account Manager Contact" },
    { key: "paymentStatus", label: "Payment Status", kind: "select", options: ["Pending", "Partially Paid", "Paid", "Overdue", "Cancelled"] },
    { key: "autoRenew", label: "Auto-renewal", kind: "checkbox" }, { key: "status", label: "Status", kind: "select", options: ["Active", "Inactive", "Expired"] },
    { key: "notes", label: "Notes", kind: "textarea" },
  ],
  invoices: [
    { key: "invoiceNumber", label: "Invoice Number", required: true }, { key: "consultantId", label: "Consultant ID" },
    { key: "candidateId", label: "Candidate ID" }, { key: "placementFeeId", label: "Placement Reference" },
    { key: "invoiceDate", label: "Invoice Date", kind: "date", required: true }, { key: "amount", label: "Invoice Amount", kind: "number", required: true },
    { key: "taxAmount", label: "Tax Amount", kind: "number" }, { key: "totalAmount", label: "Total Invoice Amount", kind: "number" },
    { key: "dueDate", label: "Due Date", kind: "date", required: true }, { key: "paymentStatus", label: "Payment Status", kind: "select", options: ["Pending", "Partially Paid", "Paid", "Overdue", "Cancelled"] },
    { key: "amountPaid", label: "Amount Paid", kind: "number" }, { key: "paymentDate", label: "Payment Date", kind: "date" },
    { key: "paymentReference", label: "Payment Reference" }, { key: "notes", label: "Notes", kind: "textarea" },
  ],
  placementFees: [
    { key: "candidateName", label: "Candidate" }, { key: "requisitionTitle", label: "Position" }, { key: "annualCtc", label: "Annual CTC", kind: "number" },
    { key: "feeValue", label: "Fee % / Amount", kind: "number" }, { key: "actualFee", label: "Confirmed Fee", kind: "number" },
    { key: "adjustmentReason", label: "Adjustment Reason", kind: "textarea" }, { key: "status", label: "Status", kind: "select", options: ["Estimated", "Confirmed", "Invoiced", "Cancelled"] },
  ],
  guarantees: [
    { key: "candidateName", label: "Candidate" }, { key: "joiningDate", label: "Joining Date", kind: "date" },
    { key: "expiryDate", label: "Guarantee Expiry", kind: "date" }, { key: "status", label: "Status", kind: "select", options: ["Active", "Potentially Eligible", "Replacement Requested", "Replacement In Progress", "Replacement Completed", "Expired", "Not Applicable"] },
    { key: "requestReason", label: "Replacement Request Reason", kind: "textarea" },
  ],
  expenses: [
    { key: "category", label: "Expense Category", kind: "select", required: true, options: ["Recruitment Advertising", "Campus Recruitment", "Assessment / Interview", "Other Recruitment Expenses"] },
    { key: "description", label: "Expense Description", required: true }, { key: "amount", label: "Amount (INR)", kind: "number", required: true },
    { key: "expenseDate", label: "Expense Date", kind: "date", required: true }, { key: "department", label: "Department" }, { key: "location", label: "Location" },
    { key: "recruitmentSource", label: "Recruitment Source" },
    { key: "estimated", label: "Estimated (not invoiced/paid)", kind: "checkbox" }, { key: "notes", label: "Notes", kind: "textarea" },
  ],
  budgets: [
    { key: "name", label: "Budget Name", required: true }, { key: "type", label: "Budget Type", kind: "select", required: true, options: ["Monthly", "Quarterly", "Annual"] },
    { key: "amount", label: "Allocated Budget (INR)", kind: "number", required: true }, { key: "startDate", label: "Start Date", kind: "date", required: true },
    { key: "endDate", label: "End Date", kind: "date", required: true }, { key: "department", label: "Department (optional)" }, { key: "location", label: "Location (optional)" },
    { key: "alertThresholds", label: "Alert Thresholds (comma-separated % )" },
  ],
  feeRules: [
    { key: "vendorId", label: "Consultant ID", required: true }, { key: "title", label: "Role / Position" }, { key: "requisitionId", label: "Requisition ID" },
    { key: "department", label: "Department" }, { key: "feeType", label: "Fee Type", kind: "select", options: ["Percentage of Annual CTC", "Fixed Amount Per Hire"] },
    { key: "fee", label: "Fee % / Amount", kind: "number", required: true }, { key: "feeCap", label: "Fee Cap", kind: "number" },
    { key: "effectiveFrom", label: "Effective From", kind: "date", required: true }, { key: "effectiveTo", label: "Effective To", kind: "date" },
  ],
};

const TABLE_FIELDS: Record<Resource, { key: string; label: string }[]> = {
  consultants: [{ key: "id", label: "Vendor ID" }, { key: "name", label: "Consultant" }, { key: "specialization", label: "Specialization" }, { key: "contactPerson", label: "Contact" }, { key: "fee", label: "Fee Structure" }, { key: "agreementExpiryDate", label: "Agreement Expiry" }, { key: "status", label: "Status" }],
  subscriptions: [{ key: "platformName", label: "Platform" }, { key: "subscriptionType", label: "Type" }, { key: "cost", label: "Cost" }, { key: "billingFrequency", label: "Billing" }, { key: "renewalDate", label: "Renewal" }, { key: "licensesPurchased", label: "Licenses" }, { key: "paymentStatus", label: "Payment" }, { key: "status", label: "Status" }],
  invoices: [{ key: "invoiceNumber", label: "Invoice" }, { key: "consultantId", label: "Consultant ID" }, { key: "candidateId", label: "Candidate" }, { key: "invoiceDate", label: "Invoice Date" }, { key: "totalAmount", label: "Total" }, { key: "dueDate", label: "Due Date" }, { key: "paymentStatus", label: "Payment" }],
  placementFees: [{ key: "candidateName", label: "Candidate" }, { key: "requisitionTitle", label: "Position" }, { key: "consultantId", label: "Consultant ID" }, { key: "joiningDate", label: "Joined" }, { key: "annualCtc", label: "Annual CTC" }, { key: "expectedFee", label: "Expected Fee" }, { key: "status", label: "Status" }],
  guarantees: [{ key: "candidateName", label: "Candidate" }, { key: "consultantId", label: "Consultant ID" }, { key: "joiningDate", label: "Joined" }, { key: "expiryDate", label: "Guarantee Expiry" }, { key: "daysRemaining", label: "Days Remaining" }, { key: "status", label: "Status" }],
  expenses: [{ key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "amount", label: "Amount" }, { key: "expenseDate", label: "Date" }, { key: "department", label: "Department" }, { key: "estimated", label: "Estimated" }],
  budgets: [{ key: "name", label: "Budget" }, { key: "type", label: "Period" }, { key: "amount", label: "Allocated" }, { key: "startDate", label: "From" }, { key: "endDate", label: "To" }, { key: "department", label: "Department" }, { key: "location", label: "Location" }],
  feeRules: [{ key: "vendorId", label: "Consultant" }, { key: "title", label: "Role" }, { key: "requisitionId", label: "Requisition" }, { key: "fee", label: "Fee" }, { key: "effectiveFrom", label: "Effective From" }, { key: "effectiveTo", label: "Effective To" }],
};

function currency(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount) : "—";
}

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString() : value;
}

function fieldValue(key: string, value: unknown) {
  if (["cost", "amount", "taxAmount", "totalAmount", "amountPaid", "expectedFee", "actualFee", "annualCtc"].includes(key)) return currency(value);
  if (["startDate", "endDate", "expiryDate", "renewalDate", "agreementExpiryDate", "agreementStartDate", "invoiceDate", "dueDate", "expenseDate", "joiningDate", "effectiveFrom", "effectiveTo"].includes(key)) return dateLabel(value);
  if (Array.isArray(value)) return value.join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "—");
}

function toFormValue(field: Field, value: unknown) {
  if (field.kind === "checkbox") return value === true;
  if (Array.isArray(value)) return value.join(", ");
  return value === undefined || value === null ? "" : String(value);
}

function normalizeFormData(resource: Resource, values: Record<string, string | boolean>) {
  const data: Record<string, unknown> = { ...values };
  for (const field of FORM_FIELDS[resource]) {
    const value = data[field.key];
    if (field.kind === "number") data[field.key] = value === "" ? undefined : Number(value);
    if (field.kind !== "checkbox" && typeof value === "string" && ["specialization", "hiringLocations", "assignedRecruiterEmails", "renewalReminderDays", "alertThresholds"].includes(field.key)) {
      const values = value.split(",").map((part) => part.trim()).filter(Boolean);
      data[field.key] = ["renewalReminderDays", "alertThresholds"].includes(field.key) ? values.map(Number) : values;
    }
  }
  return data;
}

export function VendorsSpendView({
  data,
  requisitions,
  role,
  apiFetch,
  onOpenCandidate,
  onRefresh,
  onMessage,
}: {
  data: Record<string, unknown> | null;
  requisitions: Requisition[];
  role: Role;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onOpenCandidate: (candidateId: string) => void;
  onRefresh: () => void;
  onMessage: (message: string) => void;
}) {
  const isAdmin = role === "Admin";
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, unknown> | null>(null);
  const [sectionReminders, setSectionReminders] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const recordLoadId = useRef(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [formResource, setFormResource] = useState<Resource>("consultants");
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [expenseRequests, setExpenseRequests] = useState<string[]>([]);
  const [expenseRequestSearch, setExpenseRequestSearch] = useState("");
  const [invoiceSubscriptions, setInvoiceSubscriptions] = useState<RecordRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [uploadingField, setUploadingField] = useState("");
  const [vendorProfile, setVendorProfile] = useState<Record<string, unknown> | null>(null);
  const [profileTab, setProfileTab] = useState<ConsultantProfileTab>("Overview");

  const resourceBySection: Partial<Record<Section, Resource>> = {
    consultants: "consultants", subscriptions: "subscriptions", invoices: "invoices", budgets: "budgets",
  };
  const loadRecords = useCallback(async (targetSection: Section) => {
    const loadId = ++recordLoadId.current;
    const resource = resourceBySection[targetSection];
    if (!resource) { setRecords([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await apiFetch(`/api/vendors-spend?resource=${resource}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load Vendors & Spend records.");
      if (loadId === recordLoadId.current) setRecords(result.records || []);
    } catch (cause) {
      if (loadId === recordLoadId.current) setError(cause instanceof Error ? cause.message : "Could not load records.");
    } finally {
      if (loadId === recordLoadId.current) setLoading(false);
    }
  // resourceBySection is static and intentionally not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  useEffect(() => { void loadRecords(section); }, [loadRecords, section]);
  useEffect(() => {
    if (!showForm || formResource !== "invoices") return;
    let active = true;
    apiFetch("/api/vendors-spend?resource=subscriptions").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load subscriptions."); if (active) setInvoiceSubscriptions(data.records || []); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load subscriptions."); });
    return () => { active = false; };
  }, [apiFetch, showForm, formResource]);
  useEffect(() => {
    if (section !== "cost" && section !== "renewals") return;
    let active = true;
    setLoading(true);
    setError("");
    const resource = section === "cost" ? "costAnalytics" : "reminders";
    apiFetch(`/api/vendors-spend?resource=${resource}`).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load this section.");
      if (!active) return;
      if (section === "cost") setAnalytics(result);
      else setSectionReminders(result.reminders || []);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load this section."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiFetch, section]);
  useEffect(() => setPage(1), [search, section, pageSize]);

  const reminders = (data?.reminders as RecordRow[] | undefined) || [];
  const topConsultants = (data?.topConsultants as RecordRow[] | undefined) || [];
  const tableFields = resourceBySection[section] ? TABLE_FIELDS[resourceBySection[section]!] : [];
  const visibleRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => !query || Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(query)));
  }, [records, search]);
  const pageCount = Math.max(1, Math.ceil(visibleRecords.length / pageSize));
  const pageRecords = visibleRecords.slice((page - 1) * pageSize, page * pageSize);

  async function reload() {
    await loadRecords(section);
    onRefresh();
  }

  function startCreate(resource: Resource) {
    setFormResource(resource);
    setEditing(null);
    setForm({});
    setExpenseRequests([]);
    setExpenseRequestSearch("");
    setError("");
    setShowForm(true);
  }

  function startEdit(resource: Resource, record: RecordRow) {
    setFormResource(resource);
    setEditing(record);
    setForm(Object.fromEntries(FORM_FIELDS[resource].map((field) => [field.key, toFormValue(field, record[field.key])] )));
    if (resource === "invoices" && typeof record.subscriptionId === "string") setForm((current) => ({ ...current, subscriptionId: record.subscriptionId as string }));
    setExpenseRequests(Array.isArray(record.requisitionIds) ? record.requisitionIds.filter((id): id is string => typeof id === "string") : typeof record.requisitionId === "string" && record.requisitionId ? [record.requisitionId] : []);
    setExpenseRequestSearch("");
    setError("");
    setShowForm(true);
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = formResource === "placementFees" ? "placementFees" : formResource;
      const payload = normalizeFormData(formResource, form);
      if (formResource === "expenses") { payload.requisitionIds = expenseRequests; payload.requisitionId = ""; }
      const response = await apiFetch("/api/vendors-spend", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing
          ? { resource: endpoint, id: editing.id, data: payload }
          : { resource: endpoint, data: payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the record.");
      setShowForm(false);
      onMessage(editing ? "Record updated." : "Record saved.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the record.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(resource: Resource, record: RecordRow) {
    if (!window.confirm(`Deactivate ${String(record.name || record.platformName || "this record")}? Existing records will be preserved.`)) return;
    const response = await apiFetch(`/api/vendors-spend?resource=${resource}&id=${encodeURIComponent(record.id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) setError(result.error || "Could not deactivate the record.");
    else await reload();
  }

  async function exportRecords(resource: Resource, rows: RecordRow[], filename: string) {
    const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({ ...row })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, resource.slice(0, 31));
    XLSX.writeFile(workbook, `lt-recruitment-project-${filename}.xlsx`);
  }

  async function uploadAttachment(field: "agreement" | "invoice", file: File | undefined, fieldPrefix: string) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Vendor documents must be smaller than 10 MB.");
      return;
    }
    setUploadingField(fieldPrefix);
    setError("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read selected document."));
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.readAsDataURL(file);
      });
      const response = await apiFetch("/api/vendors-spend/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: field, fileName: file.name, mime: file.type, base64 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not upload document.");
      setForm((current) => ({ ...current, [`${fieldPrefix}Path`]: result.path, [`${fieldPrefix}FileName`]: result.fileName }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload document.");
    } finally {
      setUploadingField("");
    }
  }

  function addAction() {
    if (section === "consultants") startCreate("consultants");
    else if (section === "subscriptions") startCreate("subscriptions");
    else if (section === "invoices") startCreate("invoices");
    else if (section === "budgets") startCreate("budgets");
    else if (section === "overview") startCreate("expenses");
  }

  const moneyCard = (label: string, value: unknown, hint: string) => (
    <div className="ats-vs-kpi"><span>{label}</span><strong>{value === null ? "N/A" : currency(value)}</strong><small>{hint}</small></div>
  );

  const listSection = section === "consultants" || section === "subscriptions" || section === "invoices" || section === "budgets";

  async function openConsultantProfile(record: RecordRow) {
    setError("");
    setProfileTab("Overview");
    try {
      const response = await apiFetch(`/api/vendors-spend?resource=vendorProfile&id=${encodeURIComponent(record.id)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load consultant profile.");
      setVendorProfile(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load consultant profile.");
    }
  }

  return (
    <section className="ats-vendors-spend">
      <header className="ats-vs-heading">
        <div><span className="ats-vs-eyebrow">LT RECRUITMENT PROJECT · OPERATIONS</span><h2>Vendors &amp; Spend</h2><p>Manage recruitment partners, subscriptions, and operating costs.</p></div>
        {isAdmin && <div className="ats-vs-quick-actions"><button type="button" onClick={() => startCreate("consultants")}>＋ Add Consultant</button><button type="button" onClick={() => startCreate("subscriptions")}>＋ Add Subscription</button><button type="button" onClick={() => startCreate("expenses")}>＋ Add Expense</button></div>}
      </header>
      <nav className="ats-vs-tabs" aria-label="Vendors & Spend sections" role="tablist">
        {SECTIONS.filter((item) => isAdmin || !["invoices", "cost", "budgets"].includes(item.id)).map((item) => <button key={item.id} type="button" role="tab" aria-selected={section === item.id} className={section === item.id ? "is-active" : ""} onClick={() => { setError(""); setSection(item.id); }}>{item.label}</button>)}
      </nav>
      {error && <div className="ats-vs-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div>}

      {section === "overview" && <>
        <div className="ats-vs-filters">
          <label>Date from<DateTimeField type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>Date to<DateTimeField type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          <label>Department<input placeholder="All departments" /></label><label>Location<input placeholder="All locations" /></label><label>Recruitment source<input placeholder="All sources" /></label>
        </div>
        <div className="ats-vs-kpis">
          <div className="ats-vs-kpi"><span>Active Recruitment Consultants</span><strong>{String(data?.activeConsultants ?? 0)}</strong><small>Currently available</small></div>
          <div className="ats-vs-kpi"><span>Active Job Board Subscriptions</span><strong>{String(data?.activeSubscriptions ?? 0)}</strong><small>Manually managed</small></div>
          {isAdmin && moneyCard("Monthly Recruitment Spend", data?.monthlySpend, `${String(data?.successfulHires ?? 0)} successful hires in data`)}
          {isAdmin && moneyCard("Average Cost Per Hire", data?.averageCostPerHire, "Based on recorded applicable costs")}
        </div>
        <div className="ats-vs-overview-grid">
          <section className="ats-vs-panel"><header><h3>Monthly Recruitment Spending</h3><span>Recorded expenses by category</span></header>
            {((data?.monthlyTrend as RecordRow[] | undefined) || []).length ? <div className="ats-vs-bars">{((data?.monthlyTrend as RecordRow[] | undefined) || []).map((item) => <div key={String(item.label)}><span>{String(item.label)}</span><i><b style={{ width: `${Math.max(2, (Number(item.value) / Math.max(1, ...((data?.monthlyTrend as RecordRow[] | undefined) || []).map((row) => Number(row.value)))) * 100)}%` }} /></i><strong>{currency(item.value)}</strong></div>)}</div> : <div className="ats-vs-empty">No recruitment expenses recorded for this period.</div>}
          </section>
          <section className="ats-vs-panel"><header><h3>Upcoming Renewals &amp; Payment Reminders</h3><button type="button" onClick={() => setSection("renewals")}>View all</button></header>
            {reminders.slice(0, 5).length ? <div className="ats-vs-reminders">{reminders.slice(0, 5).map((item) => <article key={item.id}><b>{String(item.entityName)}</b><span>{String(item.type)} · {String(item.daysRemaining)} days · {dateLabel(item.dueDate)}</span></article>)}</div> : <div className="ats-vs-empty">No upcoming renewals or payment reminders.</div>}
          </section>
          <section className="ats-vs-panel"><header><h3>Top Performing Recruitment Consultants</h3><button type="button" onClick={() => setSection("consultants")}>View consultants</button></header>
            {topConsultants.length ? <div className="ats-vs-reminders">{topConsultants.slice(0, 5).map((item) => <article key={String(item.vendorId)}><b>{String(item.consultantName)}</b><span>{String(item.submitted)} submitted · {String(item.joined)} joined · {Number(item.conversion || 0).toFixed(1)}% conversion</span></article>)}</div> : <div className="ats-vs-empty">Consultant performance appears after sourced candidates are tracked.</div>}
          </section>
          {isAdmin && <section className="ats-vs-panel"><header><h3>Recruitment Cost Breakdown by Source</h3><button type="button" onClick={() => setSection("cost")}>Open analytics</button></header>
            {((data?.sourceBreakdown as RecordRow[] | undefined) || []).length ? <div className="ats-vs-reminders">{((data?.sourceBreakdown as RecordRow[] | undefined) || []).map((item) => <article key={String(item.source)}><b>{String(item.source)}</b><strong>{currency(item.value)}</strong></article>)}</div> : <div className="ats-vs-empty">No recruitment expense data has been recorded.</div>}
          </section>}
        </div>
      </>}

      {section === "renewals" && <section className="ats-vs-panel"><header><h3>Renewals &amp; Reminders</h3><span>Generated from saved agreement, renewal, invoice, and guarantee due dates</span></header>
        {loading ? <div className="ats-vs-empty">Loading reminders…</div> : sectionReminders.length ? <div className="ats-vs-reminders">{sectionReminders.map((item) => <article key={item.id}><b>{String(item.entityName)}</b><span>{String(item.type)} · due {dateLabel(item.dueDate)} · {String(item.daysRemaining)} days remaining</span>{item.amount !== undefined && <strong>{currency(item.amount)}</strong>}</article>)}</div> : !error && <div className="ats-vs-empty">No upcoming reminders. Add agreements, subscriptions, invoices, or placements with due dates to see reminders here.</div>}
      </section>}

      {section === "cost" && isAdmin && (loading ? <div className="ats-vs-empty">Loading cost analytics…</div> : analytics && <><div className="ats-vs-kpis ats-vs-cost-kpis">
        <div className="ats-vs-kpi"><span>Overall Cost Per Hire</span><strong>{analytics.overallCostPerHire === null ? "N/A" : currency(analytics.overallCostPerHire)}</strong><small>{String(analytics.successfulHires || 0)} unique hires · no offers counted as hires</small></div>
        <div className="ats-vs-kpi"><span>Total Recorded Cost</span><strong>{currency(analytics.totalCost)}</strong><small>Expenses, fees, subscriptions, and referrals</small></div>
        <div className="ats-vs-kpi"><span>Consultant Conversions</span><strong>{topConsultants.reduce((sum, item) => sum + Number(item.joined || 0), 0)}</strong><small>Based on application source records</small></div>
        <button type="button" className="ats-vs-export" onClick={() => { const rows = (analytics.costItems as RecordRow[] | undefined) || []; void exportRecords("expenses", rows, "cost-per-hire"); }}>Export Cost Analytics</button>
      </div><section className="ats-vs-panel"><header><h3>Cost by hiring request</h3><span>Shared expenses are split equally between selected requests.</span></header><p>Unallocated shared costs: <strong>{currency(analytics.unallocatedSharedCost)}</strong> · Included in overall costs, but not assigned to a request.</p>{((analytics.requestCosts as RecordRow[] | undefined) || []).length ? <div className="ats-vs-table-scroll"><table className="ats-vs-table"><thead><tr><th>Request</th><th>Direct cost</th><th>Shared cost</th><th>Allocated total</th><th>Hires</th><th>Cost per hire</th></tr></thead><tbody>{(analytics.requestCosts as RecordRow[]).map((item) => <tr key={item.id}><td><strong>{String(item.title)}</strong><br /><small>{item.id}</small></td><td>{currency(item.directCost)}</td><td>{currency(item.sharedCost)}</td><td>{currency(item.cost)}</td><td>{String(item.hires)}</td><td>{item.costPerHire === null ? "N/A" : currency(item.costPerHire)}</td></tr>)}</tbody></table></div> : <div className="ats-vs-empty">No request costs or hires recorded yet.</div>}</section><section className="ats-vs-panel"><header><h3>Cost by recruitment source</h3></header>{((analytics.sourceWise as RecordRow[] | undefined) || []).length ? <div className="ats-vs-reminders">{((analytics.sourceWise as RecordRow[]) || []).map((item, index) => <article key={index}><b>{String(item.label)}</b><strong>{currency(item.cost)}</strong></article>)}</div> : <div className="ats-vs-empty">No recruitment costs recorded yet.</div>}</section></>)}

      {listSection && <section className="ats-vs-panel ats-vs-record-panel">
        <header><div><h3>{SECTIONS.find((item) => item.id === section)?.label}</h3><span>{visibleRecords.length} records</span></div><div className="ats-vs-record-actions"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records" aria-label="Search records" />{isAdmin && <button type="button" onClick={() => void exportRecords(resourceBySection[section]!, visibleRecords, section)}>Export Excel</button>}{(isAdmin || section === "invoices") && <button type="button" onClick={addAction}>＋ Add {section === "consultants" ? "Consultant" : section === "subscriptions" ? "Subscription" : section === "invoices" ? "Invoice" : "Budget"}</button>}</div></header>
        {loading ? <div className="ats-vs-empty">Loading records…</div> : pageRecords.length ? <div className="ats-vs-table-scroll"><table className="ats-vs-table"><thead><tr>{tableFields.map((field) => <th key={field.key}>{field.label}</th>)}<th>Actions</th></tr></thead><tbody>{pageRecords.map((record) => {
          const rowCandidateId = typeof record.candidateId === "string" ? record.candidateId : "";
          const rowStatus = typeof record.status === "string" ? record.status : "";
          return <tr key={record.id}>
          {tableFields.map((field) => <td key={field.key}>{field.key === "name" || field.key === "platformName" ? <strong>{String(record[field.key] || "—")}</strong> : field.key === "fee" ? `${String(record.feeType || "")}: ${currency(record.defaultFee ?? record.fee)}` : fieldValue(field.key, record[field.key])}</td>)}
          <td><div className="ats-vs-row-actions">{section === "consultants" && <button type="button" onClick={() => void openConsultantProfile(record)}>View</button>}{section === "consultants" && <button type="button" onClick={() => setSection("cost")}>Performance</button>}{section === "invoices" && rowCandidateId && <button type="button" onClick={() => onOpenCandidate(rowCandidateId)}>Candidate</button>}{(isAdmin || section === "invoices") && <button type="button" onClick={() => startEdit(resourceBySection[section]!, record)}>Edit</button>}{isAdmin && ["consultants", "subscriptions"].includes(section) && rowStatus === "Active" && <button type="button" onClick={() => void deactivate(resourceBySection[section]!, record)}>Deactivate</button>}</div></td>
        </tr>;
        })}</tbody></table></div> : <div className="ats-vs-empty">{loading ? "Loading…" : "No records yet. Add a record to begin tracking this section."}</div>}
        <footer className="ats-vs-pagination"><span>{visibleRecords.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visibleRecords.length)} of ${visibleRecords.length}` : "0 records"}</span><label>Rows<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>{page} / {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></footer>
      </section>}

      {vendorProfile && <div className="ats-vs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setVendorProfile(null); }}><section className="ats-vs-profile-modal" role="dialog" aria-modal="true" aria-labelledby="ats-vs-profile-title">
        <header><div><span>CONSULTANT PROFILE</span><h3 id="ats-vs-profile-title">{String((vendorProfile.vendor as Record<string, unknown>)?.name || "Consultant")}</h3><small>{String((vendorProfile.vendor as Record<string, unknown>)?.id || "")}</small></div><button type="button" aria-label="Close profile" onClick={() => setVendorProfile(null)}>×</button></header>
        <nav className="ats-vs-profile-tabs">{(["Overview", ...(isAdmin ? ["Commercial Terms"] : []), "Candidates", "Invoices", ...(isAdmin ? ["Agreements"] : []), "Performance"] as ConsultantProfileTab[]).map((item) => <button key={item} type="button" className={profileTab === item ? "is-active" : ""} onClick={() => setProfileTab(item)}>{item}</button>)}</nav>
        {profileTab === "Overview" && <div className="ats-vs-profile-grid">{Object.entries(vendorProfile.vendor as Record<string, unknown>).filter(([key, value]) => value !== undefined && value !== "" && !["bankDetails", "pan", "gstNumber", "defaultFee", "feeType", "paymentTerms", "feeCap"].includes(key)).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{fieldValue(key, value)}</strong></div>)}</div>}
        {profileTab === "Commercial Terms" && isAdmin && <div className="ats-vs-profile-grid">{["feeType", "defaultFee", "feeCalculationBasis", "paymentTerms", "invoiceDueDays", "replacementGuaranteeDays", "freeReplacements", "feeCap", "gstApplicable", "gstNumber", "pan", "bankDetails"].map((key) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{fieldValue(key, (vendorProfile.vendor as Record<string, unknown>)[key])}</strong></div>)}<button type="button" onClick={() => startCreate("feeRules")}>＋ Add role / requisition fee</button></div>}
        {profileTab === "Candidates" && <div className="ats-vs-profile-list">{((vendorProfile.candidates as RecordRow[] | undefined) || []).length ? ((vendorProfile.candidates as RecordRow[]).map((row) => <article key={row.id}><button type="button" onClick={() => { setVendorProfile(null); onOpenCandidate(String((row.candidate as Record<string, unknown>)?.id || row.candidateId)); }}><strong>{String((row.candidate as Record<string, unknown>)?.name || "Candidate")}</strong></button><span>{String((row.requisition as Record<string, unknown>)?.title || row.requisitionId)} · {String((row.candidate as Record<string, unknown>)?.stage || "")}</span><small>{dateLabel(row.submittedAt)}</small></article>)) : <div className="ats-vs-empty">No candidates attributed to this consultant.</div>}</div>}
        {profileTab === "Invoices" && <div className="ats-vs-profile-list">{((vendorProfile.invoices as RecordRow[] | undefined) || []).map((row) => <article key={row.id}><strong>{String(row.invoiceNumber)}</strong><span>{dateLabel(row.invoiceDate)} · due {dateLabel(row.dueDate)} · {String(row.paymentStatus || "Uploaded")}</span>{isAdmin && <b>{currency(row.totalAmount)}</b>}</article>)}</div>}
        {profileTab === "Agreements" && isAdmin && <div className="ats-vs-profile-list">{((vendorProfile.agreements as RecordRow[] | undefined) || []).map((row) => <article key={row.id}><strong>{dateLabel(row.startDate)} – {dateLabel(row.expiryDate)}</strong><span>{String(row.feeType)} · {currency(row.defaultFee)}</span></article>)}</div>}
        {profileTab === "Performance" && <div className="ats-vs-profile-grid">{Object.entries(vendorProfile.stats as Record<string, unknown>).filter(([key]) => isAdmin || !["totalPlacementFees"].includes(key)).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, " $1")}</span><strong>{key.toLowerCase().includes("conversion") ? value === null ? "N/A" : `${Number(value).toFixed(1)}%` : key.toLowerCase().includes("fees") ? currency(value) : value === null ? "N/A" : String(value)}</strong></div>)}</div>}
      </section></div>}

      {showForm && <div className="ats-vs-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !uploadingField) setShowForm(false); }}><form className="ats-vs-modal" role="dialog" aria-modal="true" aria-labelledby="ats-vs-form-title" onSubmit={(event) => void saveRecord(event)} onKeyDown={(event) => { if (event.key === "Escape" && !uploadingField) setShowForm(false); }}>
        <header><div><span>VENDORS &amp; SPEND</span><h3 id="ats-vs-form-title">{editing ? "Edit" : "Add"} {formResource === "consultants" ? "Recruitment Consultant" : formResource === "subscriptions" ? "Job Board Subscription" : formResource === "invoices" ? "Invoice" : formResource === "expenses" ? "Recruitment Expense" : "Recruitment Budget"}</h3></div><button type="button" aria-label="Close" disabled={!!uploadingField} onClick={() => setShowForm(false)}>×</button></header>
        <div className="ats-vs-form-grid">{FORM_FIELDS[formResource].map((field) => <label key={field.key} className={field.kind === "textarea" ? "is-wide" : ""}>{field.label}{field.kind === "checkbox" ? <input type="checkbox" checked={form[field.key] === true} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.checked }))} /> : field.kind === "select" ? <select required={field.required} value={String(form[field.key] || "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Choose…</option>{editing && formResource === "expenses" && field.key === "category" && form[field.key] && !field.options?.includes(String(form[field.key])) && <option value={String(form[field.key])}>{String(form[field.key])} (previously recorded)</option>}{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.kind === "textarea" ? <textarea required={field.required} value={String(form[field.key] || "")} rows={field.rows || 3} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} /> : field.kind === "date" ? <DateTimeField type="date" required={field.required} value={String(form[field.key] || "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input required={field.required} type={field.kind || "text"} min={field.kind === "number" ? 0 : undefined} value={String(form[field.key] || "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div>
        {formResource === "invoices" && <label className="ats-invoice-subscription">Job board subscription (optional)<select value={String(form.subscriptionId || "")} onChange={(event) => setForm((current) => ({ ...current, subscriptionId: event.target.value }))}><option value="">No linked subscription</option>{invoiceSubscriptions.map((item) => <option key={item.id} value={item.id}>{String(item.platformName)} · {String(item.reference || item.id)}{item.status !== "Active" ? ` · ${String(item.status)}` : ""}</option>)}</select><small>Link the subscription so its invoice is not counted twice.</small></label>}
        {formResource === "expenses" && <fieldset className="ats-expense-requests"><legend>Hiring requests <span>(optional)</span></legend><p>Select all requests this expense supports. The cost is split equally; leave empty for a shared expense.</p><input className="ats-expense-request-search" type="search" aria-label="Search hiring requests" placeholder="Search by role, request ID or department" value={expenseRequestSearch} onChange={(event) => setExpenseRequestSearch(event.target.value)} />{expenseRequestSearch.trim() && (() => { const query = expenseRequestSearch.trim().toLowerCase(); const matches = requisitions.filter((req) => !expenseRequests.includes(req.id) && `${req.title} ${req.id} ${req.department}`.toLowerCase().includes(query)).sort((a, b) => Number(![a.title, a.id, a.department].some((value) => value.toLowerCase().startsWith(query))) - Number(![b.title, b.id, b.department].some((value) => value.toLowerCase().startsWith(query)))).slice(0, 3); return <div className="ats-expense-request-suggestions">{matches.length ? matches.map((req) => <button type="button" key={req.id} onClick={() => { setExpenseRequests((current) => [...current, req.id]); setExpenseRequestSearch(""); }}><strong>{req.title}</strong><small>{req.id} · {req.department}</small></button>) : <span>No matching unselected hiring requests.</span>}</div>; })()}{expenseRequests.length > 0 && <div className="ats-expense-selected-requests">{expenseRequests.map((id) => { const req = requisitions.find((item) => item.id === id); return <span key={id}>{req ? `${req.title} · ${id}` : id}<button type="button" aria-label={`Remove ${req?.title || id}`} onClick={() => setExpenseRequests((current) => current.filter((item) => item !== id))}>×</button></span>; })}</div>}{expenseRequests.length > 0 && <small>{expenseRequests.length} selected · {currency(Number(form.amount || 0) / expenseRequests.length)} each, before rounding.</small>}</fieldset>}
        {(formResource === "consultants" || formResource === "subscriptions" || formResource === "invoices") && <div className="ats-vs-upload-grid">
          {(formResource === "consultants" || formResource === "subscriptions") && <label>Agreement document<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" disabled={!!uploadingField} onChange={(event) => { void uploadAttachment("agreement", event.target.files?.[0], "agreement"); event.target.value = ""; }} />{String(form.agreementFileName || "") && <small>{String(form.agreementFileName)}</small>}</label>}
          {(formResource === "subscriptions" || formResource === "invoices") && <label>Invoice document<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" disabled={!!uploadingField} onChange={(event) => { void uploadAttachment("invoice", event.target.files?.[0], formResource === "invoices" ? "attachment" : "invoice"); event.target.value = ""; }} />{String(form.attachmentFileName || form.invoiceFileName || "") && <small>{String(form.attachmentFileName || form.invoiceFileName)}</small>}</label>}
        </div>}
        {formResource === "consultants" && <p className="ats-vs-privacy">PAN, GST and bank fields are visible to Admins only. Agreement history is retained when terms change.</p>}
        {error && <p className="ats-vs-error" role="alert">{error}</p>}
        <footer><button type="button" className="ats-vs-cancel" disabled={!!uploadingField} onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="ats-primary-button" disabled={busy || !!uploadingField}>{uploadingField ? "Uploading…" : busy ? "Saving…" : "Save record"}</button></footer>
      </form></div>}
    </section>
  );
}
