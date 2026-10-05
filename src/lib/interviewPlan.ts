import type { InterviewPlan } from "./types";

export const DEFAULT_INTERVIEW_ROUNDS: InterviewPlan["rounds"] = [
  {
    name: "Round 1 — Technical",
    type: "interview",
    order: 1,
    competencies: [],
  },
];

export function getInterviewRounds(
  plan: InterviewPlan | null | undefined
): InterviewPlan["rounds"] {
  return plan?.rounds?.length ? plan.rounds : DEFAULT_INTERVIEW_ROUNDS;
}