import { randomUUID } from "node:crypto";
import { ApiError } from "../auth";
import { canReopenApplication } from "../candidateReopening";
import { isRequisitionOpenForRecruiting } from "../requisitionStatus";
import { requireAdminDb } from "../firebaseAdmin";
import type { Candidate, CandidateApplicationSource, CandidateProfile, CandidateStage, Requisition, StageEvent } from "../types";
import { candidateContactIndexId, formatApplicationId, formatCandidateId, nextUnreservedIdentity, normalizeCandidateEmail, normalizeCandidatePhone } from "../candidateIdentity";
import { newId, now } from "./ids";

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

export async function listCandidates(reqId?: string, includeArchived = false): Promise<Candidate[]> {
  const db = requireAdminDb();
  const snap = reqId
    ? await db.collection("candidates").where("reqId", "==", reqId).get()
    : await db.collection("candidates").get();
  const candidates = snap.docs
    .map((d) => d.data() as Candidate)
    .filter((c) => includeArchived || !c.archived);
  return hydrateCandidateProfiles(candidates);
}

export async function getCandidate(id: string): Promise<Candidate | null> {
  const snap = await requireAdminDb().collection("candidates").doc(id).get();
  if (!snap.exists) return null;
  return (await hydrateCandidateProfiles([snap.data() as Candidate]))[0] || null;
}

async function hydrateCandidateProfiles(candidates: Candidate[]): Promise<Candidate[]> {
  const db = requireAdminDb();
  const profileIds = [...new Set(candidates.map((candidate) => candidate.profileId).filter((id): id is string => !!id))];
  const profiles = new Map<string, CandidateProfile>();
  for (let offset = 0; offset < profileIds.length; offset += 400) {
    const refs = profileIds.slice(offset, offset + 400).map((id) => db.collection("candidate_profiles").doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists) profiles.set(snapshot.id, snapshot.data() as CandidateProfile);
    }
  }
  return Promise.all(candidates.map(async (candidate) => {
    let profile = candidate.profileId ? profiles.get(candidate.profileId) : undefined;
    const visited = new Set<string>();
    while (profile?.mergedIntoProfileId && !visited.has(profile.id)) {
      visited.add(profile.id);
      const mergedProfile = profiles.get(profile.mergedIntoProfileId) || await getCandidateProfile(profile.mergedIntoProfileId);
      if (!mergedProfile) break;
      profile = mergedProfile;
      profiles.set(profile.id, profile);
    }
    if (!profile) return candidate;
    return {
      ...candidate,
      profileId: profile.id,
      candidateId: profile.candidateId,
      candidateIdAliases: profile.candidateIdAliases,
      name: profile.name || candidate.name,
      email: profile.email || candidate.email,
      phone: profile.phone || candidate.phone,
      location: profile.location || candidate.location,
    };
  }));
}

export class CandidateProfileMatchError extends Error {
  constructor(readonly profileIds: string[]) {
    super("A candidate with matching contact information already exists. Review the matching profile before creating this application.");
    this.name = "CandidateProfileMatchError";
  }
}

export async function findCandidateProfilesByContact(email?: string, phone?: string): Promise<CandidateProfile[]> {
  const db = requireAdminDb();
  const indexIds = [
    normalizeCandidateEmail(email) ? candidateContactIndexId("email", normalizeCandidateEmail(email)) : "",
    normalizeCandidatePhone(phone) ? candidateContactIndexId("phone", normalizeCandidatePhone(phone)) : "",
  ].filter(Boolean);
  if (!indexIds.length) return [];
  const indexSnapshots = await Promise.all(indexIds.map((id) => db.collection("candidate_identity_index").doc(id).get()));
  const profileIds = [...new Set(indexSnapshots.flatMap((snapshot) => snapshot.exists ? (snapshot.get("profileIds") as string[] || []) : []))];
  if (!profileIds.length) return [];
  const profileSnapshots = await Promise.all(profileIds.map((id) => db.collection("candidate_profiles").doc(id).get()));
  const profiles = profileSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.data() as CandidateProfile);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const resolved = new Map<string, CandidateProfile>();
  for (const profile of profiles) {
    let current = profile;
    const visited = new Set<string>();
    while (current.mergedIntoProfileId && !visited.has(current.id)) {
      visited.add(current.id);
      const next = byId.get(current.mergedIntoProfileId) || await getCandidateProfile(current.mergedIntoProfileId);
      if (!next) break;
      current = next;
    }
    resolved.set(current.id, current);
  }
  return [...resolved.values()];
}

export async function getCandidateProfile(id: string): Promise<CandidateProfile | null> {
  const snapshot = await requireAdminDb().collection("candidate_profiles").doc(id).get();
  return snapshot.exists ? snapshot.data() as CandidateProfile : null;
}

export async function mergeCandidateProfiles(primaryId: string, duplicateId: string): Promise<CandidateProfile> {
  if (primaryId === duplicateId) throw new Error("Choose two different candidate profiles.");
  const db = requireAdminDb();
  const primaryRef = db.collection("candidate_profiles").doc(primaryId);
  const duplicateRef = db.collection("candidate_profiles").doc(duplicateId);
  const primary = await db.runTransaction(async (transaction) => {
    const primarySnapshot = await transaction.get(primaryRef);
    const duplicateSnapshot = await transaction.get(duplicateRef);
    if (!primarySnapshot.exists || !duplicateSnapshot.exists) throw new Error("Candidate profile not found.");
    const currentPrimary = primarySnapshot.data() as CandidateProfile;
    const duplicate = duplicateSnapshot.data() as CandidateProfile;
    if (currentPrimary.mergedIntoProfileId || duplicate.mergedIntoProfileId) throw new Error("A selected profile has already been merged.");
    const contactValues = new Set([
      ...(currentPrimary.normalizedEmail ? [candidateContactIndexId("email", currentPrimary.normalizedEmail)] : []),
      ...(duplicate.normalizedEmail ? [candidateContactIndexId("email", duplicate.normalizedEmail)] : []),
      ...(currentPrimary.normalizedPhone ? [candidateContactIndexId("phone", currentPrimary.normalizedPhone)] : []),
      ...(duplicate.normalizedPhone ? [candidateContactIndexId("phone", duplicate.normalizedPhone)] : []),
    ]);
    const indexRefs = [...contactValues].map((indexId) => db.collection("candidate_identity_index").doc(indexId));
    const candidateCodeRefs = [currentPrimary.candidateId, ...currentPrimary.candidateIdAliases, duplicate.candidateId, ...duplicate.candidateIdAliases]
      .map((candidateId) => db.collection("candidate_id_registry").doc(candidateId));
    const indexSnapshots = await Promise.all(indexRefs.map((ref) => transaction.get(ref)));
    const codeSnapshots = await Promise.all(candidateCodeRefs.map((ref) => transaction.get(ref)));
    const timestamp = now();
    const aliases = [...new Set([...currentPrimary.candidateIdAliases, duplicate.candidateId, ...duplicate.candidateIdAliases].filter((candidateId) => candidateId !== currentPrimary.candidateId))];
    const mergedPrimary = { ...currentPrimary, candidateIdAliases: aliases, updatedAt: timestamp };
    transaction.set(primaryRef, mergedPrimary, { merge: true });
    transaction.set(duplicateRef, { mergedIntoProfileId: primaryId, updatedAt: timestamp }, { merge: true });
    for (let index = 0; index < indexRefs.length; index += 1) {
      const snapshot = indexSnapshots[index]!;
      const profileIds = new Set(snapshot.exists ? snapshot.get("profileIds") as string[] || [] : []);
      profileIds.delete(duplicateId);
      profileIds.add(primaryId);
      transaction.set(indexRefs[index]!, { profileIds: [...profileIds], updatedAt: timestamp }, { merge: true });
    }
    for (let index = 0; index < candidateCodeRefs.length; index += 1) {
      if (!codeSnapshots[index]!.exists) continue;
      transaction.set(candidateCodeRefs[index]!, { profileId: primaryId, mergedAt: timestamp }, { merge: true });
    }
    return mergedPrimary;
  });

  const applications = await db.collection("candidates").where("profileId", "==", duplicateId).get();
  for (let offset = 0; offset < applications.docs.length; offset += 450) {
    const batch = db.batch();
    for (const application of applications.docs.slice(offset, offset + 450)) {
      batch.update(application.ref, { profileId: primaryId, candidateId: primary.candidateId, updatedAt: now() });
    }
    await batch.commit();
  }
  return primary;
}

export async function reopenCandidateApplication(previous: Candidate, actorEmail: string): Promise<Candidate> {
  const matches = previous.profileId ? [] : await findCandidateProfilesByContact(previous.email, previous.phone);
  if (matches.length > 1) throw new ApiError(409, "Resolve the matching candidate profiles before reopening this application.");

  return createCandidate({
    candidateProfileId: previous.profileId ?? matches[0]?.id,
    previousApplicationRecordId: previous.id,
    reqId: previous.reqId,
    name: previous.name,
    email: previous.email,
    phone: previous.phone,
    location: previous.location,
    stage: "PendingHMApproval",
    source: previous.source,
    sourceDetail: previous.sourceDetail,
    sourceVendorId: previous.sourceVendorId,
    sourceSubscriptionId: previous.sourceSubscriptionId,
    sourceNotes: previous.sourceNotes,
    referrerEmail: previous.referrerEmail,
    employeeReferralBonus: previous.employeeReferralBonus,
    cvPath: previous.cvPath,
    cvFileName: previous.cvFileName,
    skills: previous.skills,
    experienceYears: previous.experienceYears,
    customFields: previous.customFields,
    currentCtc: previous.currentCtc,
    currentFixedCtc: previous.currentFixedCtc,
    currentVariableCtc: previous.currentVariableCtc,
    presentEsops: previous.presentEsops,
    expectedCtc: previous.expectedCtc,
    notice: previous.notice,
  }, { previous, actorEmail });
}

export async function createCandidate(
  input: Omit<Candidate, "id" | "createdAt" | "updatedAt" | "archived" | "profileId" | "candidateId" | "applicationId"> & { candidateProfileId?: string },
  reopening?: { previous: Candidate; actorEmail: string }
): Promise<Candidate> {
  const db = requireAdminDb();
  const { candidateProfileId, ...candidateInput } = input;
  const email = normalizeCandidateEmail(candidateInput.email);
  const phone = normalizeCandidatePhone(candidateInput.phone);
  const profileId = candidateProfileId || randomUUID();
  const applicationRecordId = randomUUID();
  const emailIndexRef = email ? db.collection("candidate_identity_index").doc(candidateContactIndexId("email", email)) : null;
  const phoneIndexRef = phone ? db.collection("candidate_identity_index").doc(candidateContactIndexId("phone", phone)) : null;
  const sequenceRef = db.collection("system").doc("candidate-sequences");
  const profileRef = db.collection("candidate_profiles").doc(profileId);
  const applicationRef = db.collection("candidates").doc(applicationRecordId);
  const eventRef = db.collection("stage_events").doc(reopening ? "reopen-" + reopening.previous.id : newId("SE"));
  return db.runTransaction(async (transaction) => {
    let previousSource: CandidateApplicationSource | undefined;
    if (reopening) {
      const event = (await transaction.get(eventRef)).data() as StageEvent | undefined;
      if (event) {
        const existing = (await transaction.get(db.collection("candidates").doc(event.candidateId))).data() as Candidate | undefined;
        if (!existing) throw new ApiError(409, "The reopened application is unavailable.");
        return existing;
      }
      const previous = (await transaction.get(db.collection("candidates").doc(reopening.previous.id))).data() as Candidate | undefined;
      if (!previous || previous.reqId !== candidateInput.reqId || previous.archived || !canReopenApplication(previous.stage) ||
        previous.updatedAt !== reopening.previous.updatedAt) {
        throw new ApiError(409, "The prior application changed. Refresh it before reopening.");
      }
      const requisition = (await transaction.get(db.collection("requisitions").doc(previous.reqId))).data() as Requisition | undefined;
      if (!requisition || !isRequisitionOpenForRecruiting(requisition.status)) {
        throw new ApiError(400, "Reopen the requisition before reopening a candidate application.");
      }
      const sourceId = previous.id + "_" + previous.reqId;
      previousSource = (await transaction.get(db.collection("candidate_applications").doc(sourceId))).data() as CandidateApplicationSource | undefined;
    }
    const sequenceSnapshot = await transaction.get(sequenceRef);
    const profileSnapshot = candidateProfileId ? await transaction.get(profileRef) : null;
    const emailIndexSnapshot = emailIndexRef ? await transaction.get(emailIndexRef) : null;
    const phoneIndexSnapshot = phoneIndexRef ? await transaction.get(phoneIndexRef) : null;
    const matches = new Set([
      ...(emailIndexSnapshot?.exists ? emailIndexSnapshot.get("profileIds") as string[] || [] : []),
      ...(phoneIndexSnapshot?.exists ? phoneIndexSnapshot.get("profileIds") as string[] || [] : []),
    ]);
    if (candidateProfileId && (!profileSnapshot?.exists || matches.size > 0 && !matches.has(candidateProfileId))) {
      throw new CandidateProfileMatchError([...matches]);
    }
    if (!candidateProfileId && matches.size) throw new CandidateProfileMatchError([...matches]);

    const timestamp = now();
    const sequence = sequenceSnapshot.data() || {};
    const applicationIdentity = await nextUnreservedIdentity(
      Number(sequence.nextApplicationNumber) || 1,
      formatApplicationId,
      async (id) => (await transaction.get(db.collection("application_id_registry").doc(id))).exists
    );
    const applicationNumber = applicationIdentity.sequence;
    let profile: CandidateProfile;
    if (candidateProfileId) {
      profile = profileSnapshot!.data() as CandidateProfile;
      if (profile.mergedIntoProfileId) throw new CandidateProfileMatchError([profile.mergedIntoProfileId]);
      if (!profile.candidateId) {
        const candidateIdentity = await nextUnreservedIdentity(
          Number(sequence.nextCandidateNumber) || 1,
          formatCandidateId,
          async (id) => (await transaction.get(db.collection("candidate_id_registry").doc(id))).exists
        );
        profile = { ...profile, candidateId: candidateIdentity.id, candidateIdAliases: profile.candidateIdAliases || [] };
        transaction.set(profileRef, { candidateId: candidateIdentity.id, candidateIdAliases: profile.candidateIdAliases, updatedAt: timestamp }, { merge: true });
        transaction.create(db.collection("candidate_id_registry").doc(candidateIdentity.id), { profileId, createdAt: timestamp });
        sequence.nextCandidateNumber = candidateIdentity.sequence + 1;
      } else {
        const candidateIdRef = db.collection("candidate_id_registry").doc(profile.candidateId);
        const candidateIdSnapshot = await transaction.get(candidateIdRef);
        if (candidateIdSnapshot.exists && candidateIdSnapshot.get("profileId") !== profileId) {
          throw new Error(`Candidate ID ${profile.candidateId} is already assigned to another profile.`);
        }
        if (!candidateIdSnapshot.exists) transaction.create(candidateIdRef, { profileId, createdAt: timestamp });
        const candidateNumber = /^CAN-(\d+)$/.exec(profile.candidateId);
        if (candidateNumber) {
          sequence.nextCandidateNumber = Math.max(Number(sequence.nextCandidateNumber) || 1, Number(candidateNumber[1]) + 1);
        }
      }
    } else {
      const candidateIdentity = await nextUnreservedIdentity(
        Number(sequence.nextCandidateNumber) || 1,
        formatCandidateId,
        async (id) => (await transaction.get(db.collection("candidate_id_registry").doc(id))).exists
      );
      profile = {
        id: profileId,
        candidateId: candidateIdentity.id,
        candidateIdAliases: [],
        name: candidateInput.name,
        email: candidateInput.email,
        normalizedEmail: email,
        phone: candidateInput.phone,
        normalizedPhone: phone,
        location: candidateInput.location,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(profileRef, profile);
      transaction.create(db.collection("candidate_id_registry").doc(profile.candidateId), { profileId, createdAt: timestamp });
      sequence.nextCandidateNumber = candidateIdentity.sequence + 1;
    }

    const applicationId = applicationIdentity.id;
    const candidate: Candidate = {
      ...(reopening ? omitUndefined(candidateInput) : candidateInput),
      id: applicationRecordId,
      profileId,
      candidateId: profile.candidateId,
      applicationId,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.create(applicationRef, omitUndefined({ ...candidate } as Record<string, unknown>));
    transaction.create(db.collection("application_id_registry").doc(applicationId), { applicationRecordId, profileId, createdAt: timestamp });
    if (emailIndexRef) {
      const profileIds = new Set(emailIndexSnapshot?.exists ? emailIndexSnapshot.get("profileIds") as string[] || [] : []);
      profileIds.add(profileId);
      transaction.set(emailIndexRef, { profileIds: [...profileIds], updatedAt: timestamp });
    }
    if (phoneIndexRef) {
      const profileIds = new Set(phoneIndexSnapshot?.exists ? phoneIndexSnapshot.get("profileIds") as string[] || [] : []);
      profileIds.add(profileId);
      transaction.set(phoneIndexRef, { profileIds: [...profileIds], updatedAt: timestamp });
    }
    sequence.nextApplicationNumber = applicationNumber + 1;
    transaction.set(sequenceRef, sequence, { merge: true });
    transaction.create(eventRef, {
      id: eventRef.id,
      candidateId: candidate.id,
      reqId: candidate.reqId,
      fromStage: "",
      toStage: candidate.stage,
      byEmail: reopening?.actorEmail ?? "system",
      at: timestamp,
      ...(reopening ? { note: "Application reopened from " + (reopening.previous.applicationId || reopening.previous.id) } : {}),
    } satisfies StageEvent);
    if (reopening) {
      const sourceId = candidate.id + "_" + candidate.reqId;
      transaction.create(db.collection("candidate_applications").doc(sourceId), omitUndefined({
        id: sourceId, candidateId: candidate.id, requisitionId: candidate.reqId,
        source: previousSource?.source || candidate.source || "Unknown",
        consultantId: previousSource?.consultantId ?? candidate.sourceVendorId,
        subscriptionId: previousSource?.subscriptionId ?? candidate.sourceSubscriptionId,
        sourceNotes: previousSource?.sourceNotes ?? candidate.sourceNotes,
        submittedAt: timestamp, submittedBy: reopening.actorEmail, createdAt: timestamp, updatedAt: timestamp,
      }));
    }
    return candidate;
  });
}

export async function updateCandidate(
  id: string,
  patch: Partial<Candidate>,
  stageChange?: { byEmail: string; from: string; to: CandidateStage; reqId?: string }
): Promise<Candidate | null> {
  const db = requireAdminDb();
  const ref = db.collection("candidates").doc(id);
  const currentSnapshot = await ref.get();
  if (!currentSnapshot.exists) return null;
  const current = currentSnapshot.data() as Candidate;
  const safePatch = { ...patch };
  delete safePatch.id;
  delete safePatch.profileId;
  delete safePatch.candidateId;
  delete safePatch.applicationId;
  const timestamp = now();
  const profilePatch = Object.fromEntries(["name", "email", "phone", "location"].filter((key) => key in safePatch).map((key) => [key, safePatch[key as keyof Candidate]]));
  if (current.profileId && Object.keys(profilePatch).length) {
    const profileRef = db.collection("candidate_profiles").doc(current.profileId);
    await db.runTransaction(async (transaction) => {
      const profileSnapshot = await transaction.get(profileRef);
      if (!profileSnapshot.exists) throw new Error("Candidate profile not found.");
      const profile = profileSnapshot.data() as CandidateProfile;
      const nextEmail = normalizeCandidateEmail(typeof profilePatch.email === "string" ? profilePatch.email : profile.email);
      const nextPhone = normalizeCandidatePhone(typeof profilePatch.phone === "string" ? profilePatch.phone : profile.phone);
      const oldEmailRef = profile.normalizedEmail ? db.collection("candidate_identity_index").doc(candidateContactIndexId("email", profile.normalizedEmail)) : null;
      const oldPhoneRef = profile.normalizedPhone ? db.collection("candidate_identity_index").doc(candidateContactIndexId("phone", profile.normalizedPhone)) : null;
      const nextEmailRef = nextEmail ? db.collection("candidate_identity_index").doc(candidateContactIndexId("email", nextEmail)) : null;
      const nextPhoneRef = nextPhone ? db.collection("candidate_identity_index").doc(candidateContactIndexId("phone", nextPhone)) : null;
      const indexRefs = [...new Set([oldEmailRef, oldPhoneRef, nextEmailRef, nextPhoneRef].filter((item): item is NonNullable<typeof item> => !!item))];
      const indexSnapshots = await Promise.all(indexRefs.map((indexRef) => transaction.get(indexRef)));
      const indexByPath = new Map(indexRefs.map((indexRef, index) => [indexRef.path, indexSnapshots[index]!]));
      for (const [oldRef, nextRef] of [[oldEmailRef, nextEmailRef], [oldPhoneRef, nextPhoneRef]] as const) {
        if (oldRef && oldRef.path !== nextRef?.path) {
          const snapshot = indexByPath.get(oldRef.path);
          if (snapshot?.exists) {
            const profileIds = (snapshot.get("profileIds") as string[] || []).filter((profileId) => profileId !== current.profileId);
            if (profileIds.length) transaction.update(oldRef, { profileIds, updatedAt: timestamp });
            else transaction.delete(oldRef);
          }
        }
      }
      for (const [indexRef, value] of [[nextEmailRef, nextEmail], [nextPhoneRef, nextPhone]] as const) {
        if (!indexRef || !value) continue;
        const snapshot = indexByPath.get(indexRef.path);
        const profileIds = new Set(snapshot?.exists ? snapshot.get("profileIds") as string[] || [] : []);
        profileIds.add(current.profileId!);
        transaction.set(indexRef, { profileIds: [...profileIds], updatedAt: timestamp }, { merge: true });
      }
      transaction.set(profileRef, {
        ...profilePatch,
        normalizedEmail: nextEmail,
        normalizedPhone: nextPhone,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(ref, omitUndefined({ ...safePatch, updatedAt: timestamp } as Record<string, unknown>), { merge: true });
    });
  } else {
    await ref.set(omitUndefined({ ...safePatch, updatedAt: timestamp } as Record<string, unknown>), { merge: true });
  }
  if (stageChange) {
    const se: StageEvent = {
      id: newId("SE"),
      candidateId: id,
      reqId: stageChange.reqId || (await ref.get()).data()!.reqId,
      fromStage: stageChange.from,
      toStage: stageChange.to,
      byEmail: stageChange.byEmail,
      at: now(),
    };
    await db.collection("stage_events").doc(se.id).set(se);
  }
  return await getCandidate(id);
}

export async function listStageEvents(candidateId?: string) {
  const db = requireAdminDb();
  const snap = candidateId
    ? await db
        .collection("stage_events")
        .where("candidateId", "==", candidateId)
        .get()
    : await db.collection("stage_events").get();
  return snap.docs.map((d) => d.data() as StageEvent);
}
