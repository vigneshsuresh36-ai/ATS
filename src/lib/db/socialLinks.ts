import { createHash, randomBytes } from "node:crypto";
import { requireAdminDb } from "../firebaseAdmin";

export interface SocialApplicationLink {
  id: string;
  reqId: string;
  recruiterEmail: string;
  token: string;
  createdAt: string;
  createdBy: string;
  kind?: "social" | "employee-referral" | "career";
  referrerEmail?: string;
  referrerName?: string;
  referralBonus?: number;
}

function linkId(reqId: string, recruiterEmail: string) {
  return createHash("sha256")
    .update(`${reqId.toLowerCase()}|${recruiterEmail.toLowerCase()}`)
    .digest("hex");
}

export async function getOrCreateSocialLink(
  reqId: string,
  recruiterEmail: string,
  createdBy: string
) {
  const db = requireAdminDb();
  const id = linkId(reqId, recruiterEmail);
  const ref = db.collection("social_application_links").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return snapshot.data() as SocialApplicationLink;
    const link: SocialApplicationLink = {
      id,
      reqId,
      recruiterEmail: recruiterEmail.toLowerCase(),
      token: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
      createdBy: createdBy.toLowerCase(),
    };
    transaction.create(ref, link);
    return link;
  });
}

export async function getSocialLinkForRecruiter(reqId: string, recruiterEmail: string) {
  const snapshot = await requireAdminDb()
    .collection("social_application_links")
    .doc(linkId(reqId, recruiterEmail))
    .get();
  return snapshot.exists ? (snapshot.data() as SocialApplicationLink) : null;
}

export async function getSocialLinkByToken(token: string) {
  const snapshot = await requireAdminDb()
    .collection("social_application_links")
    .where("token", "==", token)
    .limit(1)
    .get();
  return snapshot.empty ? null : (snapshot.docs[0]!.data() as SocialApplicationLink);
}

export async function getOrCreateCareerLink(reqId: string, recruiterEmail: string, createdBy: string) {
  const db = requireAdminDb();
  const id = linkId(reqId, `career|${recruiterEmail}`);
  const ref = db.collection("social_application_links").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return snapshot.data() as SocialApplicationLink;
    const link: SocialApplicationLink = { id, reqId, recruiterEmail: recruiterEmail.toLowerCase(), token: randomBytes(32).toString("base64url"), createdAt: new Date().toISOString(), createdBy: createdBy.toLowerCase(), kind: "career" };
    transaction.create(ref, link);
    return link;
  });
}

export async function getOrCreateEmployeeReferralLink(
  reqId: string,
  recruiterEmail: string,
  referrerEmail: string,
  referrerName: string,
  referralBonus: number
) {
  const db = requireAdminDb();
  const id = linkId(reqId, `employee-referral|${referrerEmail}`);
  const ref = db.collection("social_application_links").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() as SocialApplicationLink;
      if (existing.referralBonus === undefined && referralBonus > 0) {
        transaction.set(ref, { referralBonus }, { merge: true });
        return { ...existing, referralBonus };
      }
      return existing;
    }
    const link: SocialApplicationLink = {
      id,
      reqId,
      recruiterEmail: recruiterEmail.toLowerCase(),
      token: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
      createdBy: referrerEmail.toLowerCase(),
      kind: "employee-referral",
      referrerEmail: referrerEmail.toLowerCase(),
      referrerName,
      referralBonus,
    };
    transaction.create(ref, link);
    return link;
  });
}
