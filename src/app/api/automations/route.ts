import { NextRequest } from "next/server";
import { ApiError, errResponse, json, requireUser } from "@/lib/auth";
import { automationDashboard, reviewAutomationTask, runAutomations, saveAutomationSettings } from "@/lib/automations";
import { requireAutomationRole } from "@/lib/automationContext";
import type { WorkflowId } from "@/lib/automationTypes";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req); requireAutomationRole(user);
    const dashboard = await automationDashboard(user);
    const candidateId = req.nextUrl.searchParams.get("candidateId");
    if (candidateId) return json({ tasks: dashboard.tasks.filter((task) => task.candidateId === candidateId && task.workflow !== "briefs" && task.workflow !== "intake").map(({ id, title, workflow, status, updatedAt, recipients, subject }) => ({ id, title, workflow, status, updatedAt, recipients, subject })) });
    return json(dashboard);
  }
  catch (e) { return errResponse(e); }
}
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req); requireAutomationRole(user);
    const body = await req.json();
    return json({ settings: await saveAutomationSettings(user, body.workflow as WorkflowId, body.config) });
  } catch (e) { return errResponse(e); }
}
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req); requireAutomationRole(user);
    const body = await req.json();
    if (body.action === "run") return json(await runAutomations(user));
    if (!["send", "dismiss", "review"].includes(body.action) || typeof body.id !== "string" || !/^[a-f0-9]{64}$/.test(body.id)) throw new ApiError(400, "Unknown automation action.");
    if ((body.subject !== undefined && typeof body.subject !== "string") || (body.body !== undefined && typeof body.body !== "string")) throw new ApiError(400, "Invalid message.");
    await reviewAutomationTask(user, body.id, body.action, { subject: body.subject, body: body.body });
    return json({ ok: true });
  } catch (e) { return errResponse(e); }
}
