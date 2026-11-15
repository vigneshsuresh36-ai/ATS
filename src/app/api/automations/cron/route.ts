import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { errResponse, json, ApiError } from "@/lib/auth";
import { listUsers } from "@/lib/db";
import { getAutomationSettings, runAutomations } from "@/lib/automations";
import { requireAdminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return json({ error: "Unauthorized" }, 401);
  const lock = requireAdminDb().collection("automation_locks").doc("cron");
  const started = Date.now();
  let acquired = false;
  try {
    await requireAdminDb().runTransaction(async (tx) => {
      const snap = await tx.get(lock);
      if (Number(snap.data()?.expiresAt || 0) > started) throw new ApiError(409, "Runner is already active.");
      tx.set(lock, { expiresAt: started + 120000, token: started });
    });
    acquired = true;
    const users = (await listUsers()).filter((u) => u.active && ["Admin", "Recruiter"].includes(u.role));
    const rows = await Promise.all(users.map(async (user) => ({ user, settings: await getAutomationSettings(user.email) })));
    rows.sort((a, b) => (a.settings.lastRunAt || "").localeCompare(b.settings.lastRunAt || ""));
    let processed = 0;
    const errors: string[] = [];
    for (const { user } of rows) {
      if (Date.now() - started > 20000) break;
      try { await runAutomations(user, started + 45000); processed++; } catch { errors.push(user.id); }
    }
    return json({ processed, remaining: users.length - processed - errors.length, errors });
  } catch (e) { return errResponse(e); }
  finally {
    if (acquired) await requireAdminDb().runTransaction(async (tx) => {
      if ((await tx.get(lock)).data()?.token === started) tx.delete(lock);
    });
  }
}
