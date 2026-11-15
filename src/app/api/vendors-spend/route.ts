import { isAssignedRecruiter } from "@/lib/recruiterAssignment";
import { NextRequest } from "next/server";
import { uninvoicedSubscriptionCost } from "@/lib/subscriptionCost";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import {
  createVendorAudit,
  createVendorSpendRecord,
  getOrg,
  getRequisition,
  getVendorSpendRecord,
  listCandidateApplicationSources,
  listCandidates,
  listReferralPayouts,
  listRequisitions,
  listStageEvents,
  listVendorSpendRecords,
  saveOrg,
  updateVendorSpendRecord,
} from "@/lib/db";
import type { VendorSpendResource } from "@/lib/db/vendorsSpend";
import type {
  ConsultantFeeRule,
  JobBoardSubscription,
  PlacementFee,
  RecruitmentConsultant,
  RecruitmentExpense,
  VendorInvoice,
  VendorPaymentStatus,
} from "@/lib/types";

const RESOURCE_PREFIX: Record<string, string> = {
  consultants: "VEN",
  subscriptions: "SUB",
  invoices: "INV",
  placementFees: "PLF",
  guarantees: "GUA",
  expenses: "EXP",
  budgets: "BUD",
  feeRules: "FEE",
};
const ADMIN_ONLY_RESOURCES = new Set(["placementFees", "guarantees", "expenses", "budgets", "feeRules", "agreements", "audit", "costAnalytics"]);
const PAYMENT_STATUSES: VendorPaymentStatus[] = ["Pending", "Partially Paid", "Paid", "Overdue", "Cancelled"];

async function validateExpenseRequests(data: Record<string, unknown>) {
  if (data.requisitionIds === undefined) return;
  if (!Array.isArray(data.requisitionIds) || data.requisitionIds.length > 100 || data.requisitionIds.some((id: unknown) => typeof id !== "string" || !id.trim())) throw new ApiError(400, "Choose valid hiring requests.");
  const ids = [...new Set(data.requisitionIds as string[])];
  const existing = new Set((await listRequisitions()).map((req) => req.id));
  if (ids.some((id) => !existing.has(id))) throw new ApiError(400, "One or more selected hiring requests no longer exist.");
  data.requisitionIds = ids;
  data.requisitionId = "";
}

async function validateInvoiceSubscription(data: Record<string, unknown>) {
  if (!data.subscriptionId) return;
  if (typeof data.subscriptionId !== "string" || !(await listVendorSpendRecords<JobBoardSubscription>("subscriptions")).some((item) => item.id === data.subscriptionId)) throw new ApiError(400, "Choose an existing job board subscription.");
}

async function requireInvoicePlacementAccess(user: Awaited<ReturnType<typeof requireUser>>, placementFeeId: unknown) {
  if (user.role !== "Recruiter" || typeof placementFeeId !== "string" || !placementFeeId.trim()) return;
  const id = placementFeeId.trim();
  if (id.includes("/")) throw new ApiError(400, "Invalid placement reference.");
  const fee = await getVendorSpendRecord<PlacementFee>("placementFees", id);
  const requisition = fee?.requisitionId && await getRequisition(fee.requisitionId);
  if (!requisition || !isAssignedRecruiter(requisition, user.email)) {
    throw new ApiError(403, "You can only link invoices to placements on requisitions assigned to you.");
  }
}

async function requireVendorsSpendUser(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "Admin" && user.role !== "Recruiter") {
    throw new ApiError(403, "Vendors & Spend is available to Admins and Recruiters.");
  }
  if (!(await getOrg()).vendorsSpendEnabled) {
    throw new ApiError(404, "Vendors & Spend is not enabled for this organization.");
  }
  return user;
}

function sanitizeConsultant(vendor: RecruitmentConsultant) {
  const restricted = new Set(["pan", "gstNumber", "bankDetails", "feeType", "defaultFee", "feeCap", "paymentTerms", "invoiceDueDays", "feeCalculationBasis"]);
  return Object.fromEntries(Object.entries(vendor).filter(([key]) => !restricted.has(key)));
}

function sanitizeSubscription(subscription: JobBoardSubscription) {
  const restricted = new Set(["cost", "paymentStatus", "autoRenew"]);
  return Object.fromEntries(Object.entries(subscription).filter(([key]) => !restricted.has(key)));
}

function dateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return dateOnly(date);
}

function dateInRange(value: string | undefined, from: string, to: string) {
  return !!value && (!from || value >= from) && (!to || value <= to);
}

async function buildReminders() {
  const [consultants, subscriptions, invoices, guarantees] = await Promise.all([
    listVendorSpendRecords<RecruitmentConsultant>("consultants"),
    listVendorSpendRecords<JobBoardSubscription>("subscriptions"),
    listVendorSpendRecords<VendorInvoice>("invoices"),
    listVendorSpendRecords("guarantees"),
  ]);
  const today = dateOnly(new Date());
  const reminders: { id: string; type: string; entityId: string; entityName: string; dueDate: string; remindOn: string; daysRemaining: number; amount?: number }[] = [];
  const pushSchedule = (input: { id: string; type: string; name: string; due: string; offsets: number[]; amount?: number }) => {
    if (!input.due) return;
    for (const offset of input.offsets) {
      const remindOn = addDays(input.due, -offset);
      const daysRemaining = Math.round((new Date(`${input.due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
      if (remindOn && remindOn <= today && daysRemaining >= 0) {
        reminders.push({ id: `${input.type}_${input.id}_${offset}`, type: input.type, entityId: input.id, entityName: input.name, dueDate: input.due, remindOn, daysRemaining, ...(input.amount !== undefined ? { amount: input.amount } : {}) });
      }
    }
  };
  for (const consultant of consultants.filter((item) => item.status === "Active")) {
    pushSchedule({ id: consultant.id, type: "Consultant Agreement Expiry", name: consultant.name, due: consultant.agreementExpiryDate || "", offsets: consultant.renewalReminderDays?.length ? consultant.renewalReminderDays : [60, 30, 15, 7] });
  }
  for (const subscription of subscriptions.filter((item) => item.status === "Active")) {
    pushSchedule({ id: subscription.id, type: "Job Board Subscription Renewal", name: subscription.platformName, due: subscription.renewalDate || subscription.expiryDate, offsets: [60, 30, 15] });
  }
  for (const invoice of invoices.filter((item) => !["Paid", "Cancelled"].includes(item.paymentStatus))) {
    const vendor = consultants.find((item) => item.id === invoice.consultantId);
    pushSchedule({ id: invoice.id, type: "Consultant Invoice Due Date", name: `${vendor?.name || "Vendor"} invoice ${invoice.invoiceNumber}`, due: invoice.dueDate, offsets: [15, 7, 3], amount: invoice.totalAmount });
  }
  for (const guarantee of guarantees as { id: string; candidateName?: string; expiryDate: string; status: string }[]) {
    if (["Active", "Potentially Eligible"].includes(guarantee.status)) {
      pushSchedule({ id: guarantee.id, type: "Replacement Guarantee Expiry", name: `${guarantee.candidateName || "Placement"} guarantee`, due: guarantee.expiryDate, offsets: [15, 7, 3] });
    }
  }
  return reminders.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

async function buildOverview(user: Awaited<ReturnType<typeof requireVendorsSpendUser>>, from: string, to: string) {
  const [consultants, subscriptions, expenses, fees, candidates, applications, referrals, invoices] = await Promise.all([
    listVendorSpendRecords<RecruitmentConsultant>("consultants"),
    listVendorSpendRecords<JobBoardSubscription>("subscriptions"),
    listVendorSpendRecords<RecruitmentExpense>("expenses"),
    listVendorSpendRecords("placementFees"),
    listCandidates(undefined, true),
    listCandidateApplicationSources(),
    listReferralPayouts(),
    listVendorSpendRecords<VendorInvoice>("invoices"),
  ]);
  const activeConsultants = consultants.filter((item) => item.status === "Active");
  const activeSubscriptions = subscriptions.filter((item) => item.status === "Active");
  const visibleInvoices = user.role === "Admin" ? invoices : invoices.filter((invoice) => invoice.createdBy === user.email);
  const hired = candidates.filter((candidate) => candidate.stage === "Onboarded" || candidate.joiningStatus === "Joined");
  const uniqueHires = new Map(hired.map((candidate) => [candidate.id, candidate]));
  const inRangeExpenses = expenses.filter((item) => dateInRange(item.expenseDate, from, to));
  const inRangeFees = (fees as { candidateId: string; expectedFee: number; actualFee?: number; status: string; createdAt: string }[])
    .filter((item) => dateInRange(item.createdAt?.slice(0, 10), from, to) && item.status !== "Cancelled");
  const inRangeInvoices = visibleInvoices.filter((invoice) => dateInRange(invoice.invoiceDate, from, to) && invoice.paymentStatus !== "Cancelled");
  const invoicesLinkedToFees = new Set(inRangeInvoices.map((invoice) => invoice.placementFeeId).filter(Boolean));
  const expenseTotal = inRangeExpenses.filter((item) => !item.invoiceId).reduce((sum, item) => sum + item.amount, 0);
  const feeTotal = inRangeFees.filter((fee) => !invoicesLinkedToFees.has((fee as { id?: string }).id)).reduce((sum, item) => sum + (item.actualFee ?? item.expectedFee), 0);
  const invoiceTotal = inRangeInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const referralTotal = referrals.filter((payout) => dateInRange(payout.earnedAt.slice(0, 10), from, to)).reduce((sum, payout) => sum + payout.amount, 0);
  const periodStart = from || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
  const periodEnd = to || dateOnly(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const periodStartMs = new Date(`${periodStart}T00:00:00`).getTime();
  const periodEndMs = new Date(`${periodEnd}T23:59:59`).getTime();
  const subscriptionTotal = subscriptions.reduce((sum, subscription) => {
    const start = new Date(`${subscription.startDate}T00:00:00`).getTime();
    const end = new Date(`${subscription.expiryDate}T23:59:59`).getTime();
    const overlap = Math.max(0, Math.min(end, periodEndMs) - Math.max(start, periodStartMs));
    const duration = Math.max(1, end - start);
    return sum + uninvoicedSubscriptionCost(subscription, visibleInvoices) * overlap / duration;
  }, 0);
  const totalSpend = expenseTotal + feeTotal + invoiceTotal + referralTotal + subscriptionTotal;
  const vendorById = new Map(consultants.map((item) => [item.id, item]));
  const consultantCounts = new Map<string, { submitted: number; interviewed: number; offers: number; joined: number; candidateIds: Set<string> }>();
  for (const application of applications) {
    if (!application.consultantId || !dateInRange(application.submittedAt.slice(0, 10), from, to)) continue;
    const candidate = candidates.find((item) => item.id === application.candidateId);
    if (!candidate) continue;
    const stats = consultantCounts.get(application.consultantId) || { submitted: 0, interviewed: 0, offers: 0, joined: 0, candidateIds: new Set<string>() };
    if (!stats.candidateIds.has(candidate.id)) stats.submitted += 1;
    stats.candidateIds.add(candidate.id);
    if (["Interview", "Interview Scheduled", "Debrief", "Selected", "OfferApprovalPending", "OfferApproved", "Offered", "Onboarded"].includes(candidate.stage)) stats.interviewed += 1;
    if (["OfferApprovalPending", "OfferApproved", "Offered", "Onboarded"].includes(candidate.stage)) stats.offers += 1;
    if (candidate.stage === "Onboarded" || candidate.joiningStatus === "Joined") stats.joined += 1;
    consultantCounts.set(application.consultantId, stats);
  }
  const topConsultants = [...consultantCounts.entries()].map(([vendorId, stats]) => ({
    vendorId,
    consultantName: vendorById.get(vendorId)?.name || vendorId,
    submitted: stats.submitted,
    interviewed: stats.interviewed,
    offers: stats.offers,
    joined: stats.joined,
    conversion: stats.submitted ? (stats.joined / stats.submitted) * 100 : 0,
  })).sort((left, right) => right.joined - left.joined).slice(0, 10);
  const expensesBySource = new Map<string, number>();
  for (const expense of inRangeExpenses) expensesBySource.set(expense.category, (expensesBySource.get(expense.category) || 0) + expense.amount);
  if (user.role === "Recruiter") {
    return {
      activeConsultants: activeConsultants.length,
      activeSubscriptions: activeSubscriptions.length,
      reminders: (await buildReminders()).filter((reminder) => !reminder.type.includes("Invoice")),
      topConsultants: topConsultants.map(({ vendorId, consultantName, submitted, interviewed, offers, joined, conversion }) => ({ vendorId, consultantName, submitted, interviewed, offers, joined, conversion })),
      isAdmin: false,
    };
  }
  return {
    activeConsultants: activeConsultants.length,
    activeSubscriptions: activeSubscriptions.length,
    monthlySpend: totalSpend,
    averageCostPerHire: uniqueHires.size ? totalSpend / uniqueHires.size : null,
    totalSpend,
    successfulHires: uniqueHires.size,
    monthlyTrend: [...expensesBySource.entries()].map(([label, value]) => ({ label, value })),
    topConsultants,
    sourceBreakdown: [...expensesBySource.entries()].map(([source, value]) => ({ source, value })),
    reminders: await buildReminders(),
    invoices: visibleInvoices,
    isAdmin: true,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireVendorsSpendUser(request);
    const params = request.nextUrl.searchParams;
    const resource = params.get("resource") || "overview";
    if (resource === "catalog") {
      const [consultants, subscriptions] = await Promise.all([
        listVendorSpendRecords<RecruitmentConsultant>("consultants"),
        listVendorSpendRecords<JobBoardSubscription>("subscriptions"),
      ]);
      return json({
        consultants: consultants.filter((item) => item.status === "Active").map((item) => user.role === "Admin" ? item : sanitizeConsultant(item)),
        subscriptions: subscriptions.filter((item) => item.status === "Active").map((item) => user.role === "Admin" ? item : sanitizeSubscription(item)),
      });
    }
    if (resource === "overview") return json(await buildOverview(user, params.get("from") || "", params.get("to") || ""));
    if (resource === "costAnalytics") {
      if (user.role !== "Admin") throw new ApiError(403, "Cost-per-hire analytics are restricted to Admins.");
      return json(await buildCostAnalytics(params.get("from") || "", params.get("to") || ""));
    }
    if (resource === "vendorProfile") {
      const vendorId = params.get("id") || "";
      if (!vendorId) throw new ApiError(400, "Consultant ID is required.");
      const vendor = await getVendorSpendRecord<RecruitmentConsultant>("consultants", vendorId);
      if (!vendor) throw new ApiError(404, "Consultant not found.");
      if (user.role === "Recruiter" && vendor.status !== "Active") throw new ApiError(404, "Consultant not found.");
      const [agreements, feeRules, placements, invoices, guarantees, applications, candidates, requisitions, events] = await Promise.all([
        listVendorSpendRecords("agreements"),
        listVendorSpendRecords<ConsultantFeeRule>("feeRules"),
        listVendorSpendRecords("placementFees"),
        listVendorSpendRecords<VendorInvoice>("invoices"),
        listVendorSpendRecords("guarantees"),
        listCandidateApplicationSources(),
        listCandidates(undefined, true),
        listRequisitions(),
        listStageEvents(),
      ]);
      const vendorApplications = applications.filter((application) => application.consultantId === vendorId);
      const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      const requisitionsById = new Map(requisitions.map((requisition) => [requisition.id, requisition]));
      const candidateRows = vendorApplications.map((application) => ({
        ...application,
        candidate: candidatesById.get(application.candidateId),
        requisition: requisitionsById.get(application.requisitionId),
      })).filter((row) => !!row.candidate);
      const submittedIds = new Set(vendorApplications.map((application) => application.candidateId));
      const submittedCandidates = [...submittedIds].map((id) => candidatesById.get(id)).filter(Boolean);
      const interviewed = submittedCandidates.filter((candidate) => ["Interview", "Interview Scheduled", "Debrief", "Selected", "OfferApprovalPending", "OfferApproved", "Offered", "Onboarded"].includes(candidate!.stage)).length;
      const offerEvents = events.filter((event) => event.toStage === "Offered" && submittedIds.has(event.candidateId)).length;
      const joined = submittedCandidates.filter((candidate) => candidate!.stage === "Onboarded" || candidate!.joiningStatus === "Joined");
      const timeToHire = joined.map((candidate) => Math.max(0, (new Date(candidate!.updatedAt).getTime() - new Date(candidate!.createdAt).getTime()) / 86400000));
      const stats = {
        submitted: vendorApplications.length,
        interviewed,
        offers: offerEvents,
        joined: joined.length,
        offerToJoin: offerEvents ? joined.length / offerEvents * 100 : null,
        submissionToJoin: vendorApplications.length ? joined.length / vendorApplications.length * 100 : null,
        averageTimeToHireDays: timeToHire.length ? timeToHire.reduce((sum, value) => sum + value, 0) / timeToHire.length : null,
        replacementRequests: (guarantees as { consultantId?: string; status?: string }[]).filter((item) => item.consultantId === vendorId && ["Potentially Eligible", "Replacement Requested", "Replacement In Progress"].includes(String(item.status))).length,
      };
      const visibleVendor = user.role === "Admin" ? vendor : sanitizeConsultant(vendor);
      const visiblePlacements = (placements as { consultantId?: string; candidateId?: string; id?: string; candidateName?: string; expectedFee?: number; actualFee?: number; status?: string }[]).filter((item) => item.consultantId === vendorId);
      const visibleInvoices = invoices.filter((item) => item.consultantId === vendorId && (user.role === "Admin" || item.createdBy === user.email));
      return json({
        vendor: visibleVendor,
        stats: user.role === "Admin" ? { ...stats, totalPlacementFees: visiblePlacements.reduce((sum, item) => sum + Number(item.actualFee ?? item.expectedFee ?? 0), 0) } : stats,
        candidates: candidateRows.map((row) => ({
          ...row,
          ...(row.candidate ? { candidate: { id: row.candidate.id, name: row.candidate.name, email: row.candidate.email, stage: row.candidate.stage, createdAt: row.candidate.createdAt, updatedAt: row.candidate.updatedAt } } : {}),
        })),
        agreements: agreements.filter((item) => item.vendorId === vendorId),
        feeRules: user.role === "Admin" ? feeRules.filter((item) => item.vendorId === vendorId) : [],
        placements: user.role === "Admin" ? visiblePlacements : visiblePlacements.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !["expectedFee", "actualFee", "feeValue", "feeCap"].includes(key)))),
        invoices: user.role === "Admin" ? visibleInvoices : visibleInvoices.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, candidateId: invoice.candidateId })),
        guarantees: guarantees.filter((item) => item.consultantId === vendorId),
      });
    }
    if (resource === "reminders") {
      const reminders = await buildReminders();
      return json({ reminders: user.role === "Admin" ? reminders : reminders.filter((item) => !item.type.includes("Invoice")) });
    }
    if (user.role === "Recruiter" && ADMIN_ONLY_RESOURCES.has(resource)) throw new ApiError(403, "This financial information is restricted to Admins.");
    if (!(resource in RESOURCE_PREFIX) && !["agreements", "audit"].includes(resource)) throw new ApiError(400, "Unknown Vendors & Spend section.");
    let records = await listVendorSpendRecords(resource as VendorSpendResource);
    if (resource === "consultants") {
      const consultants = records as unknown as RecruitmentConsultant[];
      records = user.role === "Admin" ? records : consultants.filter((item) => item.status === "Active").map(sanitizeConsultant);
    } else if (resource === "subscriptions") {
      const subscriptions = records as unknown as JobBoardSubscription[];
      records = user.role === "Admin" ? records : subscriptions.filter((item) => item.status === "Active").map(sanitizeSubscription);
    } else if (resource === "invoices" && user.role === "Recruiter") {
      const invoices = records as unknown as VendorInvoice[];
      records = invoices.filter((item) => item.createdBy === user.email).map((invoice) => Object.fromEntries(
        Object.entries(invoice).filter(([key]) => !["amount", "taxAmount", "totalAmount", "paymentStatus", "amountPaid", "paymentDate", "paymentReference"].includes(key))
      ));
    }
    return json({ records });
  } catch (error) {
    return errResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireVendorsSpendUser(request);
    const body = await request.json();
    const resource = String(body.resource || "");
    if (user.role === "Recruiter" && (ADMIN_ONLY_RESOURCES.has(resource) || ["consultants", "subscriptions"].includes(resource))) {
      throw new ApiError(403, "Only Admins can manage consultant and subscription records.");
    }
    if (!(resource in RESOURCE_PREFIX)) throw new ApiError(400, "Choose a valid Vendors & Spend record type.");
    const resourceKey = resource as VendorSpendResource;
    const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
    const timestamp = new Date().toISOString();
    let record: Record<string, unknown>;
    if (resource === "consultants") {
      const name = String(data.name || "").trim();
      const contactPerson = String(data.contactPerson || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const defaultFee = Number(data.defaultFee);
      if (!name || !contactPerson || !email || !Number.isFinite(defaultFee) || defaultFee < 0) throw new ApiError(400, "Consultant name, contact person, valid email, and a non-negative fee are required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid consultant email address.");
      record = { ...data, name, contactPerson, email, defaultFee, feeType: data.feeType === "Fixed Amount Per Hire" ? data.feeType : "Percentage of Annual CTC", status: data.status || "Active", createdBy: user.email, updatedBy: user.email };
    } else if (resource === "subscriptions") {
      const platformName = String(data.platformName || "").trim();
      const cost = Number(data.cost);
      if (!platformName || !Number.isFinite(cost) || cost < 0 || !data.startDate || !data.expiryDate) throw new ApiError(400, "Platform, non-negative subscription cost, start date, and expiry date are required.");
      record = { ...data, platformName, cost, status: data.status || "Active", paymentStatus: data.paymentStatus || "Pending", assignedRecruiterEmails: Array.isArray(data.assignedRecruiterEmails) ? data.assignedRecruiterEmails : [], createdBy: user.email, updatedBy: user.email };
      const org = await getOrg();
      const names = new Set([...(org.jobBoardNames || []), platformName]);
      await saveOrg({ jobBoardNames: [...names] });
    } else if (resource === "invoices") {
      await validateInvoiceSubscription(data);
      await requireInvoicePlacementAccess(user, data.placementFeeId);
      const invoiceNumber = String(data.invoiceNumber || "").trim();
      const amount = Number(data.amount);
      const taxAmount = Number(data.taxAmount || 0);
      const totalAmount = Number(data.totalAmount ?? amount + taxAmount);
      if (!invoiceNumber || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(taxAmount) || taxAmount < 0 || !Number.isFinite(totalAmount) || totalAmount < 0 || !data.invoiceDate || !data.dueDate) throw new ApiError(400, "Invoice number, dates, and valid amounts are required.");
      const paymentStatus = user.role === "Admin" && PAYMENT_STATUSES.includes(data.paymentStatus as VendorPaymentStatus) ? data.paymentStatus : "Pending";
      record = { ...data, invoiceNumber, amount, taxAmount, totalAmount, paymentStatus, amountPaid: user.role === "Admin" ? Number(data.amountPaid || 0) : 0, createdBy: user.email, updatedBy: user.email };
    } else if (resource === "expenses") {
      await validateExpenseRequests(data);
      const amount = Number(data.amount);
      if (!String(data.description || "").trim() || !Number.isFinite(amount) || amount < 0 || !data.expenseDate) throw new ApiError(400, "Expense description, date, and valid amount are required.");
      record = { ...data, amount, estimated: data.estimated === true, createdBy: user.email, updatedBy: user.email };
    } else if (resource === "budgets") {
      const amount = Number(data.amount);
      if (!String(data.name || "").trim() || !Number.isFinite(amount) || amount < 0 || !data.startDate || !data.endDate) throw new ApiError(400, "Budget name, period, and valid amount are required.");
      record = { ...data, amount, alertThresholds: Array.isArray(data.alertThresholds) ? data.alertThresholds : [75, 90, 100], createdBy: user.email, updatedBy: user.email };
    } else if (resource === "feeRules") {
      const fee = Number(data.fee);
      if (!data.vendorId || !Number.isFinite(fee) || fee < 0 || !data.effectiveFrom || !(await listVendorSpendRecords<RecruitmentConsultant>("consultants")).some((vendor) => vendor.id === data.vendorId && vendor.status === "Active")) throw new ApiError(400, "Choose an active consultant, valid fee, and effective date.");
      record = { ...data, fee, createdBy: user.email };
    } else {
      record = { ...data, createdBy: user.email, updatedBy: user.email };
    }
    const saved = await createVendorSpendRecord(resourceKey, RESOURCE_PREFIX[resource], record);
    if (resource === "consultants") {
      const consultant = saved as unknown as RecruitmentConsultant;
      await createVendorSpendRecord("agreements", "AGR", {
        vendorId: consultant.id,
        agreementPath: consultant.agreementPath,
        agreementFileName: consultant.agreementFileName,
        startDate: consultant.agreementStartDate || timestamp.slice(0, 10),
        expiryDate: consultant.agreementExpiryDate || "",
        feeType: consultant.feeType,
        defaultFee: consultant.defaultFee,
        feeCap: consultant.feeCap,
        termsSnapshot: JSON.stringify({ paymentTerms: consultant.paymentTerms, invoiceDueDays: consultant.invoiceDueDays, replacementGuaranteeDays: consultant.replacementGuaranteeDays }),
        createdBy: user.email,
      });
    }
    await createVendorAudit({ entityType: resource, entityId: String(saved.id), action: "create", actorEmail: user.email, detail: String(saved.name || saved.platformName || saved.invoiceNumber || "") });
    return json({ record: saved }, 201);
  } catch (error) {
    return errResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireVendorsSpendUser(request);
    const body = await request.json();
    const resource = String(body.resource || "");
    const id = String(body.id || "");
    if (!id || !(resource in RESOURCE_PREFIX)) throw new ApiError(400, "Record type and ID are required.");
    if (user.role === "Recruiter" && (ADMIN_ONLY_RESOURCES.has(resource) || resource === "consultants" || resource === "subscriptions" || (resource === "invoices" && body.data && Object.keys(body.data).some((key) => ["paymentStatus", "amountPaid", "paymentDate", "paymentReference"].includes(key))))) {
      throw new ApiError(403, "You do not have permission to update this financial information.");
    }
    const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
    const resourceKey = resource as VendorSpendResource;
    const existing = await listVendorSpendRecords<Record<string, unknown>>(resourceKey);
    const previous = existing.find((record) => record.id === id);
    if (!previous) throw new ApiError(404, "Record not found.");
    const patch: Record<string, unknown> = { ...data, updatedBy: user.email };
    if (resource === "expenses") await validateExpenseRequests(patch);
    if (resource === "invoices") await validateInvoiceSubscription(patch);
    if (resource === "invoices" && user.role === "Recruiter") {
      const current = previous as unknown as VendorInvoice;
      if (current.createdBy !== user.email) throw new ApiError(403, "You can only update invoices you uploaded.");
      await requireInvoicePlacementAccess(user, data.placementFeeId ?? current.placementFeeId);
      delete patch.paymentStatus;
      delete patch.amountPaid;
      delete patch.paymentDate;
      delete patch.paymentReference;
    }
    const updated = await updateVendorSpendRecord(resourceKey, id, patch as Record<string, unknown>);
    await createVendorAudit({ entityType: resource, entityId: id, action: "update", actorEmail: user.email, detail: JSON.stringify(Object.keys(data)) });
    return json({ record: updated });
  } catch (error) {
    return errResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireVendorsSpendUser(request);
    if (user.role !== "Admin") throw new ApiError(403, "Only Admins can deactivate Vendors & Spend records.");
    const { resource, id } = Object.fromEntries(request.nextUrl.searchParams.entries());
    if (!id || !["consultants", "subscriptions"].includes(resource)) throw new ApiError(400, "Choose a consultant or subscription to deactivate.");
    const updated = await updateVendorSpendRecord(resource as "consultants" | "subscriptions", id, { status: "Inactive", updatedBy: user.email });
    if (!updated) throw new ApiError(404, "Record not found.");
    await createVendorAudit({ entityType: resource, entityId: id, action: "deactivate", actorEmail: user.email });
    return json({ record: updated });
  } catch (error) {
    return errResponse(error);
  }
}

async function buildCostAnalytics(from: string, to: string) {
  const [candidates, applications, requisitions, expenses, fees, invoices, subscriptions, referrals, events] = await Promise.all([
    listCandidates(undefined, true),
    listCandidateApplicationSources(),
    listRequisitions(),
    listVendorSpendRecords<RecruitmentExpense>("expenses"),
    listVendorSpendRecords<{ id: string; candidateId: string; requisitionId: string; consultantId: string; expectedFee: number; actualFee?: number; status: string; joiningDate: string }>("placementFees"),
    listVendorSpendRecords<VendorInvoice>("invoices"),
    listVendorSpendRecords<JobBoardSubscription>("subscriptions"),
    listReferralPayouts(),
    listStageEvents(),
  ]);
  const reqById = new Map(requisitions.map((item) => [item.id, item]));
  const applicationByPlacement = new Map(applications.map((item) => [`${item.candidateId}_${item.requisitionId}`, item]));
  const joinedAt = new Map<string, string>();
  for (const event of events) {
    if (event.toStage !== "Onboarded") continue;
    const current = joinedAt.get(event.candidateId);
    if (!current || event.at < current) joinedAt.set(event.candidateId, event.at);
  }
  const successfulHires = candidates.filter((candidate) => {
    const joinedDate = candidate.actualJoiningDate || joinedAt.get(candidate.id)?.slice(0, 10) || (candidate.joiningStatus === "Joined" ? candidate.joiningStatusUpdatedAt?.slice(0, 10) : "") || (candidate.stage === "Onboarded" ? candidate.updatedAt.slice(0, 10) : "");
    return (candidate.stage === "Onboarded" || candidate.joiningStatus === "Joined") && dateInRange(joinedDate, from, to);
  });
  const uniqueHires = new Map(successfulHires.map((candidate) => [candidate.id, candidate]));
  type CostItem = { date: string; amount: number; category: string; source: string; consultant: string; department: string; location: string; position: string; requisitionId?: string; estimated: boolean; allocation?: "shared" | "direct" };
  const costItems: CostItem[] = [];
  const invoiceByPlacement = new Map(invoices.filter((invoice) => invoice.placementFeeId && invoice.paymentStatus !== "Cancelled").map((invoice) => [invoice.placementFeeId!, invoice]));
  for (const fee of fees.filter((item) => item.status !== "Cancelled" && !invoiceByPlacement.has(item.id))) {
    if (!dateInRange(fee.joiningDate, from, to)) continue;
    const requisition = reqById.get(fee.requisitionId);
    costItems.push({ date: fee.joiningDate, amount: fee.actualFee ?? fee.expectedFee, category: "Consultant Fee", source: "Recruitment Consultant", consultant: fee.consultantId, department: requisition?.department || "Unassigned", location: requisition?.location || "Unassigned", position: requisition?.title || fee.requisitionId, requisitionId: fee.requisitionId, estimated: fee.status === "Estimated" && fee.actualFee === undefined });
  }
  for (const invoice of invoices.filter((item) => item.paymentStatus !== "Cancelled")) {
    if (!dateInRange(invoice.invoiceDate, from, to)) continue;
    const fee = invoice.placementFeeId ? fees.find((item) => item.id === invoice.placementFeeId) : undefined;
    const reqId = invoice.requisitionId || fee?.requisitionId;
    const requisition = reqId ? reqById.get(reqId) : undefined;
    const application = fee ? applicationByPlacement.get(`${fee.candidateId}_${fee.requisitionId}`) : undefined;
    const consultantName = application?.consultantId || invoice.consultantId || "Unassigned";
    costItems.push({ date: invoice.invoiceDate, amount: invoice.totalAmount, category: "Invoice", source: fee ? "Recruitment Consultant" : invoice.subscriptionId ? "Job Board Subscription" : "Vendor Invoice", consultant: consultantName, department: requisition?.department || "Unassigned", location: requisition?.location || "Unassigned", position: requisition?.title || "Shared cost", ...(reqId ? { requisitionId: reqId } : {}), estimated: false });
  }
  for (const expense of expenses.filter((item) => !item.invoiceId && !item.placementFeeId)) {
    if (!dateInRange(expense.expenseDate, from, to)) continue;
    const ids = expense.requisitionIds?.length ? [...new Set(expense.requisitionIds)] : expense.requisitionId ? [expense.requisitionId] : [];
    const allocations = ids.length ? ids : [undefined];
    const totalPaise = Math.round(expense.amount * 100);
    const basePaise = Math.floor(totalPaise / allocations.length);
    const remainder = totalPaise - basePaise * allocations.length;
    allocations.forEach((reqId, index) => {
      const requisition = reqId ? reqById.get(reqId) : undefined;
      const app = reqId ? applications.find((item) => item.requisitionId === reqId && (expense.consultantId ? item.consultantId === expense.consultantId : item.source === expense.recruitmentSource)) : undefined;
      costItems.push({ date: expense.expenseDate, amount: (basePaise + (index < remainder ? 1 : 0)) / 100, category: expense.category, source: expense.recruitmentSource || expense.category, consultant: expense.consultantId || app?.consultantId || "Unassigned", department: expense.department || requisition?.department || "Unassigned", location: expense.location || requisition?.location || "Unassigned", position: requisition?.title || (reqId ? reqId : "Shared cost"), ...(reqId ? { requisitionId: reqId } : {}), estimated: expense.estimated, allocation: ids.length === 1 ? "direct" : "shared" });
    });
  }
  for (const payout of referrals.filter((item) => dateInRange(item.earnedAt.slice(0, 10), from, to))) {
    const reqId = payout.reqId;
    const requisition = reqById.get(reqId);
    costItems.push({ date: payout.earnedAt.slice(0, 10), amount: payout.amount, category: "Employee Referral Bonus", source: "Employee Referral", consultant: "—", department: requisition?.department || "Unassigned", location: requisition?.location || "Unassigned", position: requisition?.title || reqId, requisitionId: reqId, estimated: payout.status !== "Paid" });
  }
  for (const subscription of subscriptions) {
    const startDate = new Date(`${subscription.startDate}T00:00:00`);
    const endDate = new Date(`${subscription.expiryDate}T00:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) continue;
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const monthCount = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
    const monthlyAllocation = uninvoicedSubscriptionCost(subscription, invoices) / Math.max(1, monthCount);
    for (let date = new Date(start); date <= end; date.setMonth(date.getMonth() + 1)) {
      const monthDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
      if (monthlyAllocation > 0 && dateInRange(monthDate, from, to)) costItems.push({ date: monthDate, amount: monthlyAllocation, category: "Job Board Subscription", source: subscription.platformName, consultant: "—", department: "Shared", location: "Shared", position: "Shared subscription", estimated: false });
    }
  }
  const group = (key: keyof CostItem) => {
    const values = new Map<string, { cost: number; candidateIds: Set<string> }>();
    for (const item of costItems) {
      const label = String(item[key] || "Unassigned");
      const current = values.get(label) || { cost: 0, candidateIds: new Set<string>() };
      current.cost += item.amount;
      const related = candidates.filter((candidate) => {
        const req = reqById.get(candidate.reqId);
        if (key === "source") return applications.some((application) => application.candidateId === candidate.id && application.source === label);
        if (key === "consultant") return applications.some((application) => application.candidateId === candidate.id && application.consultantId === label);
        if (key === "department") return req?.department === label;
        if (key === "location") return req?.location === label;
        if (key === "position") return req?.title === label;
        return false;
      });
      for (const candidate of related) if (uniqueHires.has(candidate.id)) current.candidateIds.add(candidate.id);
      values.set(label, current);
    }
    return [...values.entries()].map(([label, value]) => ({ label, cost: value.cost, hires: value.candidateIds.size, costPerHire: value.candidateIds.size ? value.cost / value.candidateIds.size : null }));
  };
  const trend = new Map<string, number>();
  for (const item of costItems) {
    const month = item.date.slice(0, 7);
    trend.set(month, (trend.get(month) || 0) + item.amount);
  }
  const monthlyTrend = [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([month, cost]) => ({ period: month, cost }));
  const quarterlyTrend = new Map<string, number>();
  const annualTrend = new Map<string, number>();
  for (const item of monthlyTrend) {
    const [year, month] = item.period.split("-").map(Number);
    const quarter = `Q${Math.ceil(month / 3)} ${year}`;
    quarterlyTrend.set(quarter, (quarterlyTrend.get(quarter) || 0) + item.cost);
    annualTrend.set(String(year), (annualTrend.get(String(year)) || 0) + item.cost);
  }
  const totalCost = costItems.reduce((sum, item) => sum + item.amount, 0);
  const requestCosts = requisitions.map((req) => {
    const items = costItems.filter((item) => item.requisitionId === req.id);
    const hires = [...uniqueHires.values()].filter((candidate) => candidate.reqId === req.id).length;
    const cost = items.reduce((sum, item) => sum + item.amount, 0);
    const sharedCost = items.filter((item) => item.allocation === "shared").reduce((sum, item) => sum + item.amount, 0);
    return { id: req.id, title: req.title, cost, directCost: cost - sharedCost, sharedCost, hires, costPerHire: hires ? cost / hires : null };
  }).filter((item) => item.cost > 0 || item.hires > 0);
  return {
    totalCost,
    unallocatedSharedCost: costItems.filter((item) => !item.requisitionId).reduce((sum, item) => sum + item.amount, 0),
    successfulHires: uniqueHires.size,
    overallCostPerHire: uniqueHires.size ? totalCost / uniqueHires.size : null,
    sourceWise: group("source"),
    consultantWise: group("consultant"),
    departmentWise: group("department"),
    locationWise: group("location"),
    positionWise: group("position"),
    requestCosts,
    monthlyTrend,
    quarterlyTrend: [...quarterlyTrend.entries()].map(([period, cost]) => ({ period, cost })),
    annualTrend: [...annualTrend.entries()].map(([period, cost]) => ({ period, cost })),
    costItems: costItems.map((item) => ({ ...item, classification: item.estimated ? "Estimated" : "Invoiced / Recorded" })),
  };
}
