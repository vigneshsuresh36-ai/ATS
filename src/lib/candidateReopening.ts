import type { CandidateStage } from "./types";

export function canReopenApplication(stage: CandidateStage) {
  return stage === "Rejected" || stage === "Social CV Reject" || stage === "Candidate Backed Out";
}
