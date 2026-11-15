"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { feedbackFormIssue, normalizeQuestion } from "@/lib/feedbackForms";
import type { FeedbackFormTemplate, OrgSettings, ReferralPayout, Requisition } from "@/lib/types";
import { FeedbackFormEditor } from "./FeedbackFormEditor";
import { CandidateFieldSettings } from "./CandidateFieldSettings";
import { RequisitionOrganizationSettings } from "./RequisitionOrganizationSettings";
import { editableHtmlToInlineFormatting, inlineFormattingToHtml } from "@/lib/inlineFormatting";
import {
  DEFAULT_BACKED_OUT_EMAIL_BODY,
  DEFAULT_BACKED_OUT_EMAIL_SUBJECT,
  DEFAULT_REJECTION_EMAIL_BODY,
  DEFAULT_REJECTION_EMAIL_SUBJECT,
} from "@/lib/rejectionEmail";

type AdminReferralPayout = ReferralPayout & { requisitionTitle: string };
type ReferralSettingsRequisition = Requisition & { hasEmployeeReferrals?: boolean };

const fieldStyle = {
  width: "100%",
  minHeight: 40,
  padding: "9px 10px",
  border: "1px solid #cad5e2",
  borderRadius: 5,
  background: "#fff",
  color: "#26374b",
  fontSize: 13,
  fontWeight: 400,
} as const;

const labelStyle = {
  display: "grid",
  gap: 6,
  marginTop: 16,
  color: "#46576c",
  fontSize: 12,
  fontWeight: 650,
} as const;

function formatMoneyForSettings(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

export function AdminSettingsView({
  org,
  apiFetch,
  onSaved,
  requisitions,
  onRefreshRequisitions,
  teams,
  section,
  onSectionChange,
}: {
  org: OrgSettings | null;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onSaved: (org: OrgSettings) => void;
  requisitions: ReferralSettingsRequisition[];
  onRefreshRequisitions: () => void;
  teams: ReactNode;
  section: "company" | "teams" | "workflow" | "addons" | "modules" | "integrations";
  onSectionChange: (section: "company" | "teams" | "workflow" | "addons" | "modules" | "integrations") => void;
}) {
  const [workflowArea, setWorkflowArea] = useState<"organization" | "candidate" | "numbering" | "feedback" | "emails">("organization");
  const [integrationSaving, setIntegrationSaving] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{ ai: boolean; email: boolean; scheduler: boolean; calendar: boolean } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [company, setCompany] = useState("");
  const [officeName, setOfficeName] = useState("");
  const [officeCity, setOfficeCity] = useState("");
  const [officeAddress, setOfficeAddress] = useState("");
  const [editingOffice, setEditingOffice] = useState<number | null>(null);
  const [offices, setOffices] = useState<NonNullable<OrgSettings["officeLocations"]>>([]);
  const [officeMessage, setOfficeMessage] = useState("");
  const [officeSaving, setOfficeSaving] = useState(false);
  const [shareCompanyOnSocialLinks, setShareCompanyOnSocialLinks] = useState(true);
  const [logoUrl, setLogoUrl] = useState("");
  const [story, setStory] = useState("");
  const [foundedYear, setFoundedYear] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [feedbackForms, setFeedbackForms] = useState<FeedbackFormTemplate[]>([]);
  const [editingFeedbackForm, setEditingFeedbackForm] = useState<FeedbackFormTemplate | null>(null);
  useEffect(() => { setEditingFeedbackForm(null); }, [section]);
  useEffect(() => {
    if (section !== "integrations") return;
    let cancelled = false;
    setConnectionStatus(null); setConnectionError("");
    Promise.all([apiFetch("/api/automations"), apiFetch("/api/health")]).then(async ([automation, health]) => {
      if (!automation.ok || !health.ok) throw new Error("Could not check connection status.");
      const [a, h] = await Promise.all([automation.json(), health.json()]);
      if (!cancelled) setConnectionStatus({ ai: !!a.integrations?.ai, email: !!a.integrations?.email, scheduler: !!a.integrations?.scheduler, calendar: !!h.calendarEnabled });
    }).catch((error) => { if (!cancelled) setConnectionError(error instanceof Error ? error.message : "Could not check connection status."); });
    return () => { cancelled = true; };
  }, [apiFetch, section]);
  const [rejectionEmailSubject, setRejectionEmailSubject] = useState(DEFAULT_REJECTION_EMAIL_SUBJECT);
  const [rejectionEmailBody, setRejectionEmailBody] = useState(DEFAULT_REJECTION_EMAIL_BODY);
  const [backedOutEmailSubject, setBackedOutEmailSubject] = useState(DEFAULT_BACKED_OUT_EMAIL_SUBJECT);
  const [backedOutEmailBody, setBackedOutEmailBody] = useState(DEFAULT_BACKED_OUT_EMAIL_BODY);
  const [employeeReferralsEnabled, setEmployeeReferralsEnabled] = useState(false);
  const [referralShareSalary, setReferralShareSalary] = useState(false);
  const [referralBonusOverdueDays, setReferralBonusOverdueDays] = useState("30");
  const [offerJoiningEnabled, setOfferJoiningEnabled] = useState(false);
  const [vendorsSpendEnabled, setVendorsSpendEnabled] = useState(false);
  const [vendorsSpendSaving, setVendorsSpendSaving] = useState(false);
  const [confirmDisableOfferJoining, setConfirmDisableOfferJoining] = useState(false);
  const [offerJoiningSaving, setOfferJoiningSaving] = useState(false);
  const [positionDraft, setPositionDraft] = useState<{ id: string; enabled: boolean; joiningBonus: string; interviewBonus: string } | null>(null);
  const [positionSaving, setPositionSaving] = useState<string | null>(null);
  const [positionMessages, setPositionMessages] = useState<Record<string, string>>({});
  const [referralPayouts, setReferralPayouts] = useState<AdminReferralPayout[]>([]);
  const [payoutsLoaded, setPayoutsLoaded] = useState(false);
  const [referralRoleSearch, setReferralRoleSearch] = useState("");
  const [referralRoleFilter, setReferralRoleFilter] = useState("all");
  const [showReferralPayouts, setShowReferralPayouts] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState("");
  const [payoutBusyId, setPayoutBusyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reqPrefix, setReqPrefix] = useState("REQ");
  const [reqNextNumber, setReqNextNumber] = useState("1001");
  const [separateReqSequences, setSeparateReqSequences] = useState(false);
  const [newReqPrefix, setNewReqPrefix] = useState("NEW");
  const [newReqNumber, setNewReqNumber] = useState("1001");
  const [replacementReqPrefix, setReplacementReqPrefix] = useState("REPL");
  const [replacementReqNumber, setReplacementReqNumber] = useState("1001");
  const [sequenceMessage, setSequenceMessage] = useState("");
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const storyInput = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCompany(org?.company || "");
    setOffices(org?.officeLocations || []);
    setReqPrefix(org?.requisitionIdPrefix || "REQ");
    setReqNextNumber(String(org?.requisitionNextNumber ?? 1001));
    setSeparateReqSequences(org?.requisitionSeparateSequences === true);
    setNewReqPrefix(org?.requisitionNewSequence?.prefix || "NEW");
    setNewReqNumber(String(org?.requisitionNewSequence?.nextNumber ?? 1001));
    setReplacementReqPrefix(org?.requisitionReplacementSequence?.prefix || "REPL");
    setReplacementReqNumber(String(org?.requisitionReplacementSequence?.nextNumber ?? 1001));
    setShareCompanyOnSocialLinks(org?.shareCompanyOnSocialLinks !== false);
    setLogoUrl(org?.logoUrl || "");
    const nextStory = org?.story || "";
    setStory(nextStory);
    if (storyInput.current) storyInput.current.innerHTML = inlineFormattingToHtml(nextStory);
    setFoundedYear(org?.foundedYear ? String(org.foundedYear) : "");
    setWebsiteUrl(org?.websiteUrl || "");
    setFeedbackForms((org?.feedbackFormTemplates || []).map((form) => ({ ...form, questions: form.questions.map(normalizeQuestion) })));
    setRejectionEmailSubject(org?.rejectionEmailSubject ?? DEFAULT_REJECTION_EMAIL_SUBJECT);
    setRejectionEmailBody(org?.rejectionEmailBody ?? DEFAULT_REJECTION_EMAIL_BODY);
    setBackedOutEmailSubject(org?.backedOutEmailSubject ?? DEFAULT_BACKED_OUT_EMAIL_SUBJECT);
    setBackedOutEmailBody(org?.backedOutEmailBody ?? DEFAULT_BACKED_OUT_EMAIL_BODY);
    setEmployeeReferralsEnabled(org?.employeeReferralsEnabled === true);
    setReferralShareSalary(org?.referralShareSalary === true);
    setReferralBonusOverdueDays(String(org?.referralBonusOverdueDays ?? 30));
    setOfferJoiningEnabled(org?.offerJoiningEnabled === true);
    setVendorsSpendEnabled(org?.vendorsSpendEnabled === true);
  }, [org]);

  useEffect(() => {
    if (section !== "addons") return;
    let cancelled = false;
    setPayoutsLoaded(false);
    setPayoutMessage("");
    apiFetch("/api/referrals/payouts")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load interview referral payouts.");
        if (!cancelled) { setReferralPayouts(data.payouts || []); setPayoutsLoaded(true); }
      })
      .catch((error) => {
        if (!cancelled) setPayoutMessage(error instanceof Error ? error.message : "Could not load interview referral payouts.");
      });
    return () => { cancelled = true; };
  }, [apiFetch, section]);

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 500 * 1024) {
      setMessage("Logo image must be smaller than 500 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setMessage("Could not read the selected logo.");
    reader.onload = () => {
      setLogoUrl(String(reader.result || ""));
      setMessage("");
    };
    reader.readAsDataURL(file);
  }

  function updateStory() {
    if (storyInput.current) setStory(editableHtmlToInlineFormatting(storyInput.current));
  }

  async function saveRequisitionSequence() {
    setSequenceBusy(true); setSequenceMessage("");
    try {
      const response = await apiFetch("/api/org", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setRequisitionSequence", separate: separateReqSequences, prefix: reqPrefix, nextNumber: Number(reqNextNumber), newSequence: { prefix: newReqPrefix, nextNumber: Number(newReqNumber) }, replacementSequence: { prefix: replacementReqPrefix, nextNumber: Number(replacementReqNumber) } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save requisition numbering.");
      onSaved(data.org as OrgSettings);
      setSequenceMessage("Requisition numbering saved.");
    } catch (error) { setSequenceMessage(error instanceof Error ? error.message : "Could not save requisition numbering."); }
    finally { setSequenceBusy(false); }
  }

  async function saveOffices(next: NonNullable<OrgSettings["officeLocations"]>) {
    setOfficeSaving(true); setOfficeMessage("");
    try {
      const response = await apiFetch("/api/org", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setOfficeLocations", locations: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save office locations.");
      onSaved(data.org as OrgSettings);
      setOffices(next); setOfficeName(""); setOfficeCity(""); setOfficeAddress(""); setEditingOffice(null); setOfficeMessage("Office locations saved.");
    } catch (error) { setOfficeMessage(error instanceof Error ? error.message : "Could not save office locations."); }
    finally { setOfficeSaving(false); }
  }

  async function saveSettings(saveWorkflow = false, formsToSave = feedbackForms) {
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          shareCompanyOnSocialLinks,
          logoUrl,
          story,
          foundedYear: foundedYear || undefined,
          websiteUrl,
          ...(saveWorkflow ? {
            feedbackFormTemplates: formsToSave.map((form) => ({ ...form, name: form.name.trim(), description: form.description?.trim() || undefined, questions: form.questions.map(normalizeQuestion).map((q) => ({ ...q, label: q.label.trim(), description: q.description?.trim() || undefined, options: q.options.map((o) => o.trim()).filter(Boolean) })) })),
            rejectionEmailSubject,
            rejectionEmailBody,
            backedOutEmailSubject,
            backedOutEmailBody,
          } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save company settings.");
      onSaved(data.org as OrgSettings);
      setMessage(saveWorkflow ? "Hiring workflow settings saved." : "Company settings saved.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save company settings.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAddonSettings() {
    const overdueDays = Number(referralBonusOverdueDays);
    if (!Number.isInteger(overdueDays) || overdueDays < 1 || overdueDays > 3650) {
      setMessage("Choose an overdue period from 1 to 3,650 days.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          shareCompanyOnSocialLinks,
          logoUrl,
          story,
          foundedYear: foundedYear || undefined,
          websiteUrl,
          employeeReferralsEnabled,
          referralShareSalary,
          referralBonusOverdueDays: overdueDays,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save add-on settings.");
      onSaved(data.org as OrgSettings);
      setMessage("Referral program settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save add-on settings.");
    } finally {
      setBusy(false);
    }
  }

  async function saveIntegrationRequest(provider: "whatsapp" | "naukri" | "linkedin", requested: boolean) {
    setIntegrationSaving(provider); setMessage("");
    try {
      const response = await apiFetch("/api/org", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setIntegrationRequest", provider, requested }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save your request.");
      onSaved(data.org as OrgSettings);
      setMessage(requested ? "Request saved. Contact LT Recruitment Project to arrange setup." : "Request removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save your request."); }
    finally { setIntegrationSaving(null); }
  }

  async function saveOfferJoiningSetting(enabled: boolean) {
    setOfferJoiningSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerJoiningEnabled: enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update Offer & Joining.");
      onSaved(data.org as OrgSettings);
      setOfferJoiningEnabled(data.org.offerJoiningEnabled === true);
      setConfirmDisableOfferJoining(false);
      setMessage(enabled ? "Offer & Joining enabled." : "Offer & Joining disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Offer & Joining.");
    } finally {
      setOfferJoiningSaving(false);
    }
  }

  async function saveVendorsSpendSetting(enabled: boolean) {
    setVendorsSpendSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorsSpendEnabled: enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update Vendors & Spend.");
      onSaved(data.org as OrgSettings);
      setVendorsSpendEnabled(data.org.vendorsSpendEnabled === true);
      setMessage(enabled ? "Vendors & Spend enabled." : "Vendors & Spend disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update Vendors & Spend.");
    } finally {
      setVendorsSpendSaving(false);
    }
  }

  async function savePositionReferralSettings(requisition: ReferralSettingsRequisition) {
    const draft = positionDraft;
    if (!draft || draft.id !== requisition.id || positionSaving) return;
    const joiningBonus = Number(draft.joiningBonus);
    const interviewBonus = Number(draft.interviewBonus);
    if (!Number.isSafeInteger(joiningBonus) || joiningBonus < 0 || joiningBonus > 100_000_000) {
      setPositionMessages((current) => ({ ...current, [requisition.id]: "Enter a whole-number joining bonus." }));
      return;
    }
    if (!Number.isSafeInteger(interviewBonus) || interviewBonus < 0 || interviewBonus > 100_000_000) {
      setPositionMessages((current) => ({ ...current, [requisition.id]: "Enter a whole-number per-round bonus." }));
      return;
    }
    if (draft.enabled && joiningBonus <= 0) {
      setPositionMessages((current) => ({ ...current, [requisition.id]: "A joining bonus is required to enable this position." }));
      return;
    }

    setPositionSaving(requisition.id);
    setPositionMessages((current) => ({ ...current, [requisition.id]: "" }));
    try {
      const response = await apiFetch(`/api/requisitions/${requisition.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeReferralEnabled: draft.enabled,
          ...(!requisition.hasEmployeeReferrals ? {
            referralBonus: joiningBonus,
            referralInterviewBonus: interviewBonus,
          } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save referral settings for this position.");
      setPositionMessages((current) => ({ ...current, [requisition.id]: "Position referral settings saved." }));
      setPositionDraft(null);
      onRefreshRequisitions();
    } catch (error) {
      setPositionMessages((current) => ({ ...current, [requisition.id]: error instanceof Error ? error.message : "Could not save position settings." }));
    } finally {
      setPositionSaving(null);
    }
  }

  async function markReferralPayoutPaid(payout: AdminReferralPayout) {
    setPayoutBusyId(payout.id);
    setPayoutMessage("");
    try {
      const response = await apiFetch("/api/referrals/payouts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: payout.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not mark this referral payout paid.");
      setReferralPayouts((current) => current.map((item) => item.id === payout.id ? { ...item, ...data.payout } : item));
    } catch (error) {
      setPayoutMessage(error instanceof Error ? error.message : "Could not update referral payout.");
    } finally {
      setPayoutBusyId(null);
    }
  }

  function createFeedbackForm() {
    if (feedbackForms.length >= 50) return;
    const form: FeedbackFormTemplate = { id: crypto.randomUUID(), name: "", questions: [{ label: "", type: "paragraph", required: false, options: [], scaleMax: 5 }] };
    setMessage("");
    setEditingFeedbackForm(form);
  }

  function duplicateFeedbackForm(form: FeedbackFormTemplate) {
    if (feedbackForms.length >= 50) return;
    const copy: FeedbackFormTemplate = {
      ...form,
      id: crypto.randomUUID(),
      name: `${form.name.trim() || "Untitled form"} (copy)`.slice(0, 120),
      questions: form.questions.map((question) => ({ ...normalizeQuestion(question), options: [...normalizeQuestion(question).options] })),
    };
    setMessage("");
    setEditingFeedbackForm(copy);
  }

  async function saveFeedbackForm(form: FeedbackFormTemplate) {
    const forms = feedbackForms.some((current) => current.id === form.id)
      ? feedbackForms.map((current) => current.id === form.id ? form : current)
      : [...feedbackForms, form];
    const saved = await saveSettings(true, forms);
    if (saved) setEditingFeedbackForm(null);
    return saved;
  }

  const referralSearch = referralRoleSearch.trim().toLowerCase();
  const visibleReferralPositions = section === "addons" ? requisitions.filter((requisition) =>
    ["Approved", "Position Reopened", "Partially Fulfilled"].includes(requisition.status)
    && [requisition.title, requisition.department, requisition.location, requisition.id]
      .some((value) => (value || "").toLowerCase().includes(referralSearch))
    && (referralRoleFilter === "all" || (referralRoleFilter === "enabled") === (requisition.employeeReferralEnabled === true))
  ) : [];
  const hasVisiblePositionEditor = visibleReferralPositions.some((requisition) => requisition.id === positionDraft?.id);

  return (
    <section className={`ats-admin-settings${section === "addons" ? " is-addon-settings" : ""}`}>
      {editingFeedbackForm ? (
        <FeedbackFormEditor
          key={editingFeedbackForm.id}
          form={editingFeedbackForm}
          busy={busy}
          message={message}
          onBack={() => { setMessage(""); setEditingFeedbackForm(null); }}
          onSave={saveFeedbackForm}
        />
      ) : <>
      <div className="ats-settings-tabs" role="tablist" aria-label="Settings sections">
        {([ ["company", "Company Profile"], ["teams", "Teams & Access"], ["workflow", "Hiring Workflow"], ["modules", "Modules & Features"], ["integrations", "Integrations"], ["addons", "Referral Program"] ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => onSectionChange(id)}
            className={`ats-settings-tab${section === id ? " is-active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "integrations" ? (
        <div className="ats-integrations-settings">
          <h2 className="ats-heading-section">Integrations</h2>
          <section className="ats-connection-status"><h3>Workspace connections</h3><p>Check the services used by AI, messaging and interview scheduling.</p>{connectionError ? <p role="alert">{connectionError}</p> : !connectionStatus ? <p role="status">Checking connections…</p> : <div>{([["AI", connectionStatus.ai], ["Email", connectionStatus.email], ["Background runner", connectionStatus.scheduler], ["Interview calendar", connectionStatus.calendar]] as const).map(([name, configured]) => <div key={name}><strong>{name}</strong><span>{configured ? "Configured" : "Setup needed"}</span></div>)}</div>}<small>Configuration status indicates required settings are present; it does not test the connection. Ask your administrator or deployment provider to complete setup.</small></section>
          <p className="ats-heading-subtitle">Choose services your organization would like to use. Setup requests are saved here; contact LT Recruitment Project to arrange setup.</p>
          {([
            ["whatsapp", "WhatsApp", "Candidate follow-ups and interview reminders. This optional add-on carries additional charges; pricing is agreed separately."],
            ["naukri", "Naukri", "Connect your organization’s Naukri account when the integration and required access are available."],
            ["linkedin", "LinkedIn", "Connect your organization’s LinkedIn account when the integration and required partner access are available."],
          ] as const).map(([provider, name, description]) => {
            const requested = org?.integrationRequests?.[provider] === true;
            return <article className="ats-integration-card" key={provider}><div><h3>{name}</h3><p>{description}</p><small>{requested ? "Setup requested · Not connected" : "Not connected"}</small></div><button type="button" className="ats-primary-button" disabled={!!integrationSaving} onClick={() => void saveIntegrationRequest(provider, !requested)}>{integrationSaving === provider ? "Saving…" : requested ? "Remove request" : "Request setup"}</button></article>;
          })}
          {message && <p role="status">{message}</p>}
          <p className="ats-heading-subtitle">A setup request does not connect a service, send messages, or start billing. Do not enter passwords or API keys here.</p>
        </div>
      ) : section === "modules" ? (
        <div className="ats-modules-settings">
          <header>
            <h2 className="ats-heading-section">Modules &amp; Features</h2>
            <p className="ats-heading-subtitle">Enable optional tools for your organization.</p>
          </header>
          <article className="ats-module-card">
            <div>
              <h3>Offer &amp; Joining Management</h3>
              <p>Track upcoming joiners, manage joining dates, monitor joining status, and maintain DOJ history.</p>
            </div>
            <div className="ats-module-toggle-row">
              <span>{offerJoiningEnabled ? "Enabled" : "Disabled"}</span>
              <button
                type="button"
                role="switch"
                aria-label="Enable Offer & Joining Management"
                aria-checked={offerJoiningEnabled}
                disabled={offerJoiningSaving}
                className={`hb-program-switch${offerJoiningEnabled ? " is-on" : ""}`}
                onClick={() => offerJoiningEnabled ? setConfirmDisableOfferJoining(true) : void saveOfferJoiningSetting(true)}
              ><span aria-hidden="true" /></button>
            </div>
          </article>
          <article className="ats-module-card" style={{ marginTop: 10 }}>
            <div>
              <h3>Vendors &amp; Spend Management</h3>
              <p>Manage recruitment consultants, job board subscriptions, agreements, invoices, renewals, and recruitment cost analytics.</p>
            </div>
            <div className="ats-module-toggle-row">
              <span>{vendorsSpendEnabled ? "Enabled" : "Disabled"}</span>
              <button
                type="button"
                role="switch"
                aria-label="Enable Vendors & Spend Management"
                aria-checked={vendorsSpendEnabled}
                disabled={vendorsSpendSaving}
                className={`hb-program-switch${vendorsSpendEnabled ? " is-on" : ""}`}
                onClick={() => void saveVendorsSpendSetting(!vendorsSpendEnabled)}
              ><span aria-hidden="true" /></button>
            </div>
          </article>
          {message && <p role="status" className={message.includes("enabled") || message.includes("disabled") ? "ats-module-message is-success" : "ats-module-message is-error"}>{message}</p>}
          {confirmDisableOfferJoining && (
            <div className="ats-module-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDisableOfferJoining(false); }}>
              <section className="ats-module-confirm" role="dialog" aria-modal="true" aria-labelledby="ats-module-confirm-title">
                <h3 id="ats-module-confirm-title">Disable Offer &amp; Joining?</h3>
                <p>Disabling Offer &amp; Joining will hide joining management features for your organization. All existing joining records will be preserved and restored when the module is enabled again.</p>
                <div>
                  <button type="button" className="ats-secondary-button" disabled={offerJoiningSaving} onClick={() => setConfirmDisableOfferJoining(false)}>Cancel</button>
                  <button type="button" className="ats-primary-button" disabled={offerJoiningSaving} onClick={() => void saveOfferJoiningSetting(false)}>{offerJoiningSaving ? "Disabling…" : "Disable Module"}</button>
                </div>
              </section>
            </div>
          )}
        </div>
      ) : section === "addons" ? (
        <div className="referral-design">
          <header className="referral-design-header"><div><h2>Referral Program</h2><p>Configure employee referrals, rewards, and payouts for open positions.</p></div><div className="referral-design-header-actions"><button type="button" className="referral-primary" disabled={busy || !company.trim()} onClick={() => void saveAddonSettings()}>{busy ? "Saving…" : "Save changes"}</button></div></header>
          {message && <p className="referral-design-message" role="status">{message}</p>}
          <div className="referral-design-policy">
            <section><div className="referral-design-policy-title"><span aria-hidden="true">◉</span><h3>Program status</h3></div><p>Allow employees to refer candidates for eligible open positions.</p><div className="referral-design-switch"><button type="button" role="switch" className={`hb-program-switch${employeeReferralsEnabled ? " is-on" : ""}`} aria-label="Enable Employee Referrals" aria-checked={employeeReferralsEnabled} onClick={() => setEmployeeReferralsEnabled((value) => !value)}><span aria-hidden="true" /></button><strong>{employeeReferralsEnabled ? "On" : "Off"}</strong></div></section>
            <section><div className="referral-design-policy-title"><span aria-hidden="true">◌</span><h3>Salary visibility</h3></div><p>Show or hide salary ranges in employee referrals and referral links.</p><div className="referral-design-switch"><button type="button" role="switch" className={`hb-program-switch${referralShareSalary ? " is-on" : ""}`} aria-label="Share salary ranges in employee referrals" aria-checked={referralShareSalary} onClick={() => setReferralShareSalary((value) => !value)}><span aria-hidden="true" /></button><strong className="hb-salary-visibility-badge">{referralShareSalary ? "Shared" : "Hidden"}</strong></div><small>Review job descriptions and attached files separately for salary information.</small></section>
            <section><div className="referral-design-policy-title"><span aria-hidden="true">◫</span><h3>Bonus payout policy</h3></div><p>Set when a joining bonus becomes overdue after the joining date.</p><label className="referral-design-days">Overdue after <input type="number" min="1" max="3650" step="1" value={referralBonusOverdueDays} onChange={(event) => setReferralBonusOverdueDays(event.target.value)} /> days</label></section>
          </div>
          <section className="referral-design-positions" aria-labelledby="referral-positions-heading">
            <header>
              <h3 id="referral-positions-heading">Open positions</h3>
              <p>Manage referral eligibility and bonuses for each role.</p>
            </header>
            <div className="referral-design-tools">
              <div className="referral-position-search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 4.5 4.5" />
                </svg>
                <input type="search" aria-label="Search open positions" placeholder="Search roles…" value={referralRoleSearch} onChange={(event) => setReferralRoleSearch(event.target.value)} />
              </div>
              <select aria-label="Filter by referral status" value={referralRoleFilter} onChange={(event) => setReferralRoleFilter(event.target.value)}>
                <option value="all">All roles</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
              <span className="referral-position-count" role="status">{visibleReferralPositions.length} {visibleReferralPositions.length === 1 ? "position" : "positions"}</span>
            </div>
            <div className="referral-design-table-wrap">
              <table className="referral-design-table" aria-label="Referral settings by position" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col">Role</th>
                    <th scope="col">Referral status</th>
                    <th scope="col">Joining bonus</th>
                    <th scope="col">Per-interview bonus</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {visibleReferralPositions.map((req) => {
                    const draft = positionDraft?.id === req.id ? positionDraft : null;
                    const enabled = req.employeeReferralEnabled === true;
                    const locked = req.hasEmployeeReferrals;
                    const saving = positionSaving === req.id;
                    const changed = draft && (
                      draft.enabled !== enabled || (!locked && (
                        Number(draft.joiningBonus) !== (req.referralBonus || 0)
                        || Number(draft.interviewBonus) !== (req.referralInterviewBonus || 0)
                      ))
                    );
                    const editorId = `referral-position-editor-${req.id}`;
                    return (
                      <Fragment key={req.id}>
                        <tr className="referral-position-row" role="row">
                          <th scope="row" role="rowheader">
                            <strong>{req.title}</strong>
                            <small>{req.department} · {req.location || "Location flexible"} · {req.id}</small>
                            {locked && <small>Bonuses locked after the first referral.</small>}
                            {!draft && positionMessages[req.id] && <small role="status">{positionMessages[req.id]}</small>}
                          </th>
                          <td role="cell" data-label="Referral status">
                            <span className={`referral-role-status${enabled ? " is-enabled" : ""}`}>{enabled ? "Enabled" : "Disabled"}</span>
                          </td>
                          <td role="cell" data-label="Joining bonus" className="referral-position-amount">{formatMoneyForSettings(req.referralBonus || 0)}</td>
                          <td role="cell" data-label="Per-interview bonus" className="referral-position-amount">{formatMoneyForSettings(req.referralInterviewBonus || 0)}</td>
                          <td role="cell" className="referral-position-action">
                            <button
                              type="button"
                              className="referral-outline"
                              aria-label={`Edit referral settings for ${req.title}`}
                              aria-expanded={!!draft}
                              aria-controls={draft ? editorId : undefined}
                              disabled={positionSaving !== null || (hasVisiblePositionEditor && !draft)}
                              onClick={() => {
                                setPositionMessages((current) => ({ ...current, [req.id]: "" }));
                                setPositionDraft(draft ? null : {
                                  id: req.id,
                                  enabled,
                                  joiningBonus: String(req.referralBonus || 0),
                                  interviewBonus: String(req.referralInterviewBonus || 0),
                                });
                              }}
                            >Edit</button>
                          </td>
                        </tr>
                        {draft && (
                          <tr className="referral-position-editor-row" role="row">
                            <td colSpan={5} role="cell">
                              <form id={editorId} className="referral-position-editor" onSubmit={(event) => { event.preventDefault(); void savePositionReferralSettings(req); }}>
                                <fieldset disabled={saving}>
                                  <legend>Referral settings</legend>
                                  <div className="referral-position-fields">
                                    <div className="referral-design-switch referral-position-switch">
                                      <button
                                        type="button"
                                        role="switch"
                                        className={`hb-program-switch${draft.enabled ? " is-on" : ""}`}
                                        aria-label={`Enable referrals for ${req.title}`}
                                        aria-checked={draft.enabled}
                                        onClick={() => setPositionDraft({ ...draft, enabled: !draft.enabled })}
                                      ><span aria-hidden="true" /></button>
                                      <strong>Enable referrals</strong>
                                    </div>
                                    <label>
                                      Joining bonus (₹)
                                      <input type="number" min="0" max="100000000" step="1" required disabled={locked} value={draft.joiningBonus} onChange={(event) => setPositionDraft({ ...draft, joiningBonus: event.target.value })} />
                                    </label>
                                    <label>
                                      Per-interview bonus (₹)
                                      <input type="number" min="0" max="100000000" step="1" required disabled={locked} value={draft.interviewBonus} onChange={(event) => setPositionDraft({ ...draft, interviewBonus: event.target.value })} />
                                    </label>
                                  </div>
                                </fieldset>
                                <div className="referral-row-actions">
                                  <button type="button" className="referral-outline" disabled={saving} onClick={() => {
                                    setPositionMessages((current) => ({ ...current, [req.id]: "" }));
                                    setPositionDraft(null);
                                  }}>Cancel</button>
                                  <button type="submit" className="referral-primary" disabled={saving || !changed}>{saving ? "Saving…" : "Save"}</button>
                                </div>
                                {positionMessages[req.id] && <p className="referral-position-error" role="alert">{positionMessages[req.id]}</p>}
                              </form>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {visibleReferralPositions.length === 0 && <p className="referral-design-empty">No open positions match these filters.</p>}
          </section>
          <section className="referral-design-payouts"><div className="referral-payout-summary"><h3>Payouts summary</h3>{payoutsLoaded ? <><div><span>Pending payouts</span><strong>{formatMoneyForSettings(referralPayouts.filter((payout) => payout.status !== "Paid").reduce((total, payout) => total + payout.amount, 0))}</strong><small>{referralPayouts.filter((payout) => payout.status !== "Paid").length} payouts</small></div><div><span>Paid this year</span><strong>{formatMoneyForSettings(referralPayouts.filter((payout) => payout.status === "Paid" && payout.paidAt && new Date(payout.paidAt).getFullYear() === new Date().getFullYear()).reduce((total, payout) => total + payout.amount, 0))}</strong><small>Recorded payouts</small></div><div><span>Total paid</span><strong>{formatMoneyForSettings(referralPayouts.filter((payout) => payout.status === "Paid").reduce((total, payout) => total + payout.amount, 0))}</strong><small>Recorded payouts</small></div></> : <p role="status">{payoutMessage ? "Payout totals unavailable." : "Loading payouts…"}</p>}<button type="button" className="referral-outline" aria-expanded={showReferralPayouts} onClick={() => setShowReferralPayouts((value) => !value)}>{showReferralPayouts ? "Hide payouts" : "View payouts"}</button></div>
            {payoutMessage && <p role="alert">{payoutMessage}</p>}
            {showReferralPayouts && <div className="hb-referral-payout-admin-list">{!payoutsLoaded ? <p className="referral-design-empty">{payoutMessage || "Loading payouts…"}</p> : referralPayouts.length ? referralPayouts.map((payout) => <article className="hb-referral-payout-admin-row" key={payout.id}><div><strong>{payout.candidateName}</strong><span>{payout.requisitionTitle} · {payout.kind === "Joining" ? `Date joined ${payout.joiningDate || "—"}` : payout.roundName}</span></div><div><strong>{formatMoneyForSettings(payout.amount)}</strong><span>Referrer: {payout.referrerEmail}{payout.kind === "Joining" && payout.dueAt ? ` · Due ${new Date(payout.dueAt).toLocaleDateString()}` : ""}</span></div><span className={`hb-referral-payout-status is-${payout.status.toLowerCase()}`}>{payout.status}</span>{payout.status !== "Paid" ? <button type="button" className="referral-outline" disabled={payoutBusyId === payout.id} onClick={() => void markReferralPayoutPaid(payout)}>{payoutBusyId === payout.id ? "Saving…" : "Mark paid"}</button> : <small>Paid {payout.paidAt ? new Date(payout.paidAt).toLocaleDateString() : ""}</small>}</article>) : <p className="referral-design-empty">No referral payouts recorded.</p>}</div>}
          </section>
        </div>
      ) : section === "teams" ? teams : section === "workflow" ? (
        <div className="ats-workflow-page"><header className="ats-workflow-page-heading"><span>Settings / Hiring Workflow</span><h2>Hiring workflow</h2><p>Configure the structure and information used across your hiring process.</p></header><div className="ats-workflow-layout"><nav className="ats-workflow-nav" aria-label="Hiring workflow sections">{([ ["organization", "Departments & business units"], ["candidate", "Candidate form fields"], ["numbering", "Requisition numbering"], ["feedback", "Feedback form library"], ["emails", "Candidate emails"] ] as const).map(([id, label]) => <button type="button" key={id} aria-current={workflowArea === id ? "page" : undefined} className={workflowArea === id ? "is-active" : ""} onClick={() => setWorkflowArea(id)}>{label}</button>)}</nav><div className="ats-workflow-content">
          <div hidden={workflowArea !== "organization"}><RequisitionOrganizationSettings org={org} apiFetch={apiFetch} onSaved={onSaved} /></div>
          <div hidden={workflowArea !== "candidate"}><CandidateFieldSettings org={org} apiFetch={apiFetch} onSaved={onSaved} /></div>
          <section hidden={workflowArea !== "numbering"} className="ats-numbering-card" aria-labelledby="numbering-title">
            <div className="ats-numbering-header"><div><span className="ats-numbering-eyebrow">HIRING WORKFLOW</span><h2 id="numbering-title">Requisition numbering</h2><p>Set the ID format for new requests. Existing IDs stay the same.</p></div><span className="ats-numbering-mark" aria-hidden="true">#</span></div>
            <fieldset className="ats-numbering-mode"><legend>NUMBERING STYLE</legend>
              <label className={`ats-numbering-choice${!separateReqSequences ? " is-selected" : ""}`}><input type="radio" name="req-numbering-mode" checked={!separateReqSequences} onChange={() => setSeparateReqSequences(false)} /><span><strong>One sequence</strong><small>Use the same format for all requests</small></span></label>
              <label className={`ats-numbering-choice${separateReqSequences ? " is-selected" : ""}`}><input type="radio" name="req-numbering-mode" checked={separateReqSequences} onChange={() => setSeparateReqSequences(true)} /><span><strong>By request type</strong><small>Set different formats for New and Replacement</small></span></label>
            </fieldset>
            <div className="ats-numbering-sequences">{(separateReqSequences ? [
              { label: "New requests", prefix: newReqPrefix, number: newReqNumber, setPrefix: setNewReqPrefix, setNumber: setNewReqNumber },
              { label: "Replacement requests", prefix: replacementReqPrefix, number: replacementReqNumber, setPrefix: setReplacementReqPrefix, setNumber: setReplacementReqNumber },
            ] : [{ label: "All requests", prefix: reqPrefix, number: reqNextNumber, setPrefix: setReqPrefix, setNumber: setReqNextNumber }]).map((item) => <div className="ats-numbering-sequence" key={item.label}>
              <div className="ats-numbering-sequence-head"><strong>{item.label}</strong><span>Next ID <b>{item.prefix || "…"}-{item.number || "…"}</b></span></div>
              <div className="ats-numbering-fields"><label>Prefix<input maxLength={20} value={item.prefix} onChange={(event) => item.setPrefix(event.target.value.toUpperCase())} placeholder="REQ" /></label><label>Next number<input type="number" min="1" max="999999999" step="1" value={item.number} onChange={(event) => item.setNumber(event.target.value)} /></label></div>
            </div>)}</div>
            <div className="ats-numbering-footer"><span>Numbers increase automatically as requests are created.</span><button type="button" disabled={sequenceBusy} onClick={() => void saveRequisitionSequence()}>{sequenceBusy ? "Saving…" : "Save numbering"}</button></div>
            {sequenceMessage && <p className="ats-numbering-message" role="status">{sequenceMessage}</p>}
          </section>
          <div className="ats-workflow-panel" hidden={workflowArea !== "feedback"}><h2 className="ats-heading-section">Feedback form library</h2>
          <p className="ats-heading-subtitle">Create reusable forms for different roles and interview rounds. Recruiters can select a form when setting up rounds; unassigned rounds use the standard feedback form.</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
            <span style={{ color: "#718096", fontSize: 12 }}>{feedbackForms.length} of 50 forms</span>
            <button type="button" className="ats-primary-button" disabled={feedbackForms.length >= 50} onClick={createFeedbackForm}>+ Create feedback form</button>
          </div>
          {feedbackForms.length === 0 && <p style={{ padding: 18, border: "1px dashed #cbd5e1", borderRadius: 8, color: "#526176", fontSize: 13 }}>No custom forms yet. Create one to tailor feedback to a role or interview round.</p>}
          {feedbackForms.map((form, index) => <article className="ats-feedback-library-row" key={form.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "16px 18px", marginTop: 10, border: "1px solid #dce4ef", borderRadius: 8, background: "#fff" }}>
            <button type="button" onClick={() => { setMessage(""); setEditingFeedbackForm(form); }} style={{ display: "grid", flex: "1 1 280px", gap: 5, border: 0, padding: 0, textAlign: "left", background: "transparent", cursor: "pointer" }}>
              <strong style={{ color: "#26374b", fontSize: 14 }}>{form.name.trim() || `Untitled form ${index + 1}`}</strong>
              <span style={{ color: "#718096", fontSize: 12 }}>{form.description?.trim() || `${form.questions.length} ${form.questions.length === 1 ? "question" : "questions"}`}</span>
            </button>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => { setMessage(""); setEditingFeedbackForm(form); }}>Edit</button>
              <button type="button" disabled={feedbackForms.length >= 50} onClick={() => duplicateFeedbackForm(form)}>Duplicate</button>
              <button type="button" onClick={() => { if (window.confirm(`Remove "${form.name || "this form"}"?`)) setFeedbackForms((forms) => forms.filter((item) => item.id !== form.id)); }}>Remove</button>
            </div>
          </article>)}
          <div className="ats-workflow-save"><button type="button" className="ats-primary-button" disabled={busy || !company.trim() || feedbackForms.some((form) => feedbackFormIssue(form))} onClick={() => saveSettings(true)}>{busy ? "Saving…" : "Save workflow changes"}</button><span>Also saves changes to candidate emails.</span>{message && <span role="status">{message}</span>}</div></div>
          <div className="ats-workflow-panel" hidden={workflowArea !== "emails"}><h2 className="ats-heading-section">Candidate rejection email</h2>
          <p className="ats-heading-subtitle">When a candidate is rejected, the configured message opens as a draft in the user&apos;s default email app. It is not sent automatically.</p>
          <label style={labelStyle}>
            Email subject
            <input style={fieldStyle} maxLength={200} value={rejectionEmailSubject} onChange={(event) => setRejectionEmailSubject(event.target.value)} />
          </label>
          <label style={labelStyle}>
            Email message
            <textarea style={{ ...fieldStyle, minHeight: 220, resize: "vertical", lineHeight: 1.5 }} maxLength={6000} value={rejectionEmailBody} onChange={(event) => setRejectionEmailBody(event.target.value)} />
          </label>
          <p style={{ color: "#718096", fontSize: 12, lineHeight: 1.5 }}>
            Available placeholders: {"{candidateName}"}, {"{requisitionTitle}"}, {"{companyName}"}, {"{rejectionReason}"}.
          </p>
          <h2 className="ats-heading-section" style={{ marginTop: 28 }}>Backed-out candidate email</h2>
          <p className="ats-heading-subtitle">A separate message opens as a draft when a candidate is marked as backed out.</p>
          <label style={labelStyle}>
            Email subject
            <input style={fieldStyle} maxLength={200} value={backedOutEmailSubject} onChange={(event) => setBackedOutEmailSubject(event.target.value)} />
          </label>
          <label style={labelStyle}>
            Email message
            <textarea style={{ ...fieldStyle, minHeight: 220, resize: "vertical", lineHeight: 1.5 }} maxLength={6000} value={backedOutEmailBody} onChange={(event) => setBackedOutEmailBody(event.target.value)} />
          </label>
          <p style={{ color: "#718096", fontSize: 12, lineHeight: 1.5 }}>
            Available placeholders: {"{candidateName}"}, {"{requisitionTitle}"}, {"{companyName}"}, {"{backedOutReason}"}.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
            <button type="button" className="ats-primary-button" disabled={busy || !company.trim() || feedbackForms.some((form) => feedbackFormIssue(form))} onClick={() => saveSettings(true)}>
              {busy ? "Saving…" : "Save workflow changes"}
            </button>
            <span style={{ color: "#777", fontSize: 12 }}>Also saves changes to feedback forms.</span>
            {message && <span role="status" style={{ color: message.includes("saved") ? "#287253" : "#a33", fontSize: 12 }}>{message}</span>}
          </div>
          </div></div></div>
        </div>
      ) : (
        <div style={{ width: "min(680px, 100%)" }}>
          <div className="ats-social-sharing-card">
            <div className="ats-social-sharing-copy">
              <span className="ats-social-sharing-kicker">PUBLIC APPLICATION LINKS</span>
              <strong>Share your company profile</strong>
              <p>Show your company name, logo and story alongside the job description.</p>
              <span className="ats-social-sharing-status">{shareCompanyOnSocialLinks ? "Company details are visible" : "Only job details are visible"}</span>
            </div>
            <label className="ats-social-sharing-switch">
              <input type="checkbox" checked={shareCompanyOnSocialLinks} onChange={(event) => setShareCompanyOnSocialLinks(event.target.checked)} aria-label="Share company profile on public application links" />
              <span aria-hidden="true" />
            </label>
          </div>
          <label style={labelStyle}>
            Company name *
            <input style={fieldStyle} maxLength={120} value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>
          <section className="ats-office-locations" style={{ marginTop: 24, padding: 20, border: "1px solid #ddd", borderRadius: 10 }}>
            <h3 style={{ margin: "0 0 6px" }}>Office locations</h3>
            <p style={{ margin: "0 0 14px", color: "#666" }}>Add office locations for hiring requests and full addresses for in-person interview invites.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
              <label style={{ ...labelStyle, flex: "1 1 220px" }}>Office name (optional)<input style={fieldStyle} maxLength={100} value={officeName} onChange={(event) => setOfficeName(event.target.value)} placeholder="e.g. Head Office or Bangalore Hub 2" /></label>
              <label style={{ ...labelStyle, flex: "1 1 160px" }}>City (optional)<input style={fieldStyle} maxLength={100} value={officeCity} onChange={(event) => setOfficeCity(event.target.value)} placeholder="e.g. Bengaluru" /></label>
              <label style={{ ...labelStyle, flex: "2 1 250px" }}>Street address<input style={fieldStyle} maxLength={300} value={officeAddress} onChange={(event) => setOfficeAddress(event.target.value)} placeholder="Building, street, and postal code" /></label>
              <button type="button" className="ats-primary-button" disabled={officeSaving || (!officeName.trim() && !officeCity.trim())} onClick={() => {
                const office = { name: officeName.trim() || officeCity.trim(), city: officeName.trim() ? officeCity.trim() : "", address: officeAddress.trim() };
                void saveOffices(editingOffice === null ? [...offices, office] : offices.map((item, index) => index === editingOffice ? office : item));
              }}>{editingOffice === null ? "Add location" : "Save location"}</button>
              {editingOffice !== null && <button type="button" disabled={officeSaving} onClick={() => { setEditingOffice(null); setOfficeName(""); setOfficeCity(""); setOfficeAddress(""); }}>Cancel</button>}
            </div>
            {offices.length > 0 && <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>{offices.map((office, index) => <li key={JSON.stringify([office.name, office.city])} className="ats-office-row"><div className="ats-office-details"><strong>{office.name}</strong>{office.city && <span style={{ color: "#666" }}> · {office.city}</span>}{office.address && <small>{office.address}</small>}</div><div className="ats-office-actions"><button type="button" disabled={officeSaving} onClick={() => { setEditingOffice(index); setOfficeName(office.name); setOfficeCity(office.city || ""); setOfficeAddress(office.address || ""); }}>Edit</button><button type="button" disabled={officeSaving || editingOffice !== null} aria-label={`Remove ${office.name}${office.city ? ` in ${office.city}` : ""}`} onClick={() => void saveOffices(offices.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></div></li>)}</ul>}
            {officeMessage && <p role="status">{officeMessage}</p>}
          </section>
          <label style={labelStyle}>
            Logo
            <input
              style={{ ...fieldStyle, padding: 7 }}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseLogo(event.target.files?.[0])}
            />
          </label>
          {logoUrl && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
              <Image src={logoUrl} alt="Company logo preview" width={120} height={64} unoptimized style={{ width: 120, height: 64, objectFit: "contain", border: "1px solid #dce4ef", borderRadius: 5 }} />
              <button className="ats-remove-logo" type="button" onClick={() => setLogoUrl("")} style={{ border: 0, background: "transparent", color: "#a33", cursor: "pointer" }}>Remove logo</button>
            </div>
          )}
          <label style={labelStyle}>
            Company story
            <div
              ref={storyInput}
              className="ats-company-story-editor"
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              data-placeholder="Share what your company does and what makes it a meaningful place to work."
              style={{ ...fieldStyle, minHeight: 130, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.5 }}
              onInput={updateStory}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
                  event.preventDefault();
                  document.execCommand("removeFormat");
                  updateStory();
                }
              }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 0.6fr) minmax(220px, 1.4fr)", gap: 12 }}>
            <label style={labelStyle}>
              Started in
              <input style={fieldStyle} type="number" min="1800" max={new Date().getFullYear()} value={foundedYear} onChange={(event) => setFoundedYear(event.target.value)} />
            </label>
            <label style={labelStyle}>
              Website
              <input style={fieldStyle} type="url" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://example.com" />
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
            <button type="button" className="ats-primary-button" disabled={busy || !company.trim()} onClick={() => saveSettings()}>
              {busy ? "Saving…" : "Save company profile"}
            </button>
            {message && <span role="status" style={{ color: message.includes("saved") ? "#287253" : "#a33", fontSize: 12 }}>{message}</span>}
          </div>
        </div>
      )}
      </>}
    </section>
  );
}


