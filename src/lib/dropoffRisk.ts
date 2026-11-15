import type { Candidate } from "@/lib/types";

export type DropoffRisk = { level: "High" | "Medium"; reasons: string[] };

const INACTIVE = /reject|backed out|onboard|talent pool|declin|hire/i;

/** "30", "30 days", "2 months" become days. Returns undefined when it cannot be read. */
export function noticeDays(notice: string | undefined): number | undefined {
  const text = (notice || "").toLowerCase();
  const n = /(\d+(?:\.\d+)?)/.exec(text);
  if (!n) return /immediate/.test(text) ? 0 : undefined;
  const value = Number(n[1]);
  return /month/.test(text) ? Math.round(value * 30) : /week/.test(text) ? Math.round(value * 7) : Math.round(value);
}

function money(value: string | undefined): number | undefined {
  const digits = (value || "").replace(/[^0-9.]/g, "");
  const n = Number(digits);
  return digits && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Simple, explainable rules that flag candidates who are likely to go quiet or decline.
 * It reports reasons, never a hiring recommendation.
 */
export function dropoffRisk(candidate: Candidate, daysInStage: number): DropoffRisk | null {
  if (candidate.archived || INACTIVE.test(candidate.stage)) return null;
  let points = 0;
  const reasons: string[] = [];
  const notice = noticeDays(candidate.notice);
  if (notice !== undefined && notice > 90) { points += 3; reasons.push(`Notice period is ${notice} days`); }
  else if (notice !== undefined && notice > 60) { points += 2; reasons.push(`Notice period is ${notice} days`); }
  const atOffer = /offer/i.test(candidate.stage);
  if (atOffer && daysInStage >= 10) { points += 3; reasons.push(`Offer waiting ${daysInStage} days`); }
  else if (atOffer && daysInStage >= 5) { points += 2; reasons.push(`Offer waiting ${daysInStage} days`); }
  else if (!atOffer && daysInStage >= 14) { points += 2; reasons.push(`No movement for ${daysInStage} days`); }
  else if (!atOffer && daysInStage >= 7) { points += 1; reasons.push(`No movement for ${daysInStage} days`); }
  const expected = money(candidate.expectedCtc), offered = money(candidate.offeredSalary);
  if (atOffer && expected && offered && expected > offered * 1.15) { points += 2; reasons.push("Expected pay is well above the offer"); }
  if (points >= 4) return { level: "High", reasons };
  if (points >= 2) return { level: "Medium", reasons };
  return null;
}
