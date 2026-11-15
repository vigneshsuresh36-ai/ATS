import { requireAdminDb } from "./firebaseAdmin";
import { ApiError } from "./auth";
import { automationContext, requireAutomationRole } from "./automationContext";
import { defaultAutomationSettings, WORKFLOWS, type AutomationSettings, type AutomationTask, type WorkflowId } from "./automationTypes";
import { planAutomations } from "./automationPlanner";
import { aiConfigured } from "./ai";
import type { AppUser } from "./types";
import { addAudit } from "./db";

type StoredSettings = AutomationSettings & { enabledSince?: string; lastRunAt?: string };
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.AUTOMATION_FROM_EMAIL);
export async function getAutomationSettings(email: string): Promise<StoredSettings> {
  const snap = await requireAdminDb().collection("automation_settings").doc(email).get();
  const defaults = defaultAutomationSettings();
  const stored = snap.data() || {};
  for (const w of WORKFLOWS) defaults[w.id] = { ...defaults[w.id], ...stored[w.id] };
  defaults.briefs.enabled = false;
  return { ...defaults, enabledSince: stored.enabledSince, lastRunAt: stored.lastRunAt };
}
export async function saveAutomationSettings(user: AppUser, workflow: WorkflowId, input: unknown) {
  requireAutomationRole(user);
  if (workflow === "briefs" || !WORKFLOWS.some((w) => w.id === workflow)) throw new ApiError(400, "Unknown workflow.");
  const value = input as Record<string, unknown>;
  if (!value || typeof value !== "object") throw new ApiError(400, "Invalid workflow configuration.");
  const current = await getAutomationSettings(user.email);
  const next = { ...current[workflow] };
  for (const key of ["enabled", "autoSend"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "boolean") throw new ApiError(400, "Expected a switch value.");
    next[key] = value[key];
  }
  for (const key of ["delayHours", "escalationHours"] as const) if (value[key] !== undefined) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 2160) throw new ApiError(400, "Timing must be between 1 and 2,160 hours.");
    next[key] = n;
  }
  for (const key of ["subject", "template"] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== "string" || value[key].length > (key === "subject" ? 200 : 6000)) throw new ApiError(400, "Template is too long.");
    next[key] = value[key].trim();
  }
  if (workflow === "feedback" && next.escalationHours <= next.delayHours) throw new ApiError(400, "Escalation must occur after the first reminder.");
  if (["intake", "briefs", "updates", "interviewReminders"].includes(workflow)) next.autoSend = false;
  if (!["intake", "briefs"].includes(workflow) && (!next.subject || !next.template)) throw new ApiError(400, "Subject and message are required.");
  const stamp = new Date().toISOString();
  await requireAdminDb().collection("automation_settings").doc(user.email).set({ [workflow]: next,
    ...(workflow === "updates" && next.enabled && !current.updates.enabled ? { enabledSince: stamp } : {}), updatedAt: stamp }, { merge: true });
  await audit(user, "automation.configure", workflow);
  return getAutomationSettings(user.email);
}
async function audit(user: AppUser, action: string, entityId: string) {
  await addAudit({ action, entityType: "automation", entityId, actorEmail: user.email, actingAdminEmail: user.actingAdminEmail });
}
export async function automationDashboard(user: AppUser) {
  const [context, settings] = await Promise.all([automationContext(user), getAutomationSettings(user.email)]);
  const ids = new Set(context.requisitions.map((r) => r.id));
  const snap = await requireAdminDb().collection("automation_tasks").where("ownerEmail", "==", user.email).get();
  const tasks = snap.docs.map((d) => d.data() as AutomationTask).filter((t) => t.workflow !== "briefs" && ids.has(t.reqId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { settings, tasks, integrations: { ai: aiConfigured(), email: emailConfigured(), scheduler: Boolean(process.env.CRON_SECRET) } };
}
export async function runAutomations(user: AppUser, deadline = Date.now() + 45000) {
  requireAutomationRole(user);
  const db = requireAdminDb();
  const lock = db.collection("automation_locks").doc(user.email);
  const token = Date.now();
  await db.runTransaction(async (tx) => {
    if (Number((await tx.get(lock)).data()?.expiresAt || 0) > token) throw new ApiError(409, "Your workflows are already running. Please wait.");
    tx.set(lock, { token, expiresAt: token + 120000 });
  });
  try { return await executeAutomations(user, deadline); }
  finally { await db.runTransaction(async (tx) => { if ((await tx.get(lock)).data()?.token === token) tx.delete(lock); }); }
}
async function executeAutomations(user: AppUser, deadline: number) {
  const db = requireAdminDb();
  const settings = await getAutomationSettings(user.email);
  const context = await automationContext(user);
  const plans = planAutomations(context, settings, user);
  let prepared = 0;
  const generated = 0;
  for (const task of plans.slice(0, 100)) {
    if (Date.now() > deadline - 3000) break;
    const ref = db.collection("automation_tasks").doc(task.id);
    if ((await ref.get()).exists) continue;
    if (!task.recipients.length) { task.status = "failed"; task.error = "No recipient is available. Check the team and contact details."; }
    try { await ref.create(task); prepared++; } catch (e) { if ((e as { code?: number }).code !== 6) throw e; }
  }
  // Pending drafts are revalidated against current records before any external message is sent.
  const pending = await db.collection("automation_tasks").where("ownerEmail", "==", user.email).get();
  const currentIds = new Set(plans.map((p) => p.id));
  const visible = new Set(context.requisitions.map((r) => r.id));
  for (const row of pending.docs) {
    if (Date.now() > deadline - 3000) break;
    const task = row.data() as AutomationTask;
    if (task.status === "preparing" && Date.now() - Date.parse(task.updatedAt) > 120000) {
      await row.ref.update({ status: "failed", error: "Brief preparation was interrupted. Generate an evidence summary from the candidate record instead.", updatedAt: new Date().toISOString() });
      continue;
    }
    if (task.status !== "pending" || !visible.has(task.reqId)) continue;
    if (!settings[task.workflow].enabled) continue;
    if (!currentIds.has(task.id)) { await row.ref.update({ status: "obsolete", updatedAt: new Date().toISOString() }); continue; }
    if (settings[task.workflow].autoSend && emailConfigured() && !["briefs", "updates", "intake", "interviewReminders"].includes(task.workflow)) {
      const fresh = plans.find((p) => p.id === task.id)!;
      try { await reviewAutomationTask(user, task.id, "send", { subject: fresh.subject, body: fresh.body }); }
      catch (e) { if (!(e instanceof ApiError) || ![409, 502].includes(e.status)) throw e; }
    }
  }
  await db.collection("automation_settings").doc(user.email).set({ lastRunAt: new Date().toISOString() }, { merge: true });
  return { prepared, generated };
}
export async function reviewAutomationTask(user: AppUser, id: string, action: "send" | "dismiss" | "review", edits?: { subject?: string; body?: string }) {
  requireAutomationRole(user);
  const db = requireAdminDb();
  const ref = db.collection("automation_tasks").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, "Task not found.");
  const task = snap.data() as AutomationTask;
  if (task.workflow === "briefs") throw new ApiError(404, "Task not found.");
  const ctx = await automationContext(user);
  if (task.ownerEmail !== user.email || !ctx.requisitions.some((r) => r.id === task.reqId)) throw new ApiError(403, "This task is outside your workspace.");
  const stamp = new Date().toISOString();
  if (action === "dismiss" || action === "review") {
    await db.runTransaction(async (tx) => {
      const current = (await tx.get(ref)).data() as AutomationTask;
      if (!["pending", "failed"].includes(current.status) || (action === "review" && current.workflow !== "briefs")) throw new ApiError(409, "This task cannot be reviewed or dismissed now.");
      tx.update(ref, { status: action === "review" ? "reviewed" : "dismissed", reviewedBy: user.email, updatedAt: stamp });
    });
    await audit(user, `automation.${action}`, id);
    return;
  }
  if (task.workflow === "intake") throw new ApiError(400, "This item cannot be emailed.");
  if (task.status !== "pending") throw new ApiError(409, "This task has already been handled or is being sent.");
  if (!emailConfigured()) throw new ApiError(503, "Email delivery is not connected. Configure RESEND_API_KEY and AUTOMATION_FROM_EMAIL.");
  const settings = await getAutomationSettings(user.email);
  if (!settings[task.workflow].enabled) throw new ApiError(409, "This workflow is paused.");
  const fresh = planAutomations(ctx, settings, user).find((p) => p.id === id);
  if (!fresh) { await ref.update({ status: "obsolete", updatedAt: stamp }); throw new ApiError(409, "This action is no longer needed. The underlying record changed."); }
  if (JSON.stringify([...task.recipients].sort()) !== JSON.stringify([...fresh.recipients].sort())) {
    await ref.update({ recipients: fresh.recipients, updatedAt: stamp });
    throw new ApiError(409, "Recipients have changed. Close this draft, refresh the page, and review the current recipients before sending.");
  }
  const subject = edits?.subject?.trim() ?? task.subject;
  const body = edits?.body?.trim() ?? task.body;
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !body || body.length > 6000 || !fresh.recipients.length || fresh.recipients.some((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))) throw new ApiError(400, "Check the message and recipient details.");
  // No lease takeover: an ambiguous provider outcome is never automatically sent again.
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as AutomationTask;
    if (current.status !== "pending") throw new ApiError(409, "This task has already been handled or is being sent.");
    tx.update(ref, { status: "sending", subject, body, recipients: fresh.recipients, updatedAt: stamp, reviewedBy: user.email });
  });
  try {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `starship-${id}` },
      body: JSON.stringify({ from: process.env.AUTOMATION_FROM_EMAIL, to: fresh.recipients, reply_to: user.email, subject, text: body }),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status}). Check delivery settings.`);
    const result = await res.json() as { id?: string };
    if (!result.id) throw new Error("Email provider returned no message ID. Check the provider log before sending manually.");
    await ref.update({ status: "sent", providerId: result.id, updatedAt: new Date().toISOString() });
  } catch (e) {
    await ref.update({ status: "failed", error: e instanceof Error ? e.message : "Delivery could not be verified. Check the provider log.", updatedAt: new Date().toISOString() });
    throw new ApiError(502, "Delivery could not be confirmed. Check the activity and provider logs before following up manually.");
  }
  await audit(user, "automation.send", id);
}
