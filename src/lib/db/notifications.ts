import type { AppNotification } from "../types";
import { requireAdminDb } from "../firebaseAdmin";
import { now } from "./ids";

export type NewNotification = Omit<AppNotification, "id" | "createdAt" | "readAt">;

export async function createNotifications(notifications: NewNotification[]) {
  if (!notifications.length) return;
  const db = requireAdminDb();
  const batch = db.batch();
  const createdAt = now();
  for (const notification of notifications) {
    const ref = db.collection("notifications").doc();
    batch.create(ref, {
      ...notification,
      id: ref.id,
      recipientEmail: notification.recipientEmail.toLowerCase(),
      createdAt,
      readAt: null,
    } satisfies AppNotification);
  }
  await batch.commit();
}

export async function listNotifications(recipientEmail: string): Promise<AppNotification[]> {
  const snapshot = await requireAdminDb()
    .collection("notifications")
    .where("recipientEmail", "==", recipientEmail.toLowerCase())
    .get();
  return snapshot.docs
    .map((document) => document.data() as AppNotification)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function markNotificationRead(id: string, recipientEmail: string) {
  const db = requireAdminDb();
  const ref = db.collection("notifications").doc(id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("recipientEmail") !== recipientEmail.toLowerCase()) return false;
    if (!snapshot.get("readAt")) transaction.update(ref, { readAt: now() });
    return true;
  });
}

export async function markAllNotificationsRead(recipientEmail: string) {
  const db = requireAdminDb();
  const snapshot = await db.collection("notifications")
    .where("recipientEmail", "==", recipientEmail.toLowerCase())
    .get();
  const unread = snapshot.docs.filter((document) => !document.get("readAt"));
  const updatedAt = now();
  for (let offset = 0; offset < unread.length; offset += 450) {
    const batch = db.batch();
    for (const document of unread.slice(offset, offset + 450)) {
      batch.update(document.ref, { readAt: updatedAt });
    }
    await batch.commit();
  }
}