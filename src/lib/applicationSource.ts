import type { SocialApplicationLink } from "./db/socialLinks";
export function applicationSourceForLink(kind: SocialApplicationLink["kind"]) {
  if (kind === "employee-referral") return "Employee Referral";
  return kind === "career" ? "Career Page" : "Social CV";
}
