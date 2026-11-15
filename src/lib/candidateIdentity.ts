import { createHash } from "node:crypto";

export function normalizeCandidateEmail(email: string | undefined) {
  return (email || "").trim().toLowerCase();
}

export function normalizeCandidatePhone(phone: string | undefined) {
  return (phone || "").replace(/\D/g, "");
}

export function formatCandidateId(sequence: number) {
  return `CAN-${String(sequence).padStart(6, "0")}`;
}

export function formatApplicationId(sequence: number) {
  return `APP-${String(sequence).padStart(6, "0")}`;
}

export async function nextUnreservedIdentity(
  startAt: number,
  format: (sequence: number) => string,
  isReserved: (id: string) => Promise<boolean>
) {
  let sequence = Number.isSafeInteger(startAt) && startAt > 0 ? startAt : 1;
  let id = format(sequence);
  while (await isReserved(id)) {
    sequence += 1;
    id = format(sequence);
  }
  return { sequence, id };
}

export function candidateContactIndexId(kind: "email" | "phone", value: string) {
  return `${kind}_${createHash("sha256").update(value).digest("hex")}`;
}