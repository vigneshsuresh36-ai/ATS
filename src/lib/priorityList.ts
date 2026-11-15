export type PriorityItem = { candidateId: string; name: string; reason: string; score: number; kind: "interview" | "feedback" | "offer" | "risk" | "overdue" | "schedule" };

type Named = { name?: string };

/** Keeps the single highest-scoring reason per candidate and returns the top entries. */
export function buildPriorityList(input: {
  interviewsToday: { candidateId: string; candidate?: Named; datetime: string }[];
  awaitingFb: { id: string; name?: string; feedbackAgeDays?: number }[];
  offersPending: { id: string; name?: string }[];
  stuck: { id: string; name?: string; days: number; sla: number }[];
  toSchedule: { id: string; name?: string }[];
  atRisk: { id: string; name?: string; level: "High" | "Medium"; reasons: string[] }[];
}, limit = 8): PriorityItem[] {
  const best = new Map<string, PriorityItem>();
  const add = (candidateId: string, name: string | undefined, reason: string, score: number, kind: PriorityItem["kind"]) => {
    const current = best.get(candidateId);
    if (!current || current.score < score) best.set(candidateId, { candidateId, name: name || "Candidate", reason, score, kind });
  };
  for (const item of input.interviewsToday) {
    const time = new Date(item.datetime).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    add(item.candidateId, item.candidate?.name, `Interview today at ${time}`, 100, "interview");
  }
  for (const item of input.offersPending) add(item.id, item.name, "Offer approval waiting", 80, "offer");
  for (const item of input.atRisk) add(item.id, item.name, `${item.level} drop-off risk: ${item.reasons[0] || "check in"}`, item.level === "High" ? 75 : 55, "risk");
  for (const item of input.awaitingFb) {
    const age = item.feedbackAgeDays || 0;
    add(item.id, item.name, `Interview feedback missing${age ? ` for ${age} day${age === 1 ? "" : "s"}` : ""}`, 60 + Math.min(age, 10) * 2, "feedback");
  }
  for (const item of input.stuck) add(item.id, item.name, `${item.days} days in this stage (target ${item.sla})`, 50 + Math.min(item.days - item.sla, 20), "overdue");
  for (const item of input.toSchedule) add(item.id, item.name, "Approved, needs an interview slot", 40, "schedule");
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
