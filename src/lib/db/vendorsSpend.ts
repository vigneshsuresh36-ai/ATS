import type { Firestore, Transaction } from "firebase-admin/firestore";
import { ApiError } from "../auth";
import { normalizeCandidateEmail, normalizeCandidatePhone } from "../candidateIdentity";
import { requireAdminDb } from "../firebaseAdmin";
import type { Candidate, CandidateApplicationSource, CandidateProfile, ConsultantAgreementVersion, ConsultantFeeRule, PlacementFee, RecruitmentConsultant, Requisition, ReplacementGuarantee, VendorAuditEntry, VendorInvoice } from "../types";
import { newId, now } from "./ids";

export const VENDOR_SPEND_COLLECTIONS = {
  consultants: "recruitment_consultants",
  subscriptions: "job_board_subscriptions",
  invoices: "vendor_invoices",
  placementFees: "placement_fees",
  guarantees: "replacement_guarantees",
  expenses: "recruitment_expenses",
  budgets: "recruitment_budgets",
  feeRules: "consultant_fee_rules",
  agreements: "consultant_agreements",
  reminders: "vendor_reminders",
  audit: "vendor_audit",
} as const;

export type VendorSpendResource = keyof typeof VENDOR_SPEND_COLLECTIONS;

type PlacementIdentity = Pick<Candidate, "id" | "profileId" | "candidateId" | "email" | "phone">;
type PlacementRecord = Pick<PlacementFee, "id" | "candidateId" | "requisitionId" | "consultantId" | "status">;

function samePlacementCandidate(left: PlacementIdentity, right: PlacementIdentity) {
  if (left.id === right.id || (left.profileId && left.profileId === right.profileId) ||
    (left.candidateId && left.candidateId === right.candidateId)) return true;
  const leftEmail = normalizeCandidateEmail(left.email);
  const rightEmail = normalizeCandidateEmail(right.email);
  if (leftEmail && rightEmail) return leftEmail === rightEmail;
  const phone = normalizeCandidatePhone(left.phone);
  return !!phone && phone === normalizeCandidatePhone(right.phone);
}

async function getPlacementScope(db: Firestore, tx: Transaction, requisitionId: string) {
  if (!requisitionId || requisitionId.includes("/")) throw new ApiError(400, "A requisition ID is required for the placement.");
  // Serialize claims per requisition, including claims submitted under different profile IDs.
  const guard = db.collection("placement_fee_locks").doc(requisitionId);
  const [revision, candidates, placements] = await Promise.all([
    tx.get(guard),
    tx.get(db.collection("candidates").where("reqId", "==", requisitionId)),
    tx.get(db.collection(VENDOR_SPEND_COLLECTIONS.placementFees).where("requisitionId", "==", requisitionId)),
  ]);
  const records = candidates.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Candidate);
  const fees = placements.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as PlacementRecord);
  const candidateFor = (id: string) => records.find((record) => record.id === id) || records.find((record) => record.candidateId === id);
  const profiles = new Map<string, Promise<CandidateProfile | undefined>>();

  async function canonicalProfile(id?: string) {
    const visited = new Set<string>();
    while (id) {
      if (visited.has(id)) throw new ApiError(409, "A candidate profile has a circular merge link.");
      visited.add(id);
      const ref = db.collection("candidate_profiles").doc(id);
      let profile = profiles.get(id);
      if (!profile) {
        profile = tx.get(ref).then((snapshot) => snapshot.data() as CandidateProfile | undefined);
        profiles.set(id, profile);
      }
      const next = (await profile)?.mergedIntoProfileId;
      if (!next) return id;
      id = next;
    }
  }

  async function existingFees(candidate: Candidate, excludeId?: string) {
    const profileId = await canonicalProfile(candidate.profileId);
    const matches = await Promise.all(fees.map(async (fee) => {
      if (fee.id === excludeId) return null;
      const other = candidateFor(fee.candidateId);
      const matches = fee.candidateId === candidate.id || (candidate.candidateId && fee.candidateId === candidate.candidateId)
        || (other && samePlacementCandidate({ ...candidate, profileId }, { ...other, profileId: await canonicalProfile(other.profileId) }));
      if (!matches) return null;
      if (fee.status !== "Cancelled") return fee;
      // A cancelled fee still represents liability if a linked invoice remains active.
      const invoices = await tx.get(db.collection(VENDOR_SPEND_COLLECTIONS.invoices).where("placementFeeId", "==", fee.id));
      return invoices.docs.some((invoice) => invoice.get("paymentStatus") !== "Cancelled") ? fee : null;
    }));
    return matches.filter((fee): fee is PlacementRecord => !!fee);
  }

  return {
    candidateFor,
    existingFees,
    advance: () => tx.set(guard, { revision: Number(revision.get("revision") || 0) + 1 }, { merge: true }),
  };
}

async function preparePlacementInvoice(
  db: Firestore,
  tx: Transaction,
  invoice: Record<string, unknown>,
  invoiceId: string,
) {
  const placementFeeId = typeof invoice.placementFeeId === "string" ? invoice.placementFeeId.trim() : "";
  if (!placementFeeId) {
    if (invoice.consultantId && invoice.candidateId && invoice.paymentStatus !== "Cancelled") {
      throw new ApiError(400, "Enter the placement reference for a candidate-linked consultant invoice.");
    }
    return { invoice };
  }
  if (placementFeeId.includes("/")) throw new ApiError(400, "Invalid placement reference.");
  const ref = db.collection(VENDOR_SPEND_COLLECTIONS.placementFees).doc(placementFeeId);
  const snapshot = await tx.get(ref);
  const placement = snapshot.data() as PlacementRecord | undefined;
  if (!placement) throw new ApiError(404, "Placement fee not found.");
  if (invoice.consultantId && invoice.consultantId !== placement.consultantId) {
    throw new ApiError(400, "This invoice must use the consultant assigned to the placement fee.");
  }
  const linkedInvoice = { ...invoice, placementFeeId, consultantId: placement.consultantId, candidateId: placement.candidateId, requisitionId: placement.requisitionId };
  if (invoice.paymentStatus === "Cancelled") return { invoice: linkedInvoice };
  if (placement.status === "Cancelled") throw new ApiError(409, "This placement fee has been cancelled.");

  const scope = await getPlacementScope(db, tx, placement.requisitionId);
  const candidate = scope.candidateFor(placement.candidateId);
  if (!candidate) throw new ApiError(409, "The placement fee must be linked to a candidate on the requisition.");
  const [duplicates, invoices] = await Promise.all([
    scope.existingFees(candidate, placementFeeId),
    tx.get(db.collection(VENDOR_SPEND_COLLECTIONS.invoices).where("placementFeeId", "==", placementFeeId)),
  ]);
  if (duplicates.length) throw new ApiError(409, "This candidate has multiple active placement fees for the requisition. Reconcile them before invoicing.");
  if (invoices.docs.some((doc) => doc.id !== invoiceId && doc.get("paymentStatus") !== "Cancelled")) {
    throw new ApiError(409, "An active invoice already exists for this placement fee.");
  }
  return {
    invoice: linkedInvoice,
    commit: () => {
      scope.advance();
      tx.set(ref, { status: "Invoiced", invoiceId, updatedAt: now() }, { merge: true });
    },
  };
}

export async function listVendorSpendRecords<T = Record<string, unknown>>(resource: VendorSpendResource): Promise<T[]> {
  const snapshot = await requireAdminDb().collection(VENDOR_SPEND_COLLECTIONS[resource]).get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as T);
}

export async function getVendorSpendRecord<T = Record<string, unknown>>(resource: VendorSpendResource, id: string): Promise<T | null> {
  const snapshot = await requireAdminDb().collection(VENDOR_SPEND_COLLECTIONS[resource]).doc(id).get();
  return snapshot.exists ? ({ ...snapshot.data(), id: snapshot.id } as T) : null;
}

export async function createVendorSpendRecord<T extends Record<string, unknown>>(
  resource: VendorSpendResource,
  prefix: string,
  data: T,
): Promise<T & { id: string; createdAt: string; updatedAt: string }> {
  const id = newId(prefix);
  const timestamp = now();
  const record = { ...data, id, createdAt: timestamp, updatedAt: timestamp };
  const db = requireAdminDb();
  const ref = db.collection(VENDOR_SPEND_COLLECTIONS[resource]).doc(id);
  if (resource === "placementFees") {
    return db.runTransaction(async (tx) => {
      const scope = await getPlacementScope(db, tx, String(data.requisitionId || "").trim());
      const candidate = scope.candidateFor(String(data.candidateId || "").trim());
      if (!candidate) throw new ApiError(400, "Choose a candidate on the requisition for this placement fee.");
      if (data.status !== "Cancelled" && (await scope.existingFees(candidate)).length) {
        throw new ApiError(409, "An active placement fee already exists for this candidate and requisition.");
      }
      const placement = { ...record, candidateId: candidate.id, requisitionId: candidate.reqId, status: data.status || "Estimated" };
      scope.advance();
      tx.create(ref, placement);
      return placement;
    });
  }
  if (resource === "invoices" && (data.placementFeeId || (data.consultantId && data.candidateId))) {
    return db.runTransaction(async (tx) => {
      const prepared = await preparePlacementInvoice(db, tx, record, id);
      const invoice = { ...record, ...prepared.invoice };
      prepared.commit?.();
      tx.create(ref, invoice);
      return invoice;
    });
  }
  await ref.create(record);
  return record;
}

export async function updateVendorSpendRecord<T extends Record<string, unknown>>(
  resource: VendorSpendResource,
  id: string,
  patch: T,
): Promise<(T & { id: string; updatedAt: string }) | null> {
  const db = requireAdminDb();
  const ref = db.collection(VENDOR_SPEND_COLLECTIONS[resource]).doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    const timestamp = now();
    const previous = snapshot.data()!;
    let updated: Record<string, unknown> = { ...previous, ...patch, id, updatedAt: timestamp };
    if (resource === "placementFees") {
      for (const field of ["candidateId", "requisitionId"]) {
        if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== previous[field]) {
          throw new ApiError(400, "A placement fee cannot be moved to a different candidate or requisition.");
        }
      }
      if (previous.status === "Cancelled" && updated.status !== "Cancelled") {
        const scope = await getPlacementScope(db, transaction, String(previous.requisitionId || ""));
        const candidate = scope.candidateFor(String(previous.candidateId || ""));
        if (!candidate || (await scope.existingFees(candidate, id)).length) {
          throw new ApiError(409, "Cannot reactivate this fee while another active fee exists or the candidate link is missing.");
        }
        scope.advance();
      }
    }
    if (resource === "invoices") {
      if (previous.placementFeeId && previous.placementFeeId !== updated.placementFeeId) {
        throw new ApiError(400, "A linked invoice cannot be moved to another placement fee.");
      }
      if (updated.placementFeeId && (previous.placementFeeId !== updated.placementFeeId || previous.paymentStatus === "Cancelled" || updated.consultantId !== previous.consultantId || updated.candidateId !== previous.candidateId || updated.requisitionId !== previous.requisitionId)) {
        const prepared = await preparePlacementInvoice(db, transaction, updated, id);
        updated = prepared.invoice;
        prepared.commit?.();
      } else if (!updated.placementFeeId && updated.consultantId && updated.candidateId && updated.paymentStatus !== "Cancelled" &&
        (previous.paymentStatus === "Cancelled" || updated.consultantId !== previous.consultantId || updated.candidateId !== previous.candidateId)) {
        throw new ApiError(400, "Enter the placement reference for a candidate-linked consultant invoice.");
      }
    }
    if (resource === "consultants") {
      const before = snapshot.data() as RecruitmentConsultant;
      const after = updated as unknown as RecruitmentConsultant;
      if (["feeType", "defaultFee", "feeCap", "agreementStartDate", "agreementExpiryDate", "paymentTerms", "replacementGuaranteeDays"]
        .some((key) => before[key as keyof RecruitmentConsultant] !== after[key as keyof RecruitmentConsultant])) {
        const agreementRef = db.collection(VENDOR_SPEND_COLLECTIONS.agreements).doc(newId("AGR"));
        const agreement: ConsultantAgreementVersion = {
          id: agreementRef.id,
          vendorId: id,
          agreementPath: after.agreementPath,
          agreementFileName: after.agreementFileName,
          startDate: after.agreementStartDate || timestamp.slice(0, 10),
          expiryDate: after.agreementExpiryDate || "",
          feeType: after.feeType,
          defaultFee: after.defaultFee,
          feeCap: after.feeCap,
          termsSnapshot: JSON.stringify({
            feeCalculationBasis: after.feeCalculationBasis,
            paymentTerms: after.paymentTerms,
            invoiceDueDays: after.invoiceDueDays,
            replacementGuaranteeDays: after.replacementGuaranteeDays,
            freeReplacements: after.freeReplacements,
          }),
          createdBy: String(patch.updatedBy || "system"),
          createdAt: timestamp,
        };
        transaction.create(agreementRef, agreement);
      }
    }
    transaction.set(ref, updated, { merge: true });
    return updated as T & { id: string; updatedAt: string };
  });
}

export async function createVendorAudit(entry: Omit<VendorAuditEntry, "id" | "at">): Promise<VendorAuditEntry> {
  const audit: VendorAuditEntry = { ...entry, id: newId("VLOG"), at: now() };
  await requireAdminDb().collection(VENDOR_SPEND_COLLECTIONS.audit).doc(audit.id).create(audit);
  return audit;
}

export async function saveCandidateApplicationSource(
  input: Omit<CandidateApplicationSource, "id" | "createdAt" | "updatedAt">,
): Promise<CandidateApplicationSource> {
  const db = requireAdminDb();
  const id = `${input.candidateId}_${input.requisitionId}`;
  const ref = db.collection("candidate_applications").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const timestamp = now();
    const application: CandidateApplicationSource = {
      ...input,
      id,
      createdAt: snapshot.exists ? String(snapshot.data()?.createdAt || timestamp) : timestamp,
      updatedAt: timestamp,
    };
    transaction.set(ref, application, { merge: true });
    return application;
  });
}

export async function listCandidateApplicationSources(candidateIds?: string[]): Promise<CandidateApplicationSource[]> {
  const collection = requireAdminDb().collection("candidate_applications");
  if (!candidateIds) {
    const snapshot = await collection.get();
    return snapshot.docs.map((doc) => doc.data() as CandidateApplicationSource);
  }
  const unique = [...new Set(candidateIds)];
  const groups = await Promise.all(unique.map((candidateId) => collection.where("candidateId", "==", candidateId).get()));
  return groups.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data() as CandidateApplicationSource));
}

export async function createInvoiceFromPlacement(input: {
  placementFee: Record<string, unknown>;
  invoice: Omit<VendorInvoice, "id" | "createdAt" | "updatedAt">;
}) {
  try {
    return await createVendorSpendRecord("invoices", "INV", {
      ...input.invoice, placementFeeId: String(input.placementFee.id),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function addDateOnlyDays(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

export async function createPlacementFeeForJoinedCandidate(candidate: Candidate, requisition: Requisition, actorEmail: string) {
  const db = requireAdminDb();
  const applicationSnapshot = await db.collection("candidate_applications").doc(`${candidate.id}_${requisition.id}`).get();
  const application = applicationSnapshot.data() as CandidateApplicationSource | undefined;
  if (!application?.consultantId) return null;
  const vendor = await getVendorSpendRecord<RecruitmentConsultant>("consultants", application.consultantId);
  if (!vendor) return null;
  const rules = await listVendorSpendRecords<ConsultantFeeRule>("feeRules");
  const relevantRules = rules.filter((rule) => rule.vendorId === vendor.id && rule.effectiveFrom <= (candidate.actualJoiningDate || candidate.currentDoj || candidate.tentativeDoj || "9999-12-31") && (!rule.effectiveTo || rule.effectiveTo >= (candidate.actualJoiningDate || candidate.currentDoj || candidate.tentativeDoj || "9999-12-31")));
  const feeRule = relevantRules.find((rule) => rule.requisitionId === requisition.id)
    || relevantRules.find((rule) => rule.title?.trim().toLowerCase() === requisition.title.trim().toLowerCase())
    || relevantRules.find((rule) => rule.department?.trim().toLowerCase() === requisition.department.trim().toLowerCase())
    || null;
  const feeType = feeRule?.feeType || vendor.feeType;
  const feeValue = feeRule?.fee ?? vendor.defaultFee;
  const annualCtc = Number(candidate.offeredFixedCtc || candidate.offeredSalary || candidate.expectedCtc || 0) + Number(candidate.offeredVariableCtc || 0);
  const rawFee = feeType === "Percentage of Annual CTC" ? annualCtc * feeValue / 100 : feeValue;
  const feeCap = feeRule?.feeCap ?? vendor.feeCap;
  const expectedFee = Math.round(Math.max(0, feeCap ? Math.min(rawFee, feeCap) : rawFee));
  const joiningDate = candidate.actualJoiningDate || candidate.currentDoj || candidate.tentativeDoj || new Date().toISOString().slice(0, 10);
  const id = `PLF_${candidate.id}_${requisition.id}`;
  const placementRef = db.collection(VENDOR_SPEND_COLLECTIONS.placementFees).doc(id);
  const guaranteeId = `GUA_${candidate.id}_${requisition.id}`;
  const guaranteeRef = db.collection(VENDOR_SPEND_COLLECTIONS.guarantees).doc(guaranteeId);
  const timestamp = now();
  return db.runTransaction(async (transaction) => {
    const [scope, existing, existingGuarantee] = await Promise.all([
      getPlacementScope(db, transaction, requisition.id),
      transaction.get(placementRef),
      transaction.get(guaranteeRef),
    ]);
    if (existing.exists) return null;
    const current = scope.candidateFor(candidate.id);
    if (!current || (await scope.existingFees(current)).length) return null;
    const placement = {
      id,
      candidateId: candidate.id,
      requisitionId: requisition.id,
      consultantId: vendor.id,
      candidateName: candidate.name,
      requisitionTitle: requisition.title,
      joiningDate,
      annualCtc,
      feeType,
      feeValue,
      ...(feeCap ? { feeCap } : {}),
      expectedFee,
      ...(feeRule ? { feeRuleId: feeRule.id } : {}),
      feeSnapshot: JSON.stringify({ vendorId: vendor.id, vendorName: vendor.name, feeType, feeValue, feeCap, effectiveFrom: feeRule?.effectiveFrom || vendor.agreementStartDate, effectiveTo: feeRule?.effectiveTo || vendor.agreementExpiryDate }),
      status: "Estimated" as const,
      createdBy: actorEmail,
      createdAt: timestamp,
      updatedBy: actorEmail,
      updatedAt: timestamp,
    };
    scope.advance();
    transaction.create(placementRef, placement);
    if (vendor.replacementGuaranteeDays && vendor.replacementGuaranteeDays > 0) {
      const guarantee: ReplacementGuarantee = {
        id: guaranteeId,
        placementFeeId: id,
        candidateId: candidate.id,
        consultantId: vendor.id,
        requisitionId: requisition.id,
        joiningDate,
        expiryDate: addDateOnlyDays(joiningDate, vendor.replacementGuaranteeDays),
        status: "Active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!existingGuarantee.exists) transaction.create(guaranteeRef, guarantee);
    }
    return placement;
  });
}