import type { OrgSettings } from "@/lib/types";

export const DEFAULT_REJECTION_EMAIL_SUBJECT = "An update on your application to {companyName}";
export const DEFAULT_REJECTION_EMAIL_BODY = `Hi {candidateName},

Thank you for your interest in {requisitionTitle} at {companyName}. After careful consideration, we will not be progressing with your application at this time.

We appreciate the time you invested in the process and wish you the best in your search.

Regards,
{companyName}`;
export const DEFAULT_BACKED_OUT_EMAIL_SUBJECT = "An update on your application to {companyName}";
export const DEFAULT_BACKED_OUT_EMAIL_BODY = `Hi {candidateName},

We have updated your application for {requisitionTitle} at {companyName} to reflect that it is no longer active.

{backedOutReason}

Thank you for your time and interest.

Regards,
{companyName}`;

type EmailDraftInput = {
  candidateEmail: string;
  candidateName: string;
  requisitionTitle: string;
  reason?: string;
  org: Pick<OrgSettings, "company" | "rejectionEmailSubject" | "rejectionEmailBody" | "backedOutEmailSubject" | "backedOutEmailBody"> | null;
  subjectTemplate: string;
  bodyTemplate: string;
};

function openEmailDraft({ candidateEmail, candidateName, requisitionTitle, reason, org, subjectTemplate, bodyTemplate }: EmailDraftInput) {
  if (!candidateEmail.trim()) return;
  const values: Record<string, string> = {
    candidateName,
    requisitionTitle,
    companyName: org?.company || "Our team",
    rejectionReason: reason || "",
    backedOutReason: reason || "",
  };
  const render = (template: string) => template.replace(/\{(candidateName|requisitionTitle|companyName|rejectionReason|backedOutReason)\}/g, (_, key: string) => values[key]);
  const subject = render(subjectTemplate);
  const body = render(bodyTemplate);
  window.location.href = `mailto:${encodeURIComponent(candidateEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function openRejectionEmailDraft({ candidateEmail, candidateName, requisitionTitle, rejectionReason, org }: {
  candidateEmail: string;
  candidateName: string;
  requisitionTitle: string;
  rejectionReason?: string;
  org: EmailDraftInput["org"];
}) {
  openEmailDraft({
    candidateEmail,
    candidateName,
    requisitionTitle,
    reason: rejectionReason,
    org,
    subjectTemplate: org?.rejectionEmailSubject || DEFAULT_REJECTION_EMAIL_SUBJECT,
    bodyTemplate: org?.rejectionEmailBody || DEFAULT_REJECTION_EMAIL_BODY,
  });
}

export function openBackedOutEmailDraft({ candidateEmail, candidateName, requisitionTitle, backedOutReason, org }: {
  candidateEmail: string;
  candidateName: string;
  requisitionTitle: string;
  backedOutReason?: string;
  org: EmailDraftInput["org"];
}) {
  openEmailDraft({
    candidateEmail,
    candidateName,
    requisitionTitle,
    reason: backedOutReason,
    org,
    subjectTemplate: org?.backedOutEmailSubject || DEFAULT_BACKED_OUT_EMAIL_SUBJECT,
    bodyTemplate: org?.backedOutEmailBody || DEFAULT_BACKED_OUT_EMAIL_BODY,
  });
}