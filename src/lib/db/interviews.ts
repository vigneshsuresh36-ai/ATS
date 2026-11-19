import { driveConflict } from "../recruitmentDrive";
import { ApiError } from "../auth";
import { appendStatusAudit, type StatusAuditContext } from "../statusAudit";
import { requireAdminDb } from "../firebaseAdmin";
import type {
  AuditLog,
  Calibration,
  Interview,
  InterviewFeedback,
  InterviewPlan,
} from "../types";
import { newId, now } from "./ids";

export async function createInterview(
  input: Omit<Interview, "id" | "createdAt">,
  audit: StatusAuditContext,
): Promise<Interview> {
  const iv: Interview = { ...input, id: newId("INT"), createdAt: now() };
  const db = requireAdminDb();
  await db.runTransaction(async (transaction) => {
    const lock = db.collection("system").doc("interview-bookings");
    await transaction.get(lock);
    {
      const records = await transaction.get(db.collection("interviews"));
      const existing = records.docs.map((record) => record.data() as Interview);
      if (existing.some((item) => item.candidateId === iv.candidateId && item.reqId === iv.reqId && (item.roundIndex || 1) === iv.roundIndex && item.status !== "Cancelled")
        || driveConflict({ candidateId: iv.candidateId, datetime: iv.datetime, durationMinutes: iv.durationMinutes ?? 60,
          panel: { interviewers: iv.interviewerEmails, room: iv.room || "" } }, iv.driveId ? existing : existing.filter((item) => item.driveId), iv.breakMinutes ?? 0, iv.officeLocation)) {
        throw new ApiError(409, "This drive slot conflicts with another booking. Refresh the timetable.");
      }
    }
    transaction.set(lock, { updatedAt: now() });
    transaction.create(db.collection("interviews").doc(iv.id), iv);
    appendStatusAudit(db, transaction, {
      entityType: "interview", entityId: iv.id, field: "status", previousValue: null, newValue: iv.status,
    }, audit);
  });
  return iv;
}

export async function getInterview(id: string): Promise<Interview | null> {
  const snap = await requireAdminDb().collection("interviews").doc(id).get();
  return snap.exists ? (snap.data() as Interview) : null;
}

export async function listInterviews(filter?: {
  candidateId?: string;
  reqId?: string;
}) {
  const db = requireAdminDb();
  let snap;
  if (filter?.candidateId) {
    snap = await db
      .collection("interviews")
      .where("candidateId", "==", filter.candidateId)
      .get();
  } else if (filter?.reqId) {
    snap = await db
      .collection("interviews")
      .where("reqId", "==", filter.reqId)
      .get();
  } else {
    snap = await db.collection("interviews").get();
  }
  let list = snap.docs.map((d) => d.data() as Interview);
  if (filter?.candidateId && filter?.reqId) {
    list = list.filter((i) => i.reqId === filter.reqId);
  }
  return list;
}

export async function updateInterview(
  id: string,
  patch: Partial<Interview>,
  audit?: StatusAuditContext,
  expectedStatus?: Interview["status"],
) {
  const db = requireAdminDb();
  const ref = db.collection("interviews").doc(id);
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data() as Interview | undefined;
    if (!current) throw new ApiError(404, "Interview not found.");
    if (expectedStatus && expectedStatus !== current.status) {
      if (audit?.source === "System") return;
      throw new ApiError(409, "This interview changed. Refresh it and try again.");
    }
    if (patch.status !== undefined) {
      appendStatusAudit(db, transaction, {
        entityType: "interview", entityId: id, field: "status", previousValue: current.status ?? null, newValue: patch.status,
      }, audit);
    }
    transaction.set(ref, patch, { merge: true });
  });
}

export async function createFeedback(
  input: Omit<InterviewFeedback, "id" | "createdAt">
): Promise<InterviewFeedback> {
  const fb: InterviewFeedback = {
    ...input,
    id: newId("FB"),
    createdAt: now(),
  };
  await requireAdminDb().collection("interview_feedback").doc(fb.id).set(fb);
  return fb;
}

export async function updateFeedback(
  entry: InterviewFeedback,
  changes: Pick<InterviewFeedback, "feedback" | "rating" | "recommendation" | "customAnswers">,
  updatedBy: string,
): Promise<InterviewFeedback> {
  const db = requireAdminDb();
  const ref = db.collection("interview_feedback").doc(entry.id);
  return db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data() as InterviewFeedback | undefined;
    if (!current || current.candidateId !== entry.candidateId || current.reqId !== entry.reqId ||
        current.interviewId !== entry.interviewId) {
      throw new ApiError(404, "Interview feedback not found.");
    }
    if (current.updatedAt !== entry.updatedAt) {
      throw new ApiError(409, "This feedback has changed. Reopen it and try again.");
    }
    const patch = { ...changes, updatedAt: now(), updatedBy };
    transaction.update(ref, patch);
    return { ...current, ...patch };
  });
}

export async function listFeedback(candidateId: string) {
  const snap = await requireAdminDb()
    .collection("interview_feedback")
    .where("candidateId", "==", candidateId)
    .get();
  return snap.docs.map((d) => d.data() as InterviewFeedback);
}

export async function listAllFeedback(): Promise<InterviewFeedback[]> {
  const snap = await requireAdminDb().collection("interview_feedback").get();
  return snap.docs.map((d) => d.data() as InterviewFeedback);
}

export async function getPlan(reqId: string): Promise<InterviewPlan | null> {
  const snap = await requireAdminDb()
    .collection("interview_plans")
    .doc(reqId)
    .get();
  return snap.exists ? (snap.data() as InterviewPlan) : null;
}

export async function savePlan(plan: InterviewPlan) {
  await requireAdminDb().collection("interview_plans").doc(plan.reqId).set(plan);
  return plan;
}

export async function getCalibration(
  reqId: string
): Promise<Calibration | null> {
  const snap = await requireAdminDb().collection("calibration").doc(reqId).get();
  return snap.exists ? (snap.data() as Calibration) : null;
}

export async function saveCalibration(cal: Calibration) {
  await requireAdminDb().collection("calibration").doc(cal.reqId).set(cal);
  return cal;
}

export async function addAudit(entry: Omit<AuditLog, "id" | "at">) {
  const definedEntry = Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined)
  ) as Omit<AuditLog, "id" | "at">;
  const row: AuditLog = { ...definedEntry, id: newId("AUD"), at: now() };
  await requireAdminDb().collection("audit_log").doc(row.id).set(row);
  return row;
}

