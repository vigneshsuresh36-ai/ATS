import type { Candidate, Requisition, StageEvent } from "@/lib/types";

const SKILL_TERMS = [
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Python", "Java", "C++", "C#", ".NET", "SQL", "PostgreSQL", "MySQL", "MongoDB", "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Excel", "Power BI", "Tableau", "Salesforce", "SAP", "Recruitment", "Talent Acquisition", "Supply Chain", "Logistics", "Project Management", "Agile", "Finance", "Accounting", "Marketing", "Data Analysis",
];

const IN_PROGRESS_STAGES = new Set([
  "PendingHMApproval", "HMApproved", "Screened", "Shortlist", "Interview",
  "Interview Scheduled", "Debrief", "Selected", "OfferApprovalPending",
  "OfferApproved", "Offered", "Onboarded", "Social CV",
]);

const OFFERED_STAGES = new Set(["OfferApproved", "Offered", "Onboarded"]);

export const UNASSIGNED_TALENT_POOL_REQ_ID = "TALENT_POOL";

export function isTalentPoolEligible(candidate: Candidate, events: StageEvent[]) {
  const history = events.filter((event) => event.candidateId === candidate.id);
  if (candidate.stage === "Candidate Backed Out" || candidate.backedOutAt) return true;
  if (
    candidate.offerApprovalStatus === "Pending" || candidate.offerApprovalStatus === "Approved" ||
    history.some((event) => OFFERED_STAGES.has(event.toStage))
  ) return false;

  if (candidate.stage === "Rejected" || candidate.stage === "Social CV Reject") return true;
  return !IN_PROGRESS_STAGES.has(candidate.stage);
}

function extractSkills(text: string) {
  const normalized = text.toLowerCase();
  return SKILL_TERMS.filter((skill) => normalized.includes(skill.toLowerCase()));
}

function requiredExperience(level: string) {
  const range = level.match(/(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const minimum = level.match(/(\d{1,2})\s*(?:\+|plus)\s*(?:years?|yrs?)/i);
  if (minimum) return { min: Number(minimum[1]), max: undefined };
  return null;
}

export function scoreCandidate(candidate: Candidate, req: Requisition) {
  const requisitionText = `${req.title} ${req.department} ${req.level} ${req.notes} ${req.jdText}`;
  const requiredSkills = extractSkills(requisitionText);
  const candidateSkills = new Set([
    ...(candidate.skills || []),
    ...extractSkills((candidate.skills || []).join(" ")),
  ].map((skill) => skill.toLowerCase()));
  const matchedSkills = requiredSkills.filter((skill) => candidateSkills.has(skill.toLowerCase()));
  const signals: { weight: number; score: number }[] = [];

  if (requiredSkills.length) signals.push({ weight: 45, score: (matchedSkills.length / requiredSkills.length) * 100 });

  const experience = requiredExperience(req.level || "");
  if (experience && candidate.experienceYears !== undefined) {
    const years = candidate.experienceYears;
    const experienceScore = years < experience.min
      ? Math.max(0, 100 - (experience.min - years) * 25)
      : experience.max !== undefined && years > experience.max
        ? Math.max(60, 100 - (years - experience.max) * 5)
        : 100;
    signals.push({ weight: 25, score: experienceScore });
  }

  const expectedCtc = Number(candidate.expectedCtc);
  if (Number.isFinite(expectedCtc) && expectedCtc > 0) {
    const salaryScore = expectedCtc <= req.salaryMax
      ? expectedCtc >= req.salaryMin ? 100 : 85
      : Math.max(0, 100 - ((expectedCtc - req.salaryMax) / req.salaryMax) * 100);
    signals.push({ weight: 20, score: salaryScore });
  }

  if (candidate.location && req.location) {
    const locations = req.location.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    const candidateLocation = candidate.location.toLowerCase();
    signals.push({ weight: 10, score: locations.some((location) => candidateLocation.includes(location) || location.includes(candidateLocation)) ? 100 : 0 });
  }

  const weightTotal = signals.reduce((total, signal) => total + signal.weight, 0);
  const score = weightTotal
    ? Math.round(signals.reduce((total, signal) => total + signal.score * signal.weight, 0) / weightTotal)
    : 0;
  return { score, matchedSkills, requiredSkills };
}