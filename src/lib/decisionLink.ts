import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/auth";

function secret() {
  const value = process.env.DECISION_LINK_SECRET;
  if (!value || value.length < 16) throw new ApiError(500, "Approval links are not set up. Add DECISION_LINK_SECRET (16+ characters) to the server settings.");
  return value;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Signed, expiring link for one candidate. It only works while the candidate is still pending approval. */
export function createDecisionToken(candidateId: string, ttlDays = 7) {
  const payload = Buffer.from(JSON.stringify({ c: candidateId, e: Date.now() + ttlDays * 86400000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readDecisionToken(token: string): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { c?: string; e?: number };
    return data.c && typeof data.e === "number" && data.e > Date.now() ? data.c : null;
  } catch {
    return null;
  }
}
