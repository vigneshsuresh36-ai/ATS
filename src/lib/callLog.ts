export const CALL_OUTCOMES = ["Connected", "No answer", "Busy", "Call back later", "Wrong number"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** Keeps digits and a leading +; bare 10-digit Indian numbers get +91. Returns "" when no usable number. */
export function dialNumber(phone: string | undefined | null): string {
  const raw = (phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return digits;
}

export function displayNumber(dial: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(dial);
  return m ? `+91 ${m[1]} ${m[2]}` : dial;
}
