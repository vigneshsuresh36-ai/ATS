import type { AppUser, Candidate } from "@/lib/types";

export function referralEmail(candidate: Pick<Candidate, "sourceDetail" | "referrerEmail">, users: Pick<AppUser, "email" | "employeeCode">[]): string | undefined {
  const identifier = (candidate.referrerEmail || candidate.sourceDetail || "").trim().toLowerCase();
  if (!identifier) return undefined;
  const member = users.find((user) => user.email.toLowerCase() === identifier || user.employeeCode?.trim().toLowerCase() === identifier);
  return member?.email.toLowerCase() || (identifier.includes("@") ? identifier : undefined);
}
