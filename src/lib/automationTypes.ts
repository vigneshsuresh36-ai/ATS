export const WORKFLOWS = [
  { id: "feedback", title: "Feedback reminders", description: "Follow up after interviews and escalate overdue feedback.", icon: "mail" },
  { id: "interviewReminders", title: "Interview reminders", description: "Prepare reminders for candidates and interviewers before scheduled interviews.", icon: "calendar" },
  { id: "approvals", title: "Approval follow-ups", description: "Keep hiring requests and offer approvals moving.", icon: "document" },
  { id: "intake", title: "Resume intake", description: "Extract resume details and flag possible duplicates before saving.", icon: "document" },
  { id: "updates", title: "Candidate updates", description: "Prepare candidate stage updates for your review.", icon: "people" },
  { id: "joining", title: "Joining follow-ups", description: "Request joining confirmation and outstanding documents.", icon: "document" },
  { id: "briefs", title: "Retired workflow", description: "Retained for compatibility with existing records.", icon: "sparkle" },
] as const;
export type WorkflowId = typeof WORKFLOWS[number]["id"];
export type WorkflowConfig = { enabled: boolean; delayHours: number; escalationHours: number; autoSend: boolean; subject: string; template: string };
export type AutomationSettings = Record<WorkflowId, WorkflowConfig>;
export type AutomationTask = {
  id: string; workflow: WorkflowId; ownerEmail: string; reqId: string; candidateId?: string;
  interviewId?: string; sourceVersion: string; title: string; detail: string;
  recipients: string[]; subject: string; body: string;
  status: "preparing" | "pending" | "sending" | "sent" | "reviewed" | "dismissed" | "failed" | "obsolete";
  createdAt: string; updatedAt: string; error?: string; providerId?: string; reviewedBy?: string;
};
export function defaultAutomationSettings(): AutomationSettings {
  const config = (delayHours: number, subject: string, template: string): WorkflowConfig => ({ enabled: false, delayHours, escalationHours: 48, autoSend: false, subject, template });
  return {
    feedback: config(24, "Feedback requested: {candidateName}", "Hello,\n\nPlease add your interview feedback for {candidateName}, {roleTitle}, in LT Recruitment Project.\n\nThank you,\n{companyName}"),
    interviewReminders: config(24, "Interview reminder: {roleTitle}", "Hello,\n\nThis is a reminder for the {roundName} interview for {roleTitle} on {interviewTime}.\n\n{meetingDetails}\n\nRegards,\n{companyName}"),
    approvals: config(48, "Approval pending: {roleTitle}", "Hello,\n\nAn approval for {roleTitle} is waiting for your review in LT Recruitment Project.\n\nThank you,\n{companyName}"),
    intake: config(0, "", ""),
    updates: config(0, "Your application for {roleTitle}", "Hi {candidateName},\n\nYour application for {roleTitle} is now at the {stage} stage. We will contact you about the next steps.\n\nRegards,\n{companyName}"),
    joining: config(168, "Joining confirmation: {roleTitle}", "Hi {candidateName},\n\nPlease reply to confirm your planned joining date of {joiningDate} for {roleTitle}. Please let us know if any joining documents remain outstanding.\n\nRegards,\n{companyName}"),
    briefs: config(24, "", ""),
  };
}
