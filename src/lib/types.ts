import type { JobDescriptionMark } from "./jobDescriptionFormatting";
export type Role = "Admin" | "Recruiter" | "HiringManager" | "DepartmentHead" | "Employee";

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
  | "Social CV"
  | "Social CV Reject"
  | "Rejected"
  | "Candidate Backed Out"
  | "On Hold"
  | "Debrief";

export interface RequisitionAccessScope {
  businessUnit: string;
  department: string;
  subDepartment?: string;
}

export interface AppUser {
  id: string;
  employeeCode?: string;
  email: string;
  name: string;
  role: Role;
  title: string;
  /** Departments this person covers (HM raises for these; DH approves these). */
  departments: string[];
  accessScopes?: RequisitionAccessScope[];
  managerEmail?: string;
  active: boolean;
  createdAt: string;
  actingAdminEmail?: string;
}

export type AppNotificationType = "requisition-submitted" | "requisition-approved" | "requisition-rejected";

export interface AppNotification {
  id: string;
  recipientEmail: string;
  type: AppNotificationType;
  requisitionId: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export type CandidateCustomField = { id: string; label: string; required: boolean; enabled: boolean };
export interface OrgSettings {
  subDepartments?: { department: string; name: string }[];
  businessUnits?: string[];
  departmentBusinessUnits?: { businessUnit: string; department: string }[];
  requisitionDepartmentRequired?: boolean;
  requisitionBusinessUnitRequired?: boolean;
  candidateCustomFields?: CandidateCustomField[];
  requisitionIdPrefix?: string;
  requisitionNextNumber?: number;
  requisitionSeparateSequences?: boolean;
  requisitionNewSequence?: { prefix: string; nextNumber: number };
  requisitionReplacementSequence?: { prefix: string; nextNumber: number };
  id: "org";
  company: string;
  logoUrl?: string;
  story?: string;
  shareCompanyOnSocialLinks?: boolean;
  foundedYear?: number;
  websiteUrl?: string;
  slaDaysDefault: number;
  feedbackFormTemplates?: FeedbackFormTemplate[];
  interviewFeedbackQuestions?: string[];
  rejectionEmailSubject?: string;
  rejectionEmailBody?: string;
  backedOutEmailSubject?: string;
  backedOutEmailBody?: string;
  employeeReferralsEnabled?: boolean;
  referralShareSalary?: boolean;
  offerJoiningEnabled?: boolean;
  vendorsSpendEnabled?: boolean;
  integrationRequests?: Partial<Record<"whatsapp" | "naukri" | "linkedin", boolean>>;
  jobBoardNames?: string[];
  referralBonusOverdueDays?: number;
  customDepartments?: string[];
  officeLocations?: { name: string; city?: string; address?: string }[];
}

export interface Requisition {
  accessScoped?: boolean;
  id: string;
  title: string;
  department: string;
  subDepartment?: string;
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
  priorityLevel?: string;
  previousPriorityLevel?: string;
  referralBonus?: number;
  referralInterviewBonus?: number;
  employeeReferralEnabled?: boolean;
  openings: number;
  notes: string;
  jdText: string;
  jdFormatting?: JobDescriptionMark[];
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
  recruiterCollaboratorEmails?: string[];
  careersPublished?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  customFields?: { id: string; label: string; value: string }[];
  /** Internal ID for this application record; retained by all existing module references. */
  id: string;
  /** UUID primary key for the person profile. Optional until legacy backfill is complete. */
  profileId?: string;
  /** Permanent, user-visible person identifier. */
  candidateId?: string;
  candidateIdAliases?: string[];
  /** Permanent, user-visible identifier for this requisition application. */
  applicationId?: string;
  /** Earlier application retained when a recruiter reopens this candidate. */
  previousApplicationRecordId?: string;
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
  skills?: string[];
  experienceYears?: number;
  notice?: string;
  tentativeDoj?: string;
  initialDoj?: string;
  currentDoj?: string;
  actualJoiningDate?: string;
  joiningStatus?: JoiningStatus;
  joiningStatusUpdatedAt?: string;
  joiningRemarks?: string;
  joiningUpdatedAt?: string;
  dojChangeCount?: number;
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
  /** Job Board | Employee Referral | Consultant | Direct / Inbound | Social CV */
  source?: string;
  /** Board name, employee code, or consultant agency */
  sourceDetail?: string;
  referrerEmail?: string;
  sourceVendorId?: string;
  sourceSubscriptionId?: string;
  sourceNotes?: string;
  employeeReferralBonus?: number;
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

export interface CandidateProfile {
  id: string;
  candidateId: string;
  candidateIdAliases: string[];
  name: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  location: string;
  mergedIntoProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export type VendorStatus = "Active" | "Inactive" | "Expired" | "Blacklisted";
export type ConsultantFeeType = "Percentage of Annual CTC" | "Fixed Amount Per Hire";
export type BillingFrequency = "Monthly" | "Quarterly" | "Annual" | "One-time";
export type VendorPaymentStatus = "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";

export interface RecruitmentConsultant {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  mobile?: string;
  alternateContact?: string;
  address?: string;
  city?: string;
  state?: string;
  website?: string;
  specialization: string[];
  hiringLocations: string[];
  feeType: ConsultantFeeType;
  defaultFee: number;
  feeCalculationBasis?: string;
  paymentTerms?: string;
  invoiceDueDays?: number;
  replacementGuaranteeDays?: number;
  freeReplacements?: number;
  feeCap?: number;
  gstApplicable?: boolean;
  gstNumber?: string;
  pan?: string;
  bankDetails?: string;
  agreementStartDate?: string;
  agreementExpiryDate?: string;
  agreementPath?: string;
  agreementFileName?: string;
  agreementStatus?: "Active" | "Expired" | "Pending";
  renewalReminderDays?: number[];
  agreementRemarks?: string;
  internalNotes?: string;
  status: VendorStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ConsultantFeeRule {
  id: string;
  vendorId: string;
  title?: string;
  requisitionId?: string;
  department?: string;
  feeType: ConsultantFeeType;
  fee: number;
  feeCap?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdBy: string;
  createdAt: string;
}

export interface ConsultantAgreementVersion {
  id: string;
  vendorId: string;
  agreementPath?: string;
  agreementFileName?: string;
  startDate: string;
  expiryDate: string;
  feeType: ConsultantFeeType;
  defaultFee: number;
  feeCap?: number;
  termsSnapshot: string;
  createdBy: string;
  createdAt: string;
}

export interface JobBoardSubscription {
  id: string;
  platformName: string;
  subscriptionType?: string;
  reference?: string;
  cost: number;
  billingFrequency: BillingFrequency;
  startDate: string;
  expiryDate: string;
  renewalDate?: string;
  licensesPurchased?: number;
  assignedRecruiterEmails: string[];
  resumeCredits?: number;
  postingCredits?: number;
  accountManager?: string;
  accountManagerEmail?: string;
  accountManagerContact?: string;
  agreementPath?: string;
  agreementFileName?: string;
  invoicePath?: string;
  invoiceFileName?: string;
  paymentStatus: VendorPaymentStatus;
  autoRenew: boolean;
  notes?: string;
  status: "Active" | "Inactive" | "Expired";
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CandidateApplicationSource {
  id: string;
  candidateId: string;
  requisitionId: string;
  source: string;
  consultantId?: string;
  subscriptionId?: string;
  sourceNotes?: string;
  submittedAt: string;
  submittedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlacementFee {
  id: string;
  candidateId: string;
  requisitionId: string;
  consultantId: string;
  candidateName: string;
  requisitionTitle: string;
  joiningDate: string;
  annualCtc: number;
  feeType: ConsultantFeeType;
  feeValue: number;
  feeCap?: number;
  expectedFee: number;
  feeRuleId?: string;
  feeSnapshot: string;
  status: "Estimated" | "Confirmed" | "Invoiced" | "Cancelled";
  adjustmentReason?: string;
  actualFee?: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface ReplacementGuarantee {
  id: string;
  placementFeeId: string;
  candidateId: string;
  consultantId: string;
  requisitionId: string;
  joiningDate: string;
  expiryDate: string;
  status: "Active" | "Potentially Eligible" | "Replacement Requested" | "Replacement In Progress" | "Replacement Completed" | "Expired" | "Not Applicable";
  replacementCandidateId?: string;
  requestReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VendorInvoice {
  id: string;
  invoiceNumber: string;
  consultantId?: string;
  subscriptionId?: string;
  candidateId?: string;
  placementFeeId?: string;
  requisitionId?: string;
  invoiceDate: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  dueDate: string;
  paymentStatus: VendorPaymentStatus;
  amountPaid?: number;
  paymentDate?: string;
  paymentReference?: string;
  attachmentPath?: string;
  attachmentName?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export type RecruitmentExpenseCategory = "Recruitment Consultant Fees" | "Job Board Subscriptions" | "Employee Referral Bonuses" | "Recruitment Advertising" | "Social Media Campaigns" | "Campus Recruitment" | "Assessment / Interview" | "Other Recruitment Expenses" | "Internal Recruitment Costs";

export interface RecruitmentExpense {
  id: string;
  category: RecruitmentExpenseCategory;
  description: string;
  amount: number;
  expenseDate: string;
  department?: string;
  location?: string;
  requisitionId?: string;
  requisitionIds?: string[];
  recruitmentSource?: string;
  consultantId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  placementFeeId?: string;
  estimated: boolean;
  attachmentPath?: string;
  attachmentName?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface RecruitmentBudget {
  id: string;
  name: string;
  type: "Monthly" | "Quarterly" | "Annual";
  amount: number;
  startDate: string;
  endDate: string;
  department?: string;
  location?: string;
  alertThresholds: number[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface VendorAuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  detail?: string;
  actorEmail: string;
  at: string;
}

export interface VendorReminder {
  id: string;
  type: "Consultant Agreement Expiry" | "Job Board Subscription Renewal" | "Consultant Invoice Due Date" | "Replacement Guarantee Expiry";
  entityId: string;
  entityName: string;
  dueDate: string;
  remindOn: string;
  daysRemaining: number;
  amount?: number;
}

export type JoiningStatus =
  | "Awaiting Confirmation"
  | "Confirmed"
  | "Rescheduled"
  | "Joined"
  | "No-Show"
  | "Candidate Withdrawn";

export interface DojChangeHistory {
  id: string;
  candidateId: string;
  previousDoj: string;
  revisedDoj: string;
  reason: string;
  remarks?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface JoiningStatusHistory {
  id: string;
  candidateId: string;
  previousStatus: JoiningStatus;
  newStatus: JoiningStatus;
  reason?: string;
  remarks?: string;
  updatedBy: string;
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

export interface FeedbackQuestion { label: string; description?: string; type: "short" | "paragraph" | "dropdown" | "multiple" | "checkboxes" | "scale" | "stars"; required: boolean; options: string[]; scaleMax: number }
export interface FeedbackFormTemplate { id: string; name: string; description?: string; questions: (FeedbackQuestion | string)[] }

export type InterviewFormat = "video" | "in-person" | "phone";

export interface Interview {
  durationMinutes?: number;
  breakMinutes?: number;
  driveId?: string;
  room?: string;
  officeLocation?: string;
  format?: InterviewFormat;
  location?: string;
  phoneInstructions?: string;
  id: string;
  reqId: string;
  candidateId: string;
  stage: string;
  roundIndex?: number;
  roundName?: string;
  feedbackForm?: FeedbackFormTemplate;
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
  customAnswers?: { question: string; answer: string }[];
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

export interface ReferralPayout {
  id: string;
  reqId: string;
  candidateId: string;
  candidateName: string;
  referrerEmail: string;
  roundIndex: number;
  roundName: string;
  amount: number;
  kind?: "InterviewRound" | "Joining";
  decision: "Advance" | "Onboarded";
  status: "Pending" | "Overdue" | "Paid";
  earnedAt: string;
  joiningDate?: string;
  dueAt?: string;
  paidAt?: string;
  paidBy?: string;
}

export interface InterviewPlan {
  reqId: string;
  rounds: { name: string; type?: string; order: number; competencies?: string[]; feedbackFormId?: string; applicable?: boolean }[];
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

