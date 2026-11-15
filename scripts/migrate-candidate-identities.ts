import { createHash } from "node:crypto";
import { requireAdminDb } from "../src/lib/firebaseAdmin";
import { buildCandidateMigrationGroups } from "../src/lib/candidateMigration";
import { candidateContactIndexId, formatApplicationId, formatCandidateId, nextUnreservedIdentity, normalizeCandidateEmail, normalizeCandidatePhone } from "../src/lib/candidateIdentity";
import type { Candidate, CandidateProfile } from "../src/lib/types";
import { now } from "../src/lib/db/ids";

function deterministicUuid(seed: string) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = "8";
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function ensureProfile(profileId: string, records: { id: string; data: Candidate }[]) {
  const db = requireAdminDb();
  const profileRef = db.collection("candidate_profiles").doc(profileId);
  const first = [...records].sort((left, right) => left.id.localeCompare(right.id))[0]!.data;
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(profileRef);
    const sequenceRef = db.collection("system").doc("candidate-sequences");
    const sequenceSnapshot = await transaction.get(sequenceRef);
    const sequence = sequenceSnapshot.data() || {};
    const currentProfile = existing.exists ? existing.data() as CandidateProfile : null;
    let candidateId = currentProfile?.candidateId;
    let candidateNumber = Number(sequence.nextCandidateNumber) || 1;
    if (!candidateId) {
      const identity = await nextUnreservedIdentity(
        candidateNumber,
        formatCandidateId,
        async (id) => (await transaction.get(db.collection("candidate_id_registry").doc(id))).exists
      );
      candidateId = identity.id;
      candidateNumber = identity.sequence;
    }
    const candidateIdRef = db.collection("candidate_id_registry").doc(candidateId);
    const candidateIdSnapshot = await transaction.get(candidateIdRef);
    if (candidateIdSnapshot.exists && candidateIdSnapshot.get("profileId") !== profileId) {
      throw new Error(`Candidate ID ${candidateId} is already assigned to another profile.`);
    }
    const email = normalizeCandidateEmail(first.email);
    const phone = normalizeCandidatePhone(first.phone);
    const emailRef = email ? db.collection("candidate_identity_index").doc(candidateContactIndexId("email", email)) : null;
    const phoneRef = phone ? db.collection("candidate_identity_index").doc(candidateContactIndexId("phone", phone)) : null;
    const indexRefs = [emailRef, phoneRef].filter((ref): ref is NonNullable<typeof ref> => !!ref);
    const indexSnapshots = await Promise.all(indexRefs.map((ref) => transaction.get(ref)));
    const timestamp = now();
    const profile: CandidateProfile = currentProfile
      ? { ...currentProfile, candidateId, candidateIdAliases: currentProfile.candidateIdAliases || [], updatedAt: timestamp }
      : {
          id: profileId,
          candidateId,
          candidateIdAliases: [],
          name: first.name,
          email: first.email,
          normalizedEmail: email,
          phone: first.phone,
          normalizedPhone: phone,
          location: first.location,
          createdAt: first.createdAt || timestamp,
          updatedAt: timestamp,
        };
    if (existing.exists) transaction.set(profileRef, profile, { merge: true });
    else transaction.create(profileRef, profile);
    if (!candidateIdSnapshot.exists) transaction.create(candidateIdRef, { profileId, createdAt: timestamp });
    for (let index = 0; index < indexRefs.length; index += 1) {
      const indexRef = indexRefs[index]!;
      const snapshot = indexSnapshots[index]!;
      const profileIds = new Set(snapshot.exists ? snapshot.get("profileIds") as string[] || [] : []);
      profileIds.add(profileId);
      transaction.set(indexRef, { profileIds: [...profileIds], updatedAt: timestamp }, { merge: true });
    }
    transaction.set(sequenceRef, { nextCandidateNumber: Math.max(Number(sequence.nextCandidateNumber) || 1, candidateNumber + 1) }, { merge: true });
    return profile;
  });
}

async function ensureApplication(recordId: string, profile: CandidateProfile) {
  const db = requireAdminDb();
  const applicationRef = db.collection("candidates").doc(recordId);
  return db.runTransaction(async (transaction) => {
    const applicationSnapshot = await transaction.get(applicationRef);
    if (!applicationSnapshot.exists) return false;
    const application = applicationSnapshot.data() as Candidate;
    if (application.profileId && application.profileId !== profile.id) throw new Error(`Candidate record ${recordId} is already linked to a different profile.`);
    const sequenceRef = db.collection("system").doc("candidate-sequences");
    const sequenceSnapshot = await transaction.get(sequenceRef);
    const sequence = sequenceSnapshot.data() || {};
    let applicationId = application.applicationId;
    let nextApplicationNumber = Number(sequence.nextApplicationNumber) || 1;
    if (!applicationId) {
      const identity = await nextUnreservedIdentity(
        nextApplicationNumber,
        formatApplicationId,
        async (id) => (await transaction.get(db.collection("application_id_registry").doc(id))).exists
      );
      applicationId = identity.id;
      nextApplicationNumber = identity.sequence + 1;
    }
    const applicationIdRef = db.collection("application_id_registry").doc(applicationId);
    const registrySnapshot = await transaction.get(applicationIdRef);
    if (registrySnapshot.exists && registrySnapshot.get("applicationRecordId") !== recordId) {
      throw new Error(`Application ID ${applicationId} is already assigned to another application.`);
    }
    if (!registrySnapshot.exists) transaction.create(applicationIdRef, { applicationRecordId: recordId, profileId: profile.id, createdAt: now() });
    transaction.set(applicationRef, {
      profileId: profile.id,
      candidateId: profile.candidateId,
      applicationId,
      updatedAt: now(),
    }, { merge: true });
    transaction.set(sequenceRef, { nextApplicationNumber }, { merge: true });
    return !application.profileId || !application.candidateId || !application.applicationId;
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.CONFIRM_CANDIDATE_ID_BACKFILL !== "I_APPROVE_CANDIDATE_ID_BACKFILL") {
    throw new Error("Backfill writes are disabled without explicit confirmation. Set CONFIRM_CANDIDATE_ID_BACKFILL=I_APPROVE_CANDIDATE_ID_BACKFILL after reviewing the dry-run report.");
  }
  const snapshot = await requireAdminDb().collection("candidates").get();
  const records = snapshot.docs.map((document) => ({ id: document.id, data: document.data() as Candidate }));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const plan = buildCandidateMigrationGroups(records.map(({ id, data }) => ({
    id,
    name: data.name,
    email: data.email,
    phone: data.phone,
  })));
  const conflictingGroups = plan.potentialDuplicatePairs.length;
  const missingProfileRecords = records.filter(({ data }) => !data.profileId || !data.candidateId).length;
  const missingApplications = records.filter(({ data }) => !data.applicationId).length;
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${records.length} legacy application records`);
  console.log(`Profiles requiring backfill: ${missingProfileRecords}; applications requiring IDs: ${missingApplications}`);
  console.log(`Potential duplicate group pairs for Admin review: ${conflictingGroups}`);
  console.log("No records are deleted or rewritten beyond identity fields.");
  if (!apply) return;

  const db = requireAdminDb();
  let profilesCreated = 0;
  let applicationsUpdated = 0;
  for (const group of plan.groups) {
    const sourceRecords = group.records.map((record) => recordsById.get(record.id)!);
    const existingProfileIds = [...new Set(sourceRecords.map((record) => record.data.profileId).filter((id): id is string => !!id))];
    if (existingProfileIds.length > 1) {
      console.warn(`Skipped ${group.records.length} records with conflicting existing profile links; resolve manually.`);
      continue;
    }
    const profileId = existingProfileIds[0] || deterministicUuid(group.records.map((record) => record.id).sort().join("|"));
    const profileBefore = await db.collection("candidate_profiles").doc(profileId).get();
    const profile = await ensureProfile(profileId, sourceRecords);
    if (!profileBefore.exists) profilesCreated += 1;
    for (const record of group.records) {
      if (await ensureApplication(record.id, profile)) applicationsUpdated += 1;
    }
  }

  const after = await db.collection("candidates").get();
  const incomplete = after.docs.filter((document) => {
    const candidate = document.data() as Candidate;
    return !candidate.profileId || !candidate.candidateId || !candidate.applicationId;
  });
  if (incomplete.length) throw new Error(`Backfill finished with ${incomplete.length} incomplete application records. Rerunning this script is safe.`);
  console.log(`Backfill complete. Profiles created: ${profilesCreated}; application records updated: ${applicationsUpdated}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
