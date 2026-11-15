import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { addAudit, getOrg, saveOrg, setIntegrationRequest } from "@/lib/db";
import { canManageTeam, DEPARTMENTS } from "@/lib/roles";
import { validFeedbackForms } from "@/lib/feedbackForms";
import { parseIntegrationRequest } from "@/lib/integrationRequests";
import { requireAdminDb } from "@/lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    return json({ org: await getOrg() });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!canManageTeam(user.role)) throw new ApiError(403, "Admin only.");
    const body = await req.json();
    if (body.action === "setRequisitionOrganization") {
      if (!Array.isArray(body.businessUnits) || body.businessUnits.length > 200 || body.businessUnits.some((unit: unknown) => typeof unit !== "string" || !unit.trim() || unit.trim().length > 100) || typeof body.departmentRequired !== "boolean" || typeof body.businessUnitRequired !== "boolean") throw new ApiError(400, "Enter valid business units and field settings.");
      const businessUnits = body.businessUnits.map((unit: string) => unit.trim());
      const current = await getOrg();
      const allowedDepartments = [...DEPARTMENTS, ...(current.customDepartments || [])];
      const inputSubDepartments = body.subDepartments === undefined ? current.subDepartments || [] : body.subDepartments;
      if (!Array.isArray(inputSubDepartments) || inputSubDepartments.length > 500 || inputSubDepartments.some((entry: unknown) => { const item = entry as { department?: unknown; name?: unknown }; return !item || typeof item.department !== "string" || !allowedDepartments.includes(item.department) || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 80 || /[\u0000-\u001f]/.test(item.name); })) throw new ApiError(400, "Enter valid sub-departments linked to an existing department.");
      const subDepartments = inputSubDepartments.map((item: { department: string; name: string }) => ({ department: item.department, name: item.name.trim().replace(/\s+/g, " ") }));
      if (new Set(subDepartments.map((item: { department: string; name: string }) => JSON.stringify([item.department.toLowerCase(), item.name.toLowerCase()]))).size !== subDepartments.length) throw new ApiError(400, "Sub-department names must be unique within each department.");
      if (new Set(businessUnits.map((unit: string) => unit.toLowerCase())).size !== businessUnits.length) throw new ApiError(400, "Business unit names must be unique.");
      if (body.businessUnitRequired && !businessUnits.length) throw new ApiError(400, "Add a business unit before making it required.");
      const mapping = body.departmentBusinessUnits ?? current.departmentBusinessUnits ?? [];
      if (!Array.isArray(mapping) || mapping.length > 2000 || mapping.some((item) =>
        !item || !businessUnits.includes(item.businessUnit) || !allowedDepartments.includes(item.department)
      )) throw new ApiError(400, "Link departments to valid business units.");
      const departmentBusinessUnits = [...new Map(mapping.map((item: { businessUnit: string; department: string }) =>
        [JSON.stringify([item.businessUnit, item.department]), { businessUnit: item.businessUnit, department: item.department }]
      )).values()];
      return json({ org: await saveOrg({ businessUnits, subDepartments, departmentBusinessUnits, requisitionDepartmentRequired: body.departmentRequired, requisitionBusinessUnitRequired: body.businessUnitRequired }) });
    }
    if (body.action === "setCandidateCustomFields") {
      if (!Array.isArray(body.fields) || body.fields.length > 30 || body.fields.some((f: unknown) => { const x = f as Record<string, unknown>; return !x || typeof x.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(x.id) || typeof x.label !== "string" || !x.label.trim() || x.label.trim().length > 80 || typeof x.required !== "boolean" || typeof x.enabled !== "boolean"; })) throw new ApiError(400, "Enter valid field names (up to 80 characters).");
      const fields = body.fields.map((f: { id: string; label: string; required: boolean; enabled: boolean }) => ({ id: f.id, label: f.label.trim(), required: f.required, enabled: f.enabled }));
      if (new Set(fields.map((f: { id: string }) => f.id)).size !== fields.length || new Set(fields.map((f: { label: string }) => f.label.toLowerCase())).size !== fields.length) throw new ApiError(400, "Field names must be unique.");
      return json({ org: await saveOrg({ candidateCustomFields: fields }) });
    }
    if (body.action === "setOfficeLocations") {
      if (!Array.isArray(body.locations) || body.locations.length > 200 || body.locations.some((entry: unknown) => !entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string" || !(entry as { name: string }).name.trim() || (entry as { name: string }).name.trim().length > 100 || (typeof (entry as { city?: unknown }).city !== "string" && (entry as { city?: unknown }).city !== undefined) || String((entry as { city?: string }).city || "").trim().length > 100 || ("address" in entry && (typeof entry.address !== "string" || entry.address.trim().length > 300)))) throw new ApiError(400, "Enter valid office names, cities, and addresses.");
      const locations = body.locations.map((entry: { name: string; city?: string; address?: string }) => ({ name: entry.name.trim(), city: (entry.city || "").trim(), address: (entry.address || "").trim() }));
      if (new Set(locations.map((entry: { name: string; city: string }) => JSON.stringify([entry.name.toLocaleLowerCase(), entry.city.toLocaleLowerCase()]))).size !== locations.length) throw new ApiError(400, "This office and city combination already exists.");
      return json({ org: await saveOrg({ officeLocations: locations }) });
    }
    if (body.action === "setRequisitionSequence") {
      const separate = body.separate === true;
      const parseSequence = (value: { prefix?: unknown; nextNumber?: unknown }) => {
        const prefix = typeof value?.prefix === "string" ? value.prefix.trim().toUpperCase() : "";
        const nextNumber = value?.nextNumber;
        if (!/^[A-Z][A-Z0-9_-]{0,19}$/.test(prefix) || typeof nextNumber !== "number" || !Number.isSafeInteger(nextNumber) || nextNumber < 1 || nextNumber > 999999999) throw new ApiError(400, "Enter a valid prefix and a next number from 1 to 999,999,999.");
        return { prefix, nextNumber };
      };
      const shared = separate ? null : parseSequence(body);
      const newSequence = separate ? parseSequence(body.newSequence) : null;
      const replacementSequence = separate ? parseSequence(body.replacementSequence) : null;
      if (newSequence && replacementSequence && newSequence.prefix === replacementSequence.prefix) throw new ApiError(400, "Choose different prefixes for New and Replacement requests.");
      const db = requireAdminDb();
      await db.runTransaction(async (tx) => {
        const orgRef = db.collection("org").doc("org");
        const current = (await tx.get(orgRef)).data();
        const sequences = separate ? [newSequence!, replacementSequence!] : [shared!];
        const previous = separate ? [current?.requisitionNewSequence, current?.requisitionReplacementSequence] : [{ prefix: current?.requisitionIdPrefix, nextNumber: current?.requisitionNextNumber }];
        for (let i = 0; i < sequences.length; i++) {
          const sequence = sequences[i];
          if (previous[i]?.prefix === sequence.prefix && sequence.nextNumber < previous[i].nextNumber) throw new ApiError(400, "The next number cannot be lower than the current sequence.");
          if ((await tx.get(db.collection("requisitions").doc(`${sequence.prefix}-${sequence.nextNumber}`))).exists) throw new ApiError(400, "A requisition ID already exists. Choose a higher number.");
        }
        tx.set(orgRef, separate ? { requisitionSeparateSequences: true, requisitionNewSequence: newSequence, requisitionReplacementSequence: replacementSequence } : { requisitionSeparateSequences: false, requisitionIdPrefix: shared!.prefix, requisitionNextNumber: shared!.nextNumber }, { merge: true });
      });
      return json({ org: await getOrg() });
    }
    if (body.action === "setIntegrationRequest") {
      const request = parseIntegrationRequest(body);
      if (!request) throw new ApiError(400, "Choose a valid integration and request status.");
      const updated = await setIntegrationRequest(request.provider, request.requested);
      await addAudit({ action: "integration.setup.request", actorEmail: user.email, actingAdminEmail: user.actingAdminEmail, entityType: "organization", entityId: "org", detail: `${request.provider}: ${request.requested ? "requested" : "cancelled"}` });
      return json({ org: updated });
    }
    if (body.offerJoiningEnabled !== undefined) {
      if (typeof body.offerJoiningEnabled !== "boolean") {
        throw new ApiError(400, "Offer & Joining must be enabled or disabled.");
      }
      return json({ org: await saveOrg({ offerJoiningEnabled: body.offerJoiningEnabled }) });
    }
    if (body.vendorsSpendEnabled !== undefined) {
      if (typeof body.vendorsSpendEnabled !== "boolean") {
        throw new ApiError(400, "Vendors & Spend must be enabled or disabled.");
      }
      return json({ org: await saveOrg({ vendorsSpendEnabled: body.vendorsSpendEnabled }) });
    }
    if (body.feedbackFormTemplates !== undefined && !validFeedbackForms(body.feedbackFormTemplates)) throw new ApiError(400, "Check each form name, question, and answer option before saving. Choice questions need at least two distinct options.");
    const company = String(body.company || "").trim();
    const story = String(body.story || "").trim();
    const websiteUrl = String(body.websiteUrl || "").trim();
    const logoUrl = String(body.logoUrl || "").trim();
    const foundedYear = body.foundedYear ? Number(body.foundedYear) : undefined;
    if (body.employeeReferralsEnabled !== undefined && typeof body.employeeReferralsEnabled !== "boolean") {
      throw new ApiError(400, "Employee referrals must be enabled or disabled.");
    }
    if (body.referralShareSalary !== undefined && typeof body.referralShareSalary !== "boolean") throw new ApiError(400, "Choose whether to share salary ranges in employee referrals.");
    if (body.referralBonusOverdueDays !== undefined &&
      (!Number.isInteger(body.referralBonusOverdueDays) || body.referralBonusOverdueDays < 1 || body.referralBonusOverdueDays > 3650)) {
      throw new ApiError(400, "Referral bonuses can become overdue after 1 to 3,650 days.");
    }
    if (!company) throw new ApiError(400, "Company name is required.");
    if (company.length > 120 || story.length > 5000) {
      throw new ApiError(400, "Company name or story is too long.");
    }
    if (foundedYear !== undefined && (!Number.isInteger(foundedYear) || foundedYear < 1800 || foundedYear > new Date().getFullYear())) {
      throw new ApiError(400, "Enter a valid company start year.");
    }
    if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) {
      throw new ApiError(400, "Website URL must start with http:// or https://.");
    }
    if (logoUrl && !/^https?:\/\//i.test(logoUrl) && !/^data:image\/(png|jpeg|webp);base64,/i.test(logoUrl)) {
      throw new ApiError(400, "Logo must be a PNG, JPEG, WebP image, or HTTPS URL.");
    }
    if (logoUrl.startsWith("data:") && logoUrl.length > 700_000) {
      throw new ApiError(400, "Logo image must be smaller than 500 KB.");
    }
    const rejectionEmailSubject = typeof body.rejectionEmailSubject === "string"
      ? body.rejectionEmailSubject.trim()
      : undefined;
    const rejectionEmailBody = typeof body.rejectionEmailBody === "string"
      ? body.rejectionEmailBody
      : undefined;
    const backedOutEmailSubject = typeof body.backedOutEmailSubject === "string"
      ? body.backedOutEmailSubject.trim()
      : undefined;
    const backedOutEmailBody = typeof body.backedOutEmailBody === "string"
      ? body.backedOutEmailBody
      : undefined;
    if ([rejectionEmailSubject, backedOutEmailSubject].some((value) => (value?.length || 0) > 200) ||
      [rejectionEmailBody, backedOutEmailBody].some((value) => (value?.length || 0) > 6000)) {
      throw new ApiError(400, "Email subject or body is too long.");
    }
    const org = await saveOrg({
      company,
      ...(typeof body.shareCompanyOnSocialLinks === "boolean" ? { shareCompanyOnSocialLinks: body.shareCompanyOnSocialLinks } : {}),
      ...(body.feedbackFormTemplates !== undefined ? { feedbackFormTemplates: body.feedbackFormTemplates } : {}),
      story,
      websiteUrl,
      foundedYear,
      logoUrl,
      slaDaysDefault: body.slaDaysDefault,
      ...(typeof body.employeeReferralsEnabled === "boolean"
        ? { employeeReferralsEnabled: body.employeeReferralsEnabled }
        : {}),
      ...(typeof body.referralShareSalary === "boolean" ? { referralShareSalary: body.referralShareSalary } : {}),
      ...(body.referralBonusOverdueDays !== undefined
        ? { referralBonusOverdueDays: body.referralBonusOverdueDays }
        : {}),
      ...(rejectionEmailSubject !== undefined ? { rejectionEmailSubject } : {}),
      ...(rejectionEmailBody !== undefined ? { rejectionEmailBody } : {}),
      ...(backedOutEmailSubject !== undefined ? { backedOutEmailSubject } : {}),
      ...(backedOutEmailBody !== undefined ? { backedOutEmailBody } : {}),
    });
    return json({ org });
  } catch (e) {
    return errResponse(e);
  }
}

