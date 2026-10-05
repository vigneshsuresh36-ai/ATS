export type Role = "Admin" | "Recruiter" | "HiringManager" | "DepartmentHead";

export type ApprovalStatus =
  | "PendingApproval"
  | "Approved"
  | "On Hold"
  | "Position Reopened"
  | "Partially Fulfilled"
  | "Position Fulfilled"
  | "Position Closed"
  | "Rejected"
  | "Closed";

export type CandidateStage =
  | "PendingHMApproval"
  | "HMApproved"
  | "New"
  | "Screened"
  | "Shortlist"
  | "Interview"
  | "Interview Scheduled"
  | "Selected"
  | "OfferApprovalPending"
  | "OfferApproved"
  | "Offered"
  | "Onboarded"
  | "Rejected"
  | "Candidate Backed Out"
  | "On Hold"
  | "Debrief";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string;
  /** Departments this person covers (HM raises for these; DH approves these). */
  departments: string[];
  managerEmail?: string;
  active: boolean;
  createdAt: string;
  actingAdminEmail?: string;
}

export interface OrgSettings {
  id: "org";
  company: string;
  logoUrl?: string;
  slaDaysDefault: number;
}

export interface Requisition {
  id: string;
  title: string;
  department: string;
  requisitionType: "New" | "Replacement";
  businessJustification?: string;
  replacementEmployeeCode?: string;
  lob: string;
  location: string;
  employment: string;
  level: string;
  salaryMin: number;
  salaryMax: number;
  priority: string;
  openings: number;
  notes: string;
  jdText: string;
  jdPath?: string;
  jdFileName?: string;
  status: ApprovalStatus;
  raisedByEmail: string;
  raisedByName: string;
  approvedAt?: string;
  approvedBy?: string;
  approvedByName?: string;
  rejectionReason?: string;
  recruiterEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  reqId: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  stage: CandidateStage;
  currentCtc?: string;
  currentFixedCtc?: string;
  currentVariableCtc?: string;
  presentEsops?: string;
  expectedCtc?: string;
  notice?: string;
  tentativeDoj?: string;
  offeredSalary?: string;
  offeredFixedCtc?: string;
  offeredVariableCtc?: string;
  offeredVariablePeriod?: "Monthly" | "Annually";
  offeredEsops?: string;
  joiningBonus?: string;
  relocationAssistance?: boolean;
  offerApprovalStatus?: "Pending" | "Approved" | "Rejected";
  offerRequestedBy?: string;
  offerRequestedAt?: string;
  offerDecisionBy?: string;
  offerDecisionAt?: string;
  offerRejectReason?: string;
  remarks?: string;
  /** Job Board | Employee Referral | Consultant */
  source?: string;
  /** Board name, employee code, or consultant agency */
  sourceDetail?: string;
  cvPath?: string;
  cvFileName?: string;
  hmDecisionBy?: string;
  hmDecisionAt?: string;
  hmRejectReason?: string;
  backedOutAt?: string;
  backedOutBy?: string;
  backOutReason?: string;
  /** Highest interview round the candidate was advanced past (debrief Advance). */
  lastAdvancedRound?: number;
  /** Recruiter consent captured after resume auto-detection. */
  consentCaptured?: boolean;
  consentCapturedAt?: string;
  consentCapturedBy?: string;
  extractedFromResume?: boolean;
  extractedName?: string;
  extractedPhone?: string;
  extractedEmail?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StageEvent {
  id: string;
  candidateId: string;
  reqId: string;
  fromStage: string;
  toStage: string;
  byEmail: string;
  at: string;
  note?: string;
}

export interface Interview {
  id: string;
  reqId: string;
  candidateId: string;
  stage: string;
  roundIndex?: number;
  roundName?: string;
  interviewerEmails: string[];
  datetime: string;
  meetLink?: string;
  calendarEventId?: string;
  status: "Scheduled" | "Completed" | "Cancelled" | "Rescheduled" | "Reschedule Requested";
  rescheduleRequestedBy?: "Candidate" | "Interviewer";
  feedbackPending?: boolean;
  feedbackAgeDays?: number;
  createdAt: string;
  createdBy: string;
}

export interface InterviewFeedback {
  id: string;
  candidateId: string;
  reqId: string;
  interviewId?: string;
  interviewer: string;
  stage: string;
  rating: number;
  recommendation: string;
  feedback: string;
  createdAt: string;
  createdBy: string;
}

export interface InterviewPlan {
  reqId: string;
  rounds: { name: string; type?: string; order: number; competencies?: string[] }[];
  updatedAt: string;
  updatedBy: string;
}

export interface Calibration {
  reqId: string;
  notes: string;
  filePaths: { name: string; path: string }[];
  updatedAt: string;
  updatedBy: string;
}

export interface AuditLog {
  id: string;
  action: string;
  actorEmail: string;
  entityType: string;
  entityId: string;
  detail?: string;
  actingAdminEmail?: string;
  at: string;
}
