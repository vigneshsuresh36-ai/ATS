import { adminAuth, requireAdminDb } from "../firebaseAdmin";
import type { AppUser, OrgSettings } from "../types";
import { initialAdministrator } from "../initialAdministrator";
import { now } from "./ids";

let seedPromise: Promise<void> | null = null;

export async function ensureSeedUsers() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const db = requireAdminDb();

    const orgRef = db.collection("org").doc("org");
    const bootstrapRef = db.collection("system").doc("bootstrap");
    await db.runTransaction(async (transaction) => {
      const [usersSnap, orgSnap, bootstrapSnap] = await Promise.all([
        transaction.get(db.collection("users").limit(1)),
        transaction.get(orgRef),
        transaction.get(bootstrapRef),
      ]);
      if (usersSnap.empty) {
        if (bootstrapSnap.exists || orgSnap.exists) throw new Error("This installation has no team members. Restore an administrator through your deployment support process.");
        const payload = initialAdministrator(process.env.BOOTSTRAP_ADMIN_EMAIL, process.env.BOOTSTRAP_ADMIN_NAME, now());
        transaction.create(db.collection("users").doc(payload.email), payload);
      }
      if (!bootstrapSnap.exists) transaction.create(bootstrapRef, { initializedAt: now() });
      if (!orgSnap.exists) transaction.create(orgRef, { id: "org", company: "Talent Acquisition", slaDaysDefault: 10 } satisfies OrgSettings);
    });
  })().catch((e) => {
    seedPromise = null;
    throw e;
  });
  return seedPromise;
}

function normalizeUser(u: AppUser | null): AppUser | null {
  if (!u) return null;
  let role = u.role as string;
  if (role === "Approver") role = "DepartmentHead";
  if (role === "Interviewer") role = "Recruiter";
  return {
    ...u,
    role: role as AppUser["role"],
    departments: u.departments || [],
  };
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const e = email.toLowerCase();
  const snap = await requireAdminDb().collection("users").doc(e).get();
  return snap.exists ? normalizeUser(snap.data() as AppUser) : null;
}

export async function listUsers(includeInactive = false): Promise<AppUser[]> {
  const snap = await requireAdminDb().collection("users").get();
  return snap.docs
    .map((d) => normalizeUser(d.data() as AppUser)!)
    .filter((u) => u && (includeInactive || u.active !== false));
}

export async function upsertUser(
  data: Omit<AppUser, "id" | "createdAt"> & { createdAt?: string }
): Promise<AppUser> {
  const email = data.email.toLowerCase();
  const user: AppUser = {
    id: email,
    ...(data.employeeCode?.trim() ? { employeeCode: data.employeeCode.trim() } : {}),
    email,
    name: data.name,
    role: data.role,
    title: data.title || data.role,
    departments: data.departments || [],
    ...(data.accessScopes !== undefined ? { accessScopes: data.accessScopes } : {}),
    managerEmail: data.managerEmail || "",
    active: data.active !== false,
    createdAt: data.createdAt || now(),
  };
  await requireAdminDb()
    .collection("users")
    .doc(email)
    .set(user, { merge: true });
  return user;
}

export async function deactivateUser(email: string) {
  const e = email.toLowerCase();
  await requireAdminDb().collection("users").doc(e).update({ active: false });
}

export async function getOrg(): Promise<OrgSettings> {
  const snap = await requireAdminDb().collection("org").doc("org").get();
  return snap.data() as OrgSettings;
}

export async function saveOrg(patch: Partial<OrgSettings>) {
  await requireAdminDb().collection("org").doc("org").set(patch, { merge: true });
  return getOrg();
}

export async function setIntegrationRequest(provider: "whatsapp" | "naukri" | "linkedin", requested: boolean) {
  const db = requireAdminDb();
  const ref = db.collection("org").doc("org");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error("Organization settings are unavailable.");
    const org = snapshot.data() as OrgSettings;
    const integrationRequests = { ...org.integrationRequests, [provider]: requested };
    transaction.update(ref, { integrationRequests });
    return { ...org, integrationRequests };
  });
}

export async function verifyIdToken(
  token: string
): Promise<{ email: string; name: string; uid: string } | null> {
  const auth = adminAuth();
  if (!auth) return null;
  try {
    const decoded = await auth.verifyIdToken(token);
    return {
      email: (decoded.email || "").toLowerCase(),
      name: decoded.name || decoded.email || "",
      uid: decoded.uid,
    };
  } catch {
    return null;
  }
}
